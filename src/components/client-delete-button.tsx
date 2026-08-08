"use client";

import { useTransition } from "react";
import { DeleteButton } from "@/components/delete-button";
import { deleteItem } from "@/features/marketing-items/actions";

interface ClientDeleteButtonProps {
  itemId: string;
  label?: string;
  confirmText?: string;
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
}

export function ClientDeleteButton({
  itemId,
  label,
  confirmText,
  variant,
  size,
  className,
}: ClientDeleteButtonProps) {
  const [isPending, startTransition] = useTransition();

  const handleDelete = () => {
    return new Promise<{ error?: string }>((resolve) => {
      startTransition(async () => {
        try {
          const result = await deleteItem(itemId);
          resolve(result);
        } catch (error) {
          resolve({
            error: error instanceof Error ? error.message : "An error occurred",
          });
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
      disabled={isPending}
    />
  );
}