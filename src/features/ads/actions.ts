"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/supabase/server";
import { getAccountTokens } from "@/lib/social/accounts";
import { friendlyActionError } from "@/lib/jobs/action-errors";
import { AdsApiError } from "@/lib/ads/types";
import { metaAds } from "@/lib/ads/providers/meta-ads";
import { sendAlert } from "@/lib/alerts";
import type { Platform } from "@/types/database";

export interface ActionResult {
  error?: string;
  id?: string;
}

export interface AdCampaignFormValues {
  name: string;
  platform: Platform;
  objective: string;
  management_mode: "internal" | "live";
  budget: number | null;
  currency: string;
  start_date: string | null;
  end_date: string | null;
  targeting_notes: string | null;
  destination: string | null;
  linked_item_id: string | null;
  social_account_id: string | null;
  meta_ad_account_id: string | null;
}

/** Only Meta (Facebook/Instagram) ads are supported in live mode so far. */
function adapterFor(platform: string) {
  if (platform === "facebook" || platform === "instagram") return metaAds;
  return null;
}

export async function createAdCampaign(values: AdCampaignFormValues): Promise<ActionResult> {
  const { user, orgId, supabase } = await getSessionContext();
  if (!user || !orgId) return { error: "Unauthorized" };
  if (!values.name.trim()) return { error: "Name is required" };

  if (values.management_mode === "live") {
    if (!values.social_account_id || !values.meta_ad_account_id) {
      return {
        error:
          "Live mode needs a connected account and a Meta Ad Account ID (find this in Business Manager).",
      };
    }
    const adapter = adapterFor(values.platform);
    if (!adapter) {
      return { error: `Live ads aren't supported for ${values.platform} yet — only Meta (Facebook/Instagram).` };
    }
  }

  const { data: campaign, error } = await supabase
    .from("ad_campaigns")
    .insert({
      org_id: orgId,
      name: values.name.trim(),
      platform: values.platform,
      objective: values.objective,
      management_mode: values.management_mode,
      status: "draft",
      budget: values.budget,
      currency: values.currency,
      start_date: values.start_date,
      end_date: values.end_date,
      targeting_notes: values.targeting_notes,
      destination: values.destination,
      linked_item_id: values.linked_item_id,
      social_account_id: values.social_account_id,
      meta_ad_account_id: values.meta_ad_account_id,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !campaign) return { error: friendlyActionError(error, "Create failed") };

  // Live mode: attempt the real API call right away, but never block the
  // save on it — the campaign record itself (an internal, DB-only thing)
  // always succeeds; the external push is best-effort and its outcome is
  // surfaced via last_sync_error rather than failing this whole action.
  if (values.management_mode === "live" && values.social_account_id && values.meta_ad_account_id) {
    await attemptLiveCreate(campaign.id, values);
  }

  revalidatePath("/ads");
  return { id: campaign.id };
}

async function attemptLiveCreate(
  campaignId: string,
  values: AdCampaignFormValues
): Promise<void> {
  const { supabase } = await getSessionContext();
  const adapter = adapterFor(values.platform);
  if (!adapter || !values.social_account_id || !values.meta_ad_account_id) return;

  try {
    const { tokens } = await getAccountTokens(values.social_account_id);
    const result = await adapter.createLiveCampaign(
      {
        name: values.name,
        objective: values.objective,
        budget: values.budget,
        currency: values.currency,
        startDate: values.start_date,
        endDate: values.end_date,
        targetingNotes: values.targeting_notes,
        adAccountId: values.meta_ad_account_id,
      },
      tokens.accessToken
    );
    await supabase
      .from("ad_campaigns")
      .update({
        external_campaign_id: result.externalCampaignId,
        last_synced_at: new Date().toISOString(),
        last_sync_error: null,
      })
      .eq("id", campaignId);
  } catch (e) {
    const message =
      e instanceof AdsApiError
        ? e.message
        : e instanceof Error
          ? e.message
          : "Live campaign creation failed";
    await supabase
      .from("ad_campaigns")
      .update({ last_sync_error: message.slice(0, 500) })
      .eq("id", campaignId);
    if (e instanceof AdsApiError && e.code === "permission_denied") {
      await sendAlert(
        `📢 Ad campaign "${values.name}" was saved but couldn't launch on Meta — ads_management permission isn't granted yet. It's saved as a draft; reconnect with ads permission to push it live.`
      );
    }
  }
}

export async function updateAdCampaignStatus(
  id: string,
  status: "draft" | "active" | "paused" | "completed" | "archived"
): Promise<ActionResult> {
  const { user, orgId, supabase } = await getSessionContext();
  if (!user || !orgId) return { error: "Unauthorized" };

  const { data: campaign } = await supabase
    .from("ad_campaigns")
    .select("management_mode, platform, social_account_id, external_campaign_id")
    .eq("id", id)
    .eq("org_id", orgId)
    .single();
  if (!campaign) return { error: "Campaign not found" };

  // Live mode + already launched + toggling active/paused: push the status
  // change to Meta too, so the app and the real ad don't drift apart.
  if (
    campaign.management_mode === "live" &&
    campaign.external_campaign_id &&
    campaign.social_account_id &&
    (status === "active" || status === "paused")
  ) {
    const adapter = adapterFor(campaign.platform);
    if (adapter) {
      try {
        const { tokens } = await getAccountTokens(campaign.social_account_id);
        await adapter.setStatus(campaign.external_campaign_id, status, tokens.accessToken);
      } catch (e) {
        return {
          error:
            e instanceof Error
              ? `Saved locally, but Meta rejected the status change: ${e.message}`
              : "Saved locally, but the live status change failed",
        };
      }
    }
  }

  const { error } = await supabase
    .from("ad_campaigns")
    .update({ status })
    .eq("id", id)
    .eq("org_id", orgId);
  if (error) return { error: friendlyActionError(error) };

  revalidatePath("/ads");
  revalidatePath(`/ads/${id}`);
  return { id };
}

/** Manual performance entry — the only way internal-mode campaigns get numbers. */
export async function recordAdPerformance(
  campaignId: string,
  values: {
    spend: number | null;
    impressions: number | null;
    clicks: number | null;
    conversions: number | null;
    note: string | null;
  }
): Promise<ActionResult> {
  const { user, orgId, supabase } = await getSessionContext();
  if (!user || !orgId) return { error: "Unauthorized" };

  const { error } = await supabase.from("ad_performance_snapshots").insert({
    org_id: orgId,
    campaign_id: campaignId,
    spend: values.spend,
    impressions: values.impressions,
    clicks: values.clicks,
    conversions: values.conversions,
    source: "manual",
    note: values.note,
  });
  if (error) return { error: friendlyActionError(error) };

  revalidatePath(`/ads/${campaignId}`);
  return {};
}

/** Live mode: pull fresh numbers from Meta instead of entering them by hand. */
export async function syncLiveAdPerformance(campaignId: string): Promise<ActionResult> {
  const { user, orgId, supabase } = await getSessionContext();
  if (!user || !orgId) return { error: "Unauthorized" };

  const { data: campaign } = await supabase
    .from("ad_campaigns")
    .select("platform, social_account_id, external_campaign_id")
    .eq("id", campaignId)
    .eq("org_id", orgId)
    .single();
  if (!campaign) return { error: "Campaign not found" };
  if (!campaign.external_campaign_id || !campaign.social_account_id) {
    return { error: "This campaign hasn't launched on Meta yet — nothing to sync." };
  }
  const adapter = adapterFor(campaign.platform);
  if (!adapter) return { error: `Live sync isn't supported for ${campaign.platform}.` };

  try {
    const { tokens } = await getAccountTokens(campaign.social_account_id);
    const perf = await adapter.fetchPerformance(
      campaign.external_campaign_id,
      tokens.accessToken
    );
    await supabase.from("ad_performance_snapshots").insert({
      org_id: orgId,
      campaign_id: campaignId,
      spend: perf.spend,
      impressions: perf.impressions,
      clicks: perf.clicks,
      conversions: perf.conversions,
      source: "api",
    });
    await supabase
      .from("ad_campaigns")
      .update({ last_synced_at: new Date().toISOString(), last_sync_error: null })
      .eq("id", campaignId);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed";
    await supabase
      .from("ad_campaigns")
      .update({ last_sync_error: message.slice(0, 500) })
      .eq("id", campaignId);
    return { error: message };
  }

  revalidatePath(`/ads/${campaignId}`);
  return {};
}

export async function deleteAdCampaign(id: string): Promise<ActionResult> {
  const { user, orgId, supabase } = await getSessionContext();
  if (!user || !orgId) return { error: "Unauthorized" };

  const { error } = await supabase
    .from("ad_campaigns")
    .delete()
    .eq("id", id)
    .eq("org_id", orgId);
  if (error) return { error: friendlyActionError(error) };

  revalidatePath("/ads");
  return {};
}