"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";

interface DeleteButtonProps {
  action: () => Promise<{ error?: string }>;
  label?: string;
  confirmText?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
}

/**
 * Inline two-step delete:
 * first click shows a "Confirm" prompt;
 * second click calls the server action.
 */
export function DeleteButton({
  action,
  label,
  confirmText = "Sure?",
  variant = "ghost",
  size = "sm",
  className,
}: DeleteButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleFirstClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    setError(null);
    setConfirming(true);
  }

  function handleCancel(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    setConfirming(false);
    setError(null);
  }

  function handleConfirm(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    setError(null);

    startTransition(async () => {
      const result = await action();

      if (result?.error) {
        setError(result.error);
        setConfirming(false);
      } else {
        setConfirming(false);
      }
    });
  }

  if (confirming) {
    return (
      <span
        className="inline-flex items-center gap-1"
        onClick={(e) => e.stopPropagation()}
      >
        <Button
          type="button"
          size={size}
          variant="destructive"
          disabled={pending}
          onClick={handleConfirm}
        >
          {pending ? "Deleting…" : confirmText}
        </Button>

        <Button
          type="button"
          size={size}
          variant="ghost"
          disabled={pending}
          onClick={handleCancel}
        >
          Cancel
        </Button>

        {error && (
          <span className="ml-2 text-xs text-destructive">
            {error}
          </span>
        )}
      </span>
    );
  }

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      className={className}
      onClick={handleFirstClick}
      title={label ? `Delete ${label}` : "Delete"}
    >
      <Trash2 className="h-4 w-4" />
      {label && <span>{label}</span>}
    </Button>
  );
}