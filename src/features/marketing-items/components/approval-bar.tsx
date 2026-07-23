"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Send, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  approveItem,
  requestChanges,
  submitForReview,
} from "@/features/marketing-items/actions";

/**
 * Optional review workflow: editors submit drafts, owners/admins approve
 * (→ scheduled if it has a publish time) or send back for changes.
 */
export function ApprovalBar({
  itemId,
  status,
  canApprove,
}: {
  itemId: string;
  status: string;
  canApprove: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (action: (id: string) => Promise<{ error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await action(itemId);
      if (result.error) setError(result.error);
    });
  };

  if (status === "draft" || status === "failed") {
    return (
      <div className="flex items-center gap-3 rounded-md border bg-muted/30 px-3 py-2">
        <p className="flex-1 text-sm text-muted-foreground">
          Want a second pair of eyes before this goes out?
        </p>
        {error && <span className="text-xs text-destructive">{error}</span>}
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => run(submitForReview)}
        >
          <Send /> Submit for review
        </Button>
      </div>
    );
  }

  if (status === "in_review") {
    return (
      <div className="flex items-center gap-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
        <p className="flex-1 text-sm">
          {canApprove
            ? "This item is awaiting review."
            : "Awaiting review by an owner or admin."}
        </p>
        {error && <span className="text-xs text-destructive">{error}</span>}
        {canApprove && (
          <>
            <Button size="sm" disabled={pending} onClick={() => run(approveItem)}>
              <CheckCircle2 /> Approve
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => run(requestChanges)}
            >
              <Undo2 /> Request changes
            </Button>
          </>
        )}
      </div>
    );
  }

  return null;
}
