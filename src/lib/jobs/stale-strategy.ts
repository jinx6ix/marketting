import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { runJob } from "./runner";
import { generateStrategy } from "./strategy";
import { checkAiQuota } from "@/lib/ai/quota";

const STALE_MINUTES = 10;
const STALE_MESSAGE =
  "Reaped after generation timeout (no completion within 10 minutes).";

/**
 * Sweep ai_strategies stuck on `running` for too long, and automatically
 * kick off one fresh attempt per affected org.
 *
 * generateStrategy() sets status='running' up front and only flips it to
 * completed/failed inside a try/catch around the snapshot + LLM call. If the
 * /api/ai/strategy route (maxDuration=300s) is killed by a serverless
 * timeout, crash, or hung network call, that catch block never runs and the
 * row is orphaned on `running` forever — mirrors why stale-publish.ts exists
 * for post_targets.
 *
 * Threshold is 10 minutes — comfortably past the route's 300s (5 min) cap.
 *
 * Auto-retry mirrors retry-partial.ts: don't just flag the failure, attempt
 * a real fix. It's naturally throttled to at most one regeneration per org
 * per sweep (deduped below) and respects the daily AI quota, so a org whose
 * generation systemically times out gets retried at most once per
 * STALE_MINUTES window rather than spiraling.
 */
export async function reapStaleStrategies(
  staleMs: number = STALE_MINUTES * 60_000
): Promise<ReturnType<typeof runJob>> {
  return runJob("stale-strategy", async () => {
    const admin = createAdminClient();
    const cutoff = new Date(Date.now() - staleMs).toISOString();

    const { data: stuck, error: selErr } = await admin
      .from("ai_strategies")
      .select("id, org_id, created_by")
      .eq("status", "running")
      .lt("created_at", cutoff);
    if (selErr) throw new Error(selErr.message);
    if (!stuck || stuck.length === 0) return 0;

    const ids = stuck.map((s) => s.id);
    const { data: updated, error: updErr } = await admin
      .from("ai_strategies")
      .update({
        status: "failed",
        error: STALE_MESSAGE,
      })
      .in("id", ids)
      .eq("status", "running")
      .select("id, org_id, created_by");
    if (updErr) throw new Error(updErr.message);
    if (!updated || updated.length === 0) return 0;

    // One regeneration attempt per distinct org, even if multiple stuck
    // rows belong to the same org.
    const seenOrgs = new Set<string>();
    for (const row of updated) {
      if (seenOrgs.has(row.org_id)) continue;
      seenOrgs.add(row.org_id);

      const quota = await checkAiQuota(row.org_id);
      if (!quota.ok) continue; // daily cap hit — don't auto-retry past it

      try {
        await generateStrategy(row.org_id, row.created_by);
      } catch {
        // A failed retry already left its own `failed` row with an error
        // (or will be reaped again next sweep if it hangs) — the sweep
        // itself must keep going for other orgs.
      }
    }

    return updated.length;
  });
}