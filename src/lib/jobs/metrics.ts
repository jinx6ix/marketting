import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAdapter } from "@/lib/social/registry";
import { getAccountTokens } from "@/lib/social/accounts";
import { tryAcquire, markRateLimited } from "./rate-limit";
import { SocialApiError } from "@/lib/social/types";
import { runJob } from "./runner";
import type { Platform, Json } from "@/types/database";

/**
 * Metrics job (every 30 min): snapshot account metrics round-robin
 * (least recently polled first), plus post metrics for recent posts
 * with decaying cadence (hourly first 48h, then daily).
 */
export async function collectMetrics(): Promise<ReturnType<typeof runJob>> {
  return runJob("metrics", async () => {
    const admin = createAdminClient();
    let processed = 0;

    const { data: accounts } = await admin
      .from("social_accounts")
      .select("id, org_id, platform, metadata")
      .eq("status", "active")
      .limit(50);

    // least-recently-polled first
    const sorted = (accounts ?? []).sort((a, b) => {
      const ap = ((a.metadata as { last_polled?: string })?.last_polled) ?? "";
      const bp = ((b.metadata as { last_polled?: string })?.last_polled) ?? "";
      return ap.localeCompare(bp);
    });

    for (const acc of sorted) {
      const platform = acc.platform as Platform;
      if (!tryAcquire(platform)) continue;

      try {
        const { account, tokens } = await getAccountTokens(acc.id);
        const adapter = getAdapter(platform);
        if (!adapter.capabilities.accountMetrics) continue;

        const m = await adapter.fetchAccountMetrics(tokens, account);
        await admin.from("account_metric_snapshots").insert({
          org_id: acc.org_id,
          social_account_id: acc.id,
          followers: m.followers ?? null,
          following: m.following ?? null,
          posts_count: m.postsCount ?? null,
          impressions: m.impressions ?? null,
          reach: m.reach ?? null,
          profile_views: m.profileViews ?? null,
          engagement_total: m.engagementTotal ?? null,
          raw: (m.raw ?? null) as Json,
        });
        await admin
          .from("social_accounts")
          .update({
            metadata: {
              ...(acc.metadata as Record<string, unknown>),
              last_polled: new Date().toISOString(),
            } as Json,
          })
          .eq("id", acc.id);
        processed++;
      } catch (e) {
        if (e instanceof SocialApiError && e.retryAfterMs) {
          markRateLimited(platform, e.retryAfterMs);
        }
        // token problems → flag account
        if (e instanceof SocialApiError && e.code.startsWith("http_401")) {
          await admin
            .from("social_accounts")
            .update({ status: "expired" })
            .eq("id", acc.id);
        }
      }
    }

    // Post metrics: published in last 30 days, decaying cadence.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString();
    const { data: targets } = await admin
      .from("post_targets")
      .select("id, org_id, platform, social_account_id, external_post_id, published_at")
      .eq("status", "published")
      .not("external_post_id", "is", null)
      .gte("published_at", thirtyDaysAgo)
      .limit(100);

    for (const target of targets ?? []) {
      const platform = target.platform as Platform;
      const ageHours =
        (Date.now() - new Date(target.published_at!).getTime()) / 3600_000;

      // decaying cadence: skip if we already have a fresh-enough snapshot
      const { data: latest } = await admin
        .from("post_metric_snapshots")
        .select("captured_at")
        .eq("post_target_id", target.id)
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest) {
        const snapshotAgeHours =
          (Date.now() - new Date(latest.captured_at).getTime()) / 3600_000;
        const requiredGap = ageHours <= 48 ? 1 : 24;
        if (snapshotAgeHours < requiredGap) continue;
      }

      if (!tryAcquire(platform)) continue;

      try {
        const { account, tokens } = await getAccountTokens(
          target.social_account_id
        );
        const adapter = getAdapter(platform);
        if (!adapter.capabilities.postMetrics) continue;

        const m = await adapter.fetchPostMetrics(
          tokens,
          account,
          target.external_post_id!
        );
        const engagement =
          (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) + (m.saves ?? 0);
        await admin.from("post_metric_snapshots").insert({
          org_id: target.org_id,
          post_target_id: target.id,
          likes: m.likes ?? null,
          comments: m.comments ?? null,
          shares: m.shares ?? null,
          saves: m.saves ?? null,
          impressions: m.impressions ?? null,
          reach: m.reach ?? null,
          video_views: m.videoViews ?? null,
          engagement_rate:
            m.engagementRate ??
            (m.impressions ? (engagement / m.impressions) * 100 : null),
          raw: (m.raw ?? null) as Json,
        });
        processed++;
      } catch (e) {
        if (e instanceof SocialApiError && e.retryAfterMs) {
          markRateLimited(platform, e.retryAfterMs);
        }
      }
    }

    return processed;
  });
}
