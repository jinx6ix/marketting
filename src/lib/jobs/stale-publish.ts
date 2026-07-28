import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { runJob } from "./runner";
import { rollupItemStatus } from "./item-rollup";

const STALE_MINUTES = 15;
const STALE_MESSAGE = "Reaped after publish timeout (no worker completion within 15 minutes).";

/**
 * Sweep up post_targets stuck on `publishing` for too long. A worker that
 * crashed mid-publish or a network call that never returned would otherwise
 * leave rows permanently in `publishing`.
 *
 * Targets are flipped to `failed` (preserving `retry_count`) so the
 * normal retry/escalation story applies. The parent marketing_item is
 * then re-rolled-up.
 *
 * Threshold is 15 minutes — covers slow video uploads on YouTube/TikTok.
 */
export async function reapStalePublishes(
  staleMs: number = STALE_MINUTES * 60_000
): Promise<ReturnType<typeof runJob>> {
  return runJob("stale-publish", async () => {
    const admin = createAdminClient();
    const cutoff = new Date(Date.now() - staleMs).toISOString();

    const { data: stuck, error } = await admin
      .from("post_targets")
      .select("id, item_id, updated_at")
      .eq("status", "publishing")
      .lt("updated_at", cutoff);
    if (error) throw new Error(error.message);
    if (!stuck || stuck.length === 0) return 0;

    const ids = stuck.map((t) => t.id);
    const { data: updated, error: updErr } = await admin
      .from("post_targets")
      .update({
        status: "failed",
        error: STALE_MESSAGE,
        next_retry_at: null,
      })
      .in("id", ids)
      .eq("status", "publishing")
      .select("id, item_id");
    if (updErr) throw new Error(updErr.message);

    const touchedItems = new Set((updated ?? []).map((t) => t.item_id));
    for (const itemId of touchedItems) {
      await rollupItemStatus(itemId);
    }

    const orphaned = await reapOrphanedItems(admin, cutoff);

    return touchedItems.size + orphaned;
  });
}

/**
 * Sweep marketing_items stuck on `publishing` past the cutoff whose targets
 * no longer explain the status — e.g. an item whose targets were all deleted
 * (edit reconciliation) or that was flipped to `publishing` and orphaned.
 * Items with zero targets go back to `draft` (there is nothing to retry);
 * items whose targets are all in final states get a normal rollup.
 */
async function reapOrphanedItems(
  admin: ReturnType<typeof createAdminClient>,
  cutoffIso: string
): Promise<number> {
  const { data: items, error } = await admin
    .from("marketing_items")
    .select("id")
    .eq("status", "publishing")
    .lt("updated_at", cutoffIso);
  if (error) throw new Error(error.message);
  if (!items || items.length === 0) return 0;

  let reaped = 0;
  for (const item of items) {
    const { data: targets, error: tErr } = await admin
      .from("post_targets")
      .select("status")
      .eq("item_id", item.id);
    if (tErr) continue;

    if (!targets || targets.length === 0) {
      await admin
        .from("marketing_items")
        .update({ status: "draft" })
        .eq("id", item.id)
        .eq("status", "publishing");
      reaped++;
      continue;
    }

    const inFlight = targets.some((t) =>
      ["pending", "queued", "publishing"].includes(t.status)
    );
    if (!inFlight) {
      await rollupItemStatus(item.id);
      reaped++;
    }
  }
  return reaped;
}

/**
 * One-shot admin helper: same sweep, used by the recovery script and
 * useful when investigating incidents. Returns affected target ids.
 */
export async function resetStalePublishes(opts: {
  staleMs?: number;
  dryRun?: boolean;
} = {}): Promise<{ targetIds: string[]; itemIds: string[]; count: number }> {
  const admin = createAdminClient();
  const cutoff = new Date(
    Date.now() - (opts.staleMs ?? STALE_MINUTES * 60_000)
  ).toISOString();

  const { data: stuck, error } = await admin
    .from("post_targets")
    .select("id, item_id")
    .eq("status", "publishing")
    .lt("updated_at", cutoff);
  if (error) throw new Error(error.message);
  if (!stuck || stuck.length === 0) {
    return { targetIds: [], itemIds: [], count: 0 };
  }

  if (opts.dryRun) {
    return {
      targetIds: stuck.map((t) => t.id),
      itemIds: Array.from(new Set(stuck.map((t) => t.item_id))),
      count: stuck.length,
    };
  }

  const ids = stuck.map((t) => t.id);
  await admin
    .from("post_targets")
    .update({
      status: "failed",
      error: STALE_MESSAGE,
      next_retry_at: null,
    })
    .in("id", ids)
    .eq("status", "publishing");

  const itemIds = Array.from(new Set(stuck.map((t) => t.item_id)));
  for (const itemId of itemIds) {
    await rollupItemStatus(itemId);
  }

  return { targetIds: ids, itemIds, count: ids.length };
}
