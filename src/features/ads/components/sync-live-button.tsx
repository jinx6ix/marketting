"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { syncLiveAdPerformance } from "@/features/ads/actions";
import { cn } from "@/lib/utils";

export function SyncLiveButton({ campaignId }: { campaignId: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-destructive">{error}</span>}
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        className="gap-1.5"
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await syncLiveAdPerformance(campaignId);
            if (result.error) setError(result.error);
          })
        }
      >
        <RefreshCw className={cn("size-3.5", pending && "animate-spin")} />
        {pending ? "Syncing…" : "Sync from Meta"}
      </Button>
    </div>
  );
}