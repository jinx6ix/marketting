"use client";

import { useState, useTransition } from "react";
import { Send, RotateCcw } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { publishNow } from "@/features/marketing-items/actions";

export interface PublishNowButtonProps {
  itemId: string;
  label?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  icon?: "send" | "retry";
  className?: string;
}

/**
 * User-triggered publish: queues the item (or its failed targets) for
 * immediate publishing. The existing minute-cron worker picks them up on
 * the next tick, so this stays consistent with the regular scheduler.
 */
export function PublishNowButton({
  itemId,
  label,
  variant = "default",
  size = "sm",
  icon = "send",
  className,
}: PublishNowButtonProps) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null
  );

  const Icon = icon === "retry" ? RotateCcw : Send;

  function onClick() {
    setMsg(null);
    startTransition(async () => {
      const result = await publishNow(itemId);
      if (result.error) {
        setMsg({ kind: "err", text: result.error });
        return;
      }
      const queued = result.queued ?? 0;
      const already = result.alreadyPublished ?? 0;
      const suffix =
        already > 0
          ? ` (${queued} of ${queued + already} targets republished)`
          : ` (${queued} target${queued === 1 ? "" : "s"})`;
      setMsg({
        kind: "ok",
        text: `Queued — publishing on the next worker tick${suffix}.`,
      });
    });
  }

  return (
    <span className={className}>
      <span className="inline-flex items-center gap-2">
        <Button
          type="button"
          variant={variant}
          size={size}
          disabled={pending}
          onClick={onClick}
        >
          <Icon />
          {label ?? "Publish now"}
        </Button>
        {msg && (
          <span
            className={
              msg.kind === "err"
                ? "text-xs text-destructive"
                : "text-xs text-muted-foreground"
            }
          >
            {msg.text}
          </span>
        )}
      </span>
    </span>
  );
}
