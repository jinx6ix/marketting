"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Subscribes to Postgres changes on a table (scoped to the org) and refreshes
 * the current server-component page when rows change. Tables must be in the
 * supabase_realtime publication (mentions and post_targets are — see
 * migration 0007).
 */
export function RealtimeRefresher({
  table,
  orgId,
}: {
  table: "mentions" | "post_targets";
  orgId: string;
}) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`refresh-${table}-${orgId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter: `org_id=eq.${orgId}`,
        },
        () => {
          // Debounce bursts (e.g. the mentions job inserting many rows).
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => router.refresh(), 500);
        }
      )
      .subscribe();

    return () => {
      if (timer.current) clearTimeout(timer.current);
      void supabase.removeChannel(channel);
    };
  }, [table, orgId, router]);

  return null;
}
