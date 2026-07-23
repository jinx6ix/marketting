import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Per-org daily cap on AI calls so a runaway client can't burn the
 * provider keys. Uses the service-role increment_ai_usage() RPC
 * (migration 0009); counts atomically per org per UTC day.
 */
export async function checkAiQuota(
  orgId: string
): Promise<{ ok: true } | { ok: false; limit: number }> {
  const limit = Number(process.env.AI_DAILY_LIMIT ?? 200);
  if (!Number.isFinite(limit) || limit <= 0) return { ok: true };

  const admin = createAdminClient();
  const { data: calls, error } = await admin.rpc("increment_ai_usage", {
    p_org: orgId,
  });
  // Fail open: metering must never take AI features down.
  if (error || typeof calls !== "number") return { ok: true };

  return calls <= limit ? { ok: true } : { ok: false, limit };
}
