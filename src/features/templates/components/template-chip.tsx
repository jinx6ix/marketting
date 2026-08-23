"use client";

import { useTransition } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { deleteTemplate } from "@/features/templates/actions";
import { cn } from "@/lib/utils";

export function TemplateChip({
  id,
  name,
  active,
}: {
  id: string;
  name: string;
  active: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs",
        active ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"
      )}
    >
      <Link href={`/items/new?template=${id}`}>{name}</Link>
      <button
        type="button"
        aria-label={`Delete template ${name}`}
        disabled={pending}
        onClick={() => startTransition(() => deleteTemplate(id))}
        className="text-muted-foreground hover:text-destructive"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}