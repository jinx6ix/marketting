"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { refreshOrgMetrics } from "@/features/settings/actions";
import { cn } from "@/lib/utils";

export function RefreshDataButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-destructive">{error}</span>}
      {message && !error && (
        <span className="text-xs text-muted-foreground">{message}</span>
      )}
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        className="gap-1.5"
        onClick={() => {
          setError(null);
          setMessage(null);
          startTransition(async () => {
            const result = await refreshOrgMetrics();
            if (result.error) {
              setError(result.error);
              return;
            }
            setMessage(
              `Synced ${result.accountsSynced ?? 0} account${
                result.accountsSynced === 1 ? "" : "s"
              }, ${result.postsSynced ?? 0} post${result.postsSynced === 1 ? "" : "s"}`
            );
          });
        }}
      >
        <RefreshCw className={cn("size-3.5", pending && "animate-spin")} />
        {pending ? "Refreshing…" : "Refresh data"}
      </Button>
    </div>
  );
}