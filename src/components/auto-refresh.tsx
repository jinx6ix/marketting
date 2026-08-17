"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Polls `router.refresh()` on an interval while mounted. Meant to be
 * rendered conditionally (e.g. only while a strategy's status === "running")
 * so it naturally stops once the parent Server Component re-renders with a
 * different status and no longer includes this in the tree — no manual
 * "stop polling" logic needed.
 *
 * Deliberately polling rather than Postgres realtime here: ai_strategies
 * isn't in the supabase_realtime publication (see migration 0007), and
 * adding a whole table to that publication just for this one transient,
 * infrequent state felt like more moving parts than a plain interval for
 * a UI that's only ever open for a few minutes at most.
 */
export function AutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}