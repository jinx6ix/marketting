"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { updateAdCampaignStatus } from "@/features/ads/actions";

const OPTIONS: { value: "draft" | "active" | "paused" | "completed" | "archived"; label: string }[] = [
  { value: "active", label: "Activate" },
  { value: "paused", label: "Pause" },
  { value: "completed", label: "Mark completed" },
  { value: "archived", label: "Archive" },
];

export function AdStatusControls({ id, status }: { id: string; status: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap gap-2">
      {OPTIONS.filter((o) => o.value !== status).map((o) => (
        <Button
          key={o.value}
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await updateAdCampaignStatus(id, o.value);
            })
          }
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}