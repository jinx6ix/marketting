"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { syncAccountNow } from "@/features/settings/actions";
import { cn } from "@/lib/utils";

export function SyncNowButton({ accountId }: { accountId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justSynced, setJustSynced] = useState(false);

  return (
    <div className="flex items-center gap-1.5">
      {error && <span className="text-xs text-destructive">{error}</span>}
      {justSynced && !error && (
        <span className="text-xs text-success">Synced</span>
      )}
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        title="Fetch fresh metrics for this account now, instead of waiting for the next scheduled sync"
        onClick={() => {
          setError(null);
          setJustSynced(false);
          startTransition(async () => {
            const result = await syncAccountNow(accountId);
            if (result.error) setError(result.error);
            else setJustSynced(true);
          });
        }}
      >
        <RefreshCw className={cn("size-3.5", pending && "animate-spin")} />
        {pending ? "Syncing…" : "Sync now"}
      </Button>
    </div>
  );
}