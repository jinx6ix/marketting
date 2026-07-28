"use client";

import Link from "next/link";
import { Menu, Plus, LogOut, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logout } from "@/features/auth/actions";

export function Topbar({
  orgName,
  userEmail,
  failedCount = 0,
  onOpenMenu,
}: {
  orgName: string;
  userEmail: string;
  failedCount?: number;
  onOpenMenu?: () => void;
}) {
  return (
    <header className="flex h-14 items-center justify-between gap-2 border-b bg-card px-3 sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        {onOpenMenu && (
          <Button
            variant="ghost"
            size="icon"
            type="button"
            onClick={onOpenMenu}
            aria-label="Open menu"
            className="md:hidden"
          >
            <Menu className="size-5" />
          </Button>
        )}
        <div className="truncate text-sm font-medium">{orgName}</div>
      </div>
      <div className="flex items-center gap-2 sm:gap-3">
        {failedCount > 0 && (
          <Link
            href="/items?status=failed"
            className="hidden items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-xs text-destructive hover:bg-destructive/20 sm:flex"
          >
            <AlertTriangle className="size-3.5" />
            {failedCount} failed {failedCount === 1 ? "post" : "posts"}
          </Link>
        )}
        <Button asChild size="sm">
          <Link href="/items/new" className="flex items-center gap-1.5">
            <Plus className="size-4" />
            <span className="hidden sm:inline">New item</span>
          </Link>
        </Button>
        <span className="hidden text-xs text-muted-foreground lg:inline">
          {userEmail}
        </span>
        <form action={logout}>
          <Button variant="ghost" size="icon" type="submit" title="Log out">
            <LogOut className="size-4" />
          </Button>
        </form>
      </div>
    </header>
  );
}
