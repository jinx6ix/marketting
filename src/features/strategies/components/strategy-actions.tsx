"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, FileText, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  acceptRecommendation,
  dismissRecommendation,
} from "@/features/strategies/actions";

export function GenerateStrategyButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/strategy", { method: "POST" });
      const body = (await res.json()) as { strategyId?: string; error?: string };
      if (!res.ok || !body.strategyId) {
        setError(body.error ?? "Strategy generation failed");
      } else {
        router.push(`/strategies/${body.strategyId}`);
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      {error && <span className="text-sm text-destructive">{error}</span>}
      <Button onClick={generate} disabled={pending}>
        <Sparkles />
        {pending ? "Analyzing gaps…" : "Generate strategy"}
      </Button>
    </div>
  );
}

export function RecommendationActions({
  id,
  status,
  createdItemId,
}: {
  id: string;
  status: string;
  createdItemId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (status === "accepted" || status === "done") {
    return createdItemId ? (
      <Button
        variant="outline"
        size="sm"
        onClick={() => router.push(`/items/${createdItemId}`)}
      >
        <FileText /> View draft
      </Button>
    ) : null;
  }
  if (status === "dismissed") return null;

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-destructive">{error}</span>}
      <Button
        size="sm"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await acceptRecommendation(id);
            if (result.error) setError(result.error);
          });
        }}
      >
        <Check /> Accept
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await dismissRecommendation(id);
            if (result.error) setError(result.error);
          })
        }
      >
        <X /> Dismiss
      </Button>
    </div>
  );
}
