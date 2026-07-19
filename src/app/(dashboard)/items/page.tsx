import Link from "next/link";
import { Plus } from "lucide-react";
import { getSessionContext } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { relativeTime } from "@/lib/utils";
import type { ItemStatus, ItemType } from "@/types/database";

export const metadata = { title: "Marketing Items" };

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string }>;
}) {
  const { orgId, supabase } = await getSessionContext();
  const { status, type } = await searchParams;

  let query = supabase
    .from("marketing_items")
    .select("id, title, type, status, destination, scheduled_at, created_at, campaigns(name)")
    .eq("org_id", orgId!)
    .order("created_at", { ascending: false })
    .limit(100);
  if (status) query = query.eq("status", status as ItemStatus);
  if (type) query = query.eq("type", type as ItemType);

  const { data: items } = await query;

  const FILTERS = [
    { label: "All", href: "/items" },
    { label: "Drafts", href: "/items?status=draft" },
    { label: "Scheduled", href: "/items?status=scheduled" },
    { label: "Published", href: "/items?status=published" },
    { label: "Failed", href: "/items?status=failed" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Marketing items</h1>
        <Button asChild>
          <Link href="/items/new" className="flex items-center gap-1.5">
            <Plus className="size-4" /> New item
          </Link>
        </Button>
      </div>

      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.href}
            href={f.href}
            className="rounded-md border px-3 py-1 text-xs hover:bg-accent"
          >
            {f.label}
          </Link>
        ))}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Destination</TableHead>
            <TableHead>Campaign</TableHead>
            <TableHead>Scheduled</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(items ?? []).map((item) => (
            <TableRow key={item.id}>
              <TableCell>
                <Link href={`/items/${item.id}`} className="font-medium hover:underline">
                  {item.title}
                </Link>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {item.type.replace("_", " ")}
              </TableCell>
              <TableCell>
                <StatusBadge status={item.status} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {item.destination ?? "—"}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {(item.campaigns as { name: string } | null)?.name ?? "—"}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {item.scheduled_at
                  ? new Date(item.scheduled_at).toLocaleString()
                  : relativeTime(item.created_at)}
              </TableCell>
            </TableRow>
          ))}
          {(items ?? []).length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                No items yet. Create your first marketing item.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
