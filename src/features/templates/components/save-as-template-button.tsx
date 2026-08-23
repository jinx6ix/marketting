"use client";

import { useState, useTransition } from "react";
import { BookmarkPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveAsTemplate } from "@/features/templates/actions";

export function SaveAsTemplateButton({ itemId }: { itemId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className="gap-1.5">
        <BookmarkPlus className="size-3.5" /> Save as template
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Template name…"
        className="h-8 w-44 text-sm"
        autoFocus
      />
      <Button
        size="sm"
        disabled={pending || !name.trim()}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await saveAsTemplate(itemId, name);
            if (result.error) setError(result.error);
            else {
              setSaved(true);
              setOpen(false);
            }
          })
        }
      >
        {pending ? "Saving…" : "Save"}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
      {saved && <span className="text-xs text-success">Saved</span>}
    </div>
  );
}