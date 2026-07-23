import Link from "next/link";
import { Plus, LogOut, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logout } from "@/features/auth/actions";

export function Topbar({
  orgName,
  userEmail,
  failedCount = 0,
}: {
  orgName: string;
  userEmail: string;
  failedCount?: number;
}) {
  return (
    <header className="flex h-14 items-center justify-between border-b bg-card px-6">
      <div className="text-sm font-medium">{orgName}</div>
      <div className="flex items-center gap-3">
        {failedCount > 0 && (
          <Link
            href="/items?status=failed"
            className="flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-xs text-destructive hover:bg-destructive/20"
          >
            <AlertTriangle className="size-3.5" />
            {failedCount} failed {failedCount === 1 ? "post" : "posts"}
          </Link>
        )}
        <Button asChild size="sm">
          <Link href="/items/new" className="flex items-center gap-1.5">
            <Plus className="size-4" />
            New item
          </Link>
        </Button>
        <span className="text-xs text-muted-foreground">{userEmail}</span>
        <form action={logout}>
          <Button variant="ghost" size="icon" type="submit" title="Log out">
            <LogOut className="size-4" />
          </Button>
        </form>
      </div>
    </header>
  );
}
