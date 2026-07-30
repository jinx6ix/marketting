import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Platform } from "@/types/database";

/**
 * DB-backed per-platform rate limiting (migration 0012). All serverless
 * instances share one fixed 1-minute window per platform, and 429 backoffs
 * from the APIs are honored globally. Fails open on DB errors — metering
 * must never take publishing down.
 */

/** requests per minute budget per platform (conservative) */
const BUDGETS: Record<Platform, number> = {
  facebook: 60,
  instagram: 60,
  x: 10,
  tiktok: 30,
  youtube: 30,
  linkedin: 30,
  pinterest: 60,
};

export async function markRateLimited(
  platform: Platform,
  retryAfterMs: number
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .rpc("mark_platform_rate_limited", {
      p_platform: platform,
      p_until: new Date(Date.now() + retryAfterMs).toISOString(),
    })
    .then(() => undefined)
    .catch(() => undefined);
}

/** Take one request slot; returns false if blocked or budget exhausted. */
export async function tryAcquire(platform: Platform): Promise<boolean> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("try_acquire_platform_slot", {
    p_platform: platform,
    p_budget: BUDGETS[platform],
  });
  if (error) return true; // fail open
  return data === true;
}

/** Exponential retry schedule for failed publishes: 1m, 5m, 30m. */
export function nextRetryAt(retryCount: number): Date | null {
  const delays = [60_000, 5 * 60_000, 30 * 60_000];
  if (retryCount >= delays.length) return null;
  return new Date(Date.now() + delays[retryCount]);
}
