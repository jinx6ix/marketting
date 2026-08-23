import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendAlert } from "@/lib/alerts";
import { runJob } from "./runner";

const STALE_MINUTES = 20;
const STALE_MESSAGE =
  "Reaped: no completion within 20 minutes — the worker process (npm run worker locally, or the cron caller in production) likely stopped or crashed mid-run.";

/**
 * Sweep job_runs rows left permanently on "running" (finished_at IS NULL)
 * because the process executing them died mid-run — e.g. `npm run worker`
 * killed by closing the terminal / the machine sleeping, or a serverless
 * function hitting its platform timeout. Every other job in this app
 * (publish, ai strategy generation) already has this kind of reaper for
 * its own domain rows; job_runs itself didn't, so a dead worker left a
 * misleading permanent "running…" badge on Settings → Jobs with no
 * indication anything was wrong.
 *
 * 20 minutes comfortably exceeds the longest legitimate single run today
 * (publish, which can wait up to ~6 min per Instagram video inside a
 * 300s-budgeted route) while still surfacing a dead worker reasonably
 * quickly.
 */
export async function reapStaleJobRuns(
  staleMs: number = STALE_MINUTES * 60_000
): Promise<ReturnType<typeof runJob>> {
  return runJob("stale-job-runs", async () => {
    const admin = createAdminClient();
    const cutoff = new Date(Date.now() - staleMs).toISOString();

    const { data: updated, error } = await admin
      .from("job_runs")
      .update({
        finished_at: new Date().toISOString(),
        ok: false,
        error: STALE_MESSAGE,
      })
      .is("finished_at", null)
      .lt("started_at", cutoff)
      .select("id, job");
    if (error) throw new Error(error.message);

    if (updated && updated.length > 0) {
      // This reaper only ever runs because SOMETHING is currently able to
      // fire it — so a clean sweep here doesn't mean the worker is
      // healthy overall, it means it recovered enough to run this one
      // job. Worth flagging every time regardless: repeated crashes are
      // exactly the pattern that left targets stuck "publishing" for
      // hours with nobody noticing earlier.
      const jobNames = [...new Set(updated.map((u) => u.job))].join(", ");
      await sendAlert(
        `🪦 ${updated.length} job run(s) were stuck with no completion in ${
          staleMs / 60_000
        } minutes and got reaped: ${jobNames}. The worker process likely crashed or was killed mid-run — worth checking why.`
      );
    }

    return updated?.length ?? 0;
  });
}