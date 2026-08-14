import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { runJob } from "./runner";
import { publishDue } from "./publish";

/**
 * Sweep marketing_items stuck on `partially_published` (some post_targets
 * published, some `failed` after exhausting the normal 1m/5m/30m retry
 * backoff) and give the failed targets a fresh retry window, then runs the
 * publish job immediately so they don't wait for the next scheduled tick.
 *
 * Runs every 5 minutes via /api/cron/retry-partial. Idempotent: if nothing
 * is stuck, it's a cheap no-op.
 */
export async function retryPartiallyPublished(): Promise<
  ReturnType<typeof runJob>
> {
  return runJob("retry-partial", async () => {
    const admin = createAdminClient();

    const { data: items, error } = await admin
      .from("marketing_items")
      .select("id")
      .eq("status", "partially_published");
    if (error) throw new Error(error.message);
    if (!items || items.length === 0) return 0;

    const itemIds = items.map((i) => i.id);

    const { data: failedTargets, error: tErr } = await admin
      .from("post_targets")
      .select("id, item_id")
      .in("item_id", itemIds)
      .eq("status", "failed");
    if (tErr) throw new Error(tErr.message);
    if (!failedTargets || failedTargets.length === 0) return 0;

    const targetIds = failedTargets.map((t) => t.id);

    // Reset to pending with a clean slate — this is an operator-driven
    // re-attempt, not a continuation of the original backoff sequence, so
    // retry_count resets and next_retry_at is cleared to make them due now.
    const { error: updErr } = await admin
      .from("post_targets")
      .update({
        status: "pending",
        error: null,
        retry_count: 0,
        next_retry_at: null,
      })
      .in("id", targetIds)
      .eq("status", "failed");
    if (updErr) throw new Error(updErr.message);

    // Move the parent items back to `publishing` so publishDue()'s
    // due-filter (item.status in scheduled|publishing, scheduled_at <= now)
    // picks them straight back up — scheduled_at is already in the past
    // since these items already published at least one target.
    const touchedItemIds = [...new Set(failedTargets.map((t) => t.item_id))];
    for (const id of touchedItemIds) {
      await admin
        .from("marketing_items")
        .update({ status: "publishing" })
        .eq("id", id)
        .eq("status", "partially_published");
    }

    // Publish immediately rather than waiting for the next per-minute
    // publish-due tick.
    await publishDue();

    return targetIds.length;
  });
}
