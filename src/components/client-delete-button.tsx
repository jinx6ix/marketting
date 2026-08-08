"use client";

import { useTransition } from "react";
import { DeleteButton } from "@/components/delete-button";

interface ClientDeleteButtonProps {
  label?: string;
  confirmText?: string;
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
  deleteAction: () => Promise<{ error?: string }>;
}

export function ClientDeleteButton({
  label,
  confirmText,
  variant,
  size,
  className,
  deleteAction,
}: ClientDeleteButtonProps) {
  const [isPending, startTransition] = useTransition();

  const handleDelete = () => {
    return new Promise<{ error?: string }>((resolve) => {
      startTransition(async () => {
        try {
          const result = await deleteAction();
          resolve(result);
        } catch (error) {
          resolve({ error: error instanceof Error ? error.message : "An error occurred" });
        }
      });
    });
  };

  return (
    <DeleteButton
      label={label}
      confirmText={confirmText}
      variant={variant}
      size={size}
      className={className}
      onDelete={handleDelete}
    />
  );
}