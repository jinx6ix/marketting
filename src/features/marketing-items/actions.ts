"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/supabase/server";
import { friendlyActionError } from "@/lib/jobs/action-errors";
import { itemFormSchema, type ItemFormValues } from "./schemas";
import { publishDue } from "@/lib/jobs/publish";
import type { Json } from "@/types/database";

export interface ActionResult {
  error?: string;
  id?: string;
}

export async function createItem(values: ItemFormValues): Promise<ActionResult> {
  const { user, orgId, supabase } = await getSessionContext();
  if (!user || !orgId) return { error: "Unauthorized" };

  const parsed = itemFormSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;

  const status = v.scheduled_at ? "scheduled" : "draft";

  const { data: item, error } = await supabase
    .from("marketing_items")
    .insert({
      org_id: orgId,
      campaign_id: v.campaign_id ?? null,
      type: v.type,
      title: v.title,
      body: v.body,
      media: v.media as unknown as Json,
      promo: (v.promo ?? null) as Json,
      hashtags: v.hashtags,
      destination: v.destination || null,
      status,
      scheduled_at: v.scheduled_at ?? null,
      timezone: v.timezone ?? null,
      ai_generated: v.ai_generated,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !item)
    return { error: friendlyActionError(error, "Insert failed") };

  if (v.targets.length > 0) {
    const { error: targetError } = await supabase.from("post_targets").insert(
      v.targets.map((t) => ({
        org_id: orgId,
        item_id: item.id,
        social_account_id: t.social_account_id,
        platform: t.platform as never,
        variant_body: t.variant_body ?? null,
      }))
    );
    if (targetError) return { error: friendlyActionError(targetError) };
  }

  revalidatePath("/items");
  revalidatePath("/calendar");
  return { id: item.id };
}

export async function updateItem(
  id: string,
  values: ItemFormValues
): Promise<ActionResult> {
  const { user, orgId, supabase } = await getSessionContext();
  if (!user || !orgId) return { error: "Unauthorized" };

  const parsed = itemFormSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;

  // Only draft/scheduled/failed items can be edited.
  const { data: existing } = await supabase
    .from("marketing_items")
    .select("status")
    .eq("id", id)
    .single();
  if (!existing) return { error: "Item not found" };
  if (!["draft", "scheduled", "failed"].includes(existing.status)) {
    return { error: `Cannot edit an item with status "${existing.status}"` };
  }

  const status = v.scheduled_at ? "scheduled" : "draft";

  const { error } = await supabase
    .from("marketing_items")
    .update({
      campaign_id: v.campaign_id ?? null,
      type: v.type,
      title: v.title,
      body: v.body,
      media: v.media as unknown as Json,
      promo: (v.promo ?? null) as Json,
      hashtags: v.hashtags,
      destination: v.destination || null,
      status,
      scheduled_at: v.scheduled_at ?? null,
      timezone: v.timezone ?? null,
    })
    .eq("id", id);
  if (error) return { error: friendlyActionError(error) };

  // Reconcile targets: delete unpublished ones, re-insert current selection.
  await supabase
    .from("post_targets")
    .delete()
    .eq("item_id", id)
    .in("status", ["pending", "queued", "failed", "skipped"]);

  if (v.targets.length > 0) {
    const { data: keep } = await supabase
      .from("post_targets")
      .select("social_account_id")
      .eq("item_id", id);
    const kept = new Set((keep ?? []).map((k) => k.social_account_id));
    const fresh = v.targets.filter((t) => !kept.has(t.social_account_id));
    if (fresh.length > 0) {
      const { error: targetError } = await supabase.from("post_targets").insert(
        fresh.map((t) => ({
          org_id: orgId,
          item_id: id,
          social_account_id: t.social_account_id,
          platform: t.platform as never,
          variant_body: t.variant_body ?? null,
        }))
      );
      if (targetError) return { error: friendlyActionError(targetError) };
    }
  }

  revalidatePath("/items");
  revalidatePath(`/items/${id}`);
  revalidatePath("/calendar");
  return { id };
}

export async function deleteItem(id: string): Promise<ActionResult> {
  const { user, orgId, supabase } = await getSessionContext();
  if (!user || !orgId) return { error: "Unauthorized" };

  const { error } = await supabase.from("marketing_items").delete().eq("id", id);
  if (error) return { error: friendlyActionError(error) };

  revalidatePath("/items");
  revalidatePath("/calendar");
  redirect("/items");
}

/** Editor hands a draft to owners/admins for sign-off. */
export async function submitForReview(id: string): Promise<ActionResult> {
  const { user, orgId, supabase } = await getSessionContext();
  if (!user || !orgId) return { error: "Unauthorized" };

  const { error } = await supabase
    .from("marketing_items")
    .update({ status: "in_review" })
    .eq("id", id)
    .eq("org_id", orgId)
    .in("status", ["draft", "failed"]);
  if (error) return { error: friendlyActionError(error) };

  revalidatePath("/items");
  revalidatePath(`/items/${id}`);
  return { id };
}

async function requireApprover(): Promise<
  { error: string } | { orgId: string; supabase: Awaited<ReturnType<typeof getSessionContext>>["supabase"] }
> {
  const { user, orgId, supabase } = await getSessionContext();
  if (!user || !orgId) return { error: "Unauthorized" };
  const { data: membership } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .single();
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return { error: "Only owners and admins can review items" };
  }
  return { orgId, supabase };
}

/** Approve: scheduled if it has a publish time, otherwise back to draft. */
export async function approveItem(id: string): Promise<ActionResult> {
  const ctx = await requireApprover();
  if ("error" in ctx) return { error: ctx.error };

  const { data: item } = await ctx.supabase
    .from("marketing_items")
    .select("scheduled_at, status")
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .single();
  if (!item) return { error: "Item not found" };
  if (item.status !== "in_review") return { error: "Item is not in review" };

  const { error } = await ctx.supabase
    .from("marketing_items")
    .update({ status: item.scheduled_at ? "scheduled" : "draft" })
    .eq("id", id);
  if (error) return { error: friendlyActionError(error) };

  revalidatePath("/items");
  revalidatePath(`/items/${id}`);
  revalidatePath("/calendar");
  return { id };
}

export async function requestChanges(id: string): Promise<ActionResult> {
  const ctx = await requireApprover();
  if ("error" in ctx) return { error: ctx.error };

  const { error } = await ctx.supabase
    .from("marketing_items")
    .update({ status: "draft" })
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .eq("status", "in_review");
  if (error) return { error: friendlyActionError(error) };

  revalidatePath("/items");
  revalidatePath(`/items/${id}`);
  return { id };
}

export async function rescheduleItem(
  id: string,
  scheduledAt: string | null
): Promise<ActionResult> {
  const { user, orgId, supabase } = await getSessionContext();
  if (!user || !orgId) return { error: "Unauthorized" };

  const { error } = await supabase
    .from("marketing_items")
    .update({
      scheduled_at: scheduledAt,
      status: scheduledAt ? "scheduled" : "draft",
    })
    .eq("id", id)
    .in("status", ["draft", "scheduled", "failed"]);
  if (error) return { error: friendlyActionError(error) };

  revalidatePath("/calendar");
  revalidatePath("/items");
  return { id };
}

export interface PublishNowResult extends ActionResult {
  queued?: number;
  alreadyPublished?: number;
}

/**
 * Queue item(s) for immediate publishing. Sets the item to `scheduled` at `now`
 * and resets its targets (only the unpublished / failed / skipped ones) to
 * `pending`. The existing `* * * * *` cron worker picks them up on the next
 * tick — no separate code path needed.
 *
 * Available to all org members who can view the item (RLS read).
 */
export async function publishNow(id: string): Promise<PublishNowResult> {
  const { user, orgId, supabase } = await getSessionContext();
  if (!user || !orgId) return { error: "Unauthorized" };

  const { data: item } = await supabase
    .from("marketing_items")
    .select("status")
    .eq("id", id)
    .eq("org_id", orgId)
    .single();
  if (!item) return { error: "Item not found" };

  if (item.status === "publishing" || item.status === "archived") {
    return { error: `Cannot publish an item with status "${item.status}"` };
  }

  const isPartial = ["failed", "partially_published"].includes(item.status);

  const { data: targets } = await supabase
    .from("post_targets")
    .select("id, status")
    .eq("item_id", id);
  if (!targets || targets.length === 0) {
    return {
      error:
        "This item has no saved publish targets. Select accounts under “Publish to” and save (or use “Save & publish now”).",
    };
  }

  const eligibleIds = isPartial
    ? targets
        .filter((t) => ["failed", "skipped"].includes(t.status))
        .map((t) => t.id)
    : targets
        .filter((t) => t.status !== "published")
        .map((t) => t.id);

  if (eligibleIds.length === 0) {
    return { error: "Nothing to publish — all targets are already published" };
  }

  const alreadyPublished = targets.filter((t) => t.status === "published").length;

  const nowIso = new Date().toISOString();

  const { error: itemErr } = await supabase
    .from("marketing_items")
    .update({
      status: "scheduled",
      scheduled_at: nowIso,
    })
    .eq("id", id)
    .in("status", [
      "draft",
      "scheduled",
      "in_review",
      "failed",
      "partially_published",
    ]);
  if (itemErr) return { error: friendlyActionError(itemErr) };

  await supabase
    .from("post_targets")
    .update({
      status: "pending",
      retry_count: 0,
      next_retry_at: null,
      error: null,
    })
    .eq("item_id", id)
    .in("id", eligibleIds)
    .in("status", ["pending", "queued", "failed", "skipped"]);

  revalidatePath("/items");
  revalidatePath(`/items/${id}`);
  revalidatePath("/calendar");

  // Fire immediately — don't wait for the next cron tick.
  publishDue().catch(() => null);

  return { id, queued: eligibleIds.length, alreadyPublished };
}
