"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { recordAdPerformance } from "@/features/ads/actions";

export function RecordPerformanceForm({ campaignId }: { campaignId: string }) {
  const [pending, startTransition] = useTransition();
  const [spend, setSpend] = useState("");
  const [impressions, setImpressions] = useState("");
  const [clicks, setClicks] = useState("");
  const [conversions, setConversions] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await recordAdPerformance(campaignId, {
        spend: spend ? Number(spend) : null,
        impressions: impressions ? Number(impressions) : null,
        clicks: clicks ? Number(clicks) : null,
        conversions: conversions ? Number(conversions) : null,
        note: null,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setSpend("");
      setImpressions("");
      setClicks("");
      setConversions("");
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Spend</Label>
          <Input value={spend} onChange={(e) => setSpend(e.target.value)} type="number" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Impressions</Label>
          <Input value={impressions} onChange={(e) => setImpressions(e.target.value)} type="number" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Clicks</Label>
          <Input value={clicks} onChange={(e) => setClicks(e.target.value)} type="number" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Conversions</Label>
          <Input value={conversions} onChange={(e) => setConversions(e.target.value)} type="number" />
        </div>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button size="sm" disabled={pending} onClick={submit}>
        {pending ? "Saving…" : "Add entry"}
      </Button>
    </div>
  );
}