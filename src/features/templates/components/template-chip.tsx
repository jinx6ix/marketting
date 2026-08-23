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

  const handleDelete = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    
    try {
      await deleteTemplate(id);
    } catch (error) {
      console.error("Failed to delete template:", error);
      // You can add a toast notification here if you have one set up
      // Example: toast.error("Failed to delete template");
    }
  };

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs",
        active ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"
      )}
    >
      <Link href={`/items/new?template=${id}`} className="hover:underline">
        {name}
      </Link>
      <button
        type="button"
        aria-label={`Delete template ${name}`}
        disabled={pending}
        onClick={handleDelete}
        className="text-muted-foreground hover:text-destructive disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}