import "server-only";
import type { Platform } from "@/types/database";

/**
 * In-memory token buckets per platform. Serverless instances each get their
 * own bucket — budgets below are set conservatively enough that N instances
 * still stay under real platform limits. 429 retryAfterMs from the API is
 * always honored on top of this.
 */

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();

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

const blockedUntil = new Map<Platform, number>();

export function markRateLimited(platform: Platform, retryAfterMs: number): void {
  blockedUntil.set(platform, Date.now() + retryAfterMs);
}

export function isBlocked(platform: Platform): boolean {
  const until = blockedUntil.get(platform);
  if (!until) return false;
  if (Date.now() >= until) {
    blockedUntil.delete(platform);
    return false;
  }
  return true;
}

/** Take one request slot; returns false if the budget is exhausted. */
export function tryAcquire(platform: Platform): boolean {
  if (isBlocked(platform)) return false;

  const budget = BUDGETS[platform];
  const now = Date.now();
  let bucket = buckets.get(platform);
  if (!bucket) {
    bucket = { tokens: budget, lastRefill: now };
    buckets.set(platform, bucket);
  }
  // refill continuously
  const elapsed = (now - bucket.lastRefill) / 60_000;
  bucket.tokens = Math.min(budget, bucket.tokens + elapsed * budget);
  bucket.lastRefill = now;

  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

/** Exponential retry schedule for failed publishes: 1m, 5m, 30m. */
export function nextRetryAt(retryCount: number): Date | null {
  const delays = [60_000, 5 * 60_000, 30 * 60_000];
  if (retryCount >= delays.length) return null;
  return new Date(Date.now() + delays[retryCount]);
}
