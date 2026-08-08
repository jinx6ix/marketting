"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";

interface DeleteButtonProps {
  onDelete: () => Promise<{ error?: string }>;
  label?: string;
  confirmText?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
  className?: string;
  disabled?: boolean;
}

/**
 * Inline two-step delete: first click shows a "Confirm" prompt;
 * second click calls onDelete. Cancels automatically if you click away.
 */
export function DeleteButton({
  onDelete,
  label,
  confirmText = "Sure?",
  variant = "ghost",
  size = "sm",
  className,
  disabled = false,
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
  }

  function handleConfirm(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    startTransition(async () => {
      const result = await onDelete();
      if (result?.error) {
        setError(result.error);
        setConfirming(false);
      }
    });
  }

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <Button
          size={size}
          variant="destructive"
          disabled={pending || disabled}
          onClick={handleConfirm}
        >
          {pending ? "Deleting…" : confirmText}
        </Button>
        <Button size={size} variant="ghost" onClick={handleCancel} disabled={disabled}>
          Cancel
        </Button>
        {error && <span className="text-xs text-destructive">{error}</span>}
      </span>
    );
  }

  return (
    <Button
      size={size}
      variant={variant}
      className={className}
      onClick={handleFirstClick}
      disabled={disabled}
      title={label ? `Delete ${label}` : "Delete"}
    >
      <Trash2 className="size-3.5" />
      {label && <span className="sr-only">{label}</span>}
    </Button>
  );
}