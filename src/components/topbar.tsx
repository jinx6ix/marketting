import Link from "next/link";
import { Plus, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logout } from "@/features/auth/actions";

export function Topbar({
  orgName,
  userEmail,
}: {
  orgName: string;
  userEmail: string;
}) {
  return (
    <header className="flex h-14 items-center justify-between border-b bg-card px-6">
      <div className="text-sm font-medium">{orgName}</div>
      <div className="flex items-center gap-3">
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
