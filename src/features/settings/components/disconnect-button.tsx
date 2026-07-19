"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";

export function DisconnectButton({
  platform,
  accountId,
  label,
}: {
  platform: string;
  accountId: string;
  label: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-destructive">{error}</span>}
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        className="text-destructive hover:text-destructive"
        onClick={() => {
          if (!confirm(`Disconnect ${label}? Scheduled posts to it will fail.`))
            return;
          setError(null);
          startTransition(async () => {
            const res = await fetch(`/api/social/${platform}/disconnect`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ accountId }),
            });
            if (!res.ok) {
              const body = (await res.json().catch(() => ({}))) as {
                error?: string;
              };
              setError(body.error ?? "Disconnect failed");
            } else {
              router.refresh();
            }
          });
        }}
      >
        <Unplug /> Disconnect
      </Button>
    </div>
  );
}
