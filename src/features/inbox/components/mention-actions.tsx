"use client";

import { useTransition } from "react";
import { Check, MailOpen, Reply, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  markMentionRead,
  markMentionReplied,
} from "@/features/inbox/actions";

export function MentionActions({
  id,
  isRead,
  replied,
}: {
  id: string;
  isRead: boolean;
  replied: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        title={isRead ? "Mark as unread" : "Mark as read"}
        onClick={() => startTransition(() => markMentionRead(id, !isRead).then(() => {}))}
      >
        {isRead ? <Undo2 /> : <MailOpen />}
        {isRead ? "Unread" : "Read"}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        title={replied ? "Marked as replied" : "Mark as replied"}
        onClick={() =>
          startTransition(() => markMentionReplied(id, !replied).then(() => {}))
        }
      >
        {replied ? <Check /> : <Reply />}
        {replied ? "Replied" : "Reply done"}
      </Button>
    </div>
  );
}

export function MarkAllReadButton({ disabled }: { disabled: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={disabled || pending}
      onClick={() =>
        startTransition(async () => {
          const { markAllMentionsRead } = await import("@/features/inbox/actions");
          await markAllMentionsRead();
        })
      }
    >
      <MailOpen /> Mark all read
    </Button>
  );
}
