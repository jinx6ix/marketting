import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/** Wrap a job with job_runs observability. */
export async function runJob(
  job: string,
  fn: () => Promise<number>
): Promise<{ ok: boolean; itemsProcessed: number; error?: string }> {
  const admin = createAdminClient();
  const { data: run } = await admin
    .from("job_runs")
    .insert({ job })
    .select("id")
    .single();

  try {
    const itemsProcessed = await fn();
    if (run) {
      await admin
        .from("job_runs")
        .update({
          finished_at: new Date().toISOString(),
          ok: true,
          items_processed: itemsProcessed,
        })
        .eq("id", run.id);
    }
    return { ok: true, itemsProcessed };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    if (run) {
      await admin
        .from("job_runs")
        .update({
          finished_at: new Date().toISOString(),
          ok: false,
          error: error.slice(0, 1000),
        })
        .eq("id", run.id);
    }
    return { ok: false, itemsProcessed: 0, error };
  }
}
