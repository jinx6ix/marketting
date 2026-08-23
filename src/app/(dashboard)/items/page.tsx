import Link from "next/link";
import { Plus } from "lucide-react";
import { getSessionContext } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { ItemsTable, type ItemRow } from "@/features/marketing-items/components/items-table";
import { getOrgTimezone } from "@/lib/org-timezone";
import type { ItemStatus, ItemType } from "@/types/database";

export const metadata = { title: "Marketing Items" };

const PAGE_SIZE = 25;

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string; page?: string }>;
}) {
  const { orgId, supabase } = await getSessionContext();
  const { status, type, page: pageParam } = await searchParams;
  const page = Math.max(1, Number(pageParam) || 1);
  const from = (page - 1) * PAGE_SIZE;

  let query = supabase
    .from("marketing_items")
    .select(
      "id, title, type, status, destination, scheduled_at, created_at, campaigns(name)",
      { count: "exact" }
    )
    .eq("org_id", orgId!)
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  if (status) {
    const statuses = status.split(",") as ItemStatus[];
    query =
      statuses.length > 1
        ? query.in("status", statuses)
        : query.eq("status", statuses[0]);
  }
  if (type) query = query.eq("type", type as ItemType);

  const { data: items, count } = await query;
  const timezone = await getOrgTimezone(supabase, orgId!);
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (type) params.set("type", type);
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return s ? `/items?${s}` : "/items";
  };

  const FILTERS = [
    { label: "All", href: "/items" },
    { label: "Drafts", href: "/items?status=draft" },
    { label: "In review", href: "/items?status=in_review" },
    { label: "Scheduled", href: "/items?status=scheduled" },
    { label: "Published", href: "/items?status=published" },
    { label: "Needs attention", href: "/items?status=failed,partially_published" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 sm:justify-between">
        <h1 className="text-lg font-semibold sm:text-xl">Marketing items</h1>
        <Button asChild size="sm">
          <Link href="/items/new" className="flex items-center gap-1.5">
            <Plus className="size-4" /> New item
          </Link>
        </Button>
      </div>

      <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
        {FILTERS.map((f) => (
          <Link
            key={f.href}
            href={f.href}
            className="whitespace-nowrap rounded-md border px-3 py-1 text-xs hover:bg-accent"
          >
            {f.label}
          </Link>
        ))}
      </div>

      <ItemsTable items={(items ?? []) as unknown as ItemRow[]} timezone={timezone} />

      {totalPages > 1 && (
        <div className="flex flex-col items-start justify-between gap-2 text-sm sm:flex-row sm:items-center">
          <span className="text-muted-foreground">
            Page {page} of {totalPages} · {count} items
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={pageHref(page - 1)}
                className="rounded-md border px-3 py-1 hover:bg-accent"
              >
                ← Newer
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={pageHref(page + 1)}
                className="rounded-md border px-3 py-1 hover:bg-accent"
              >
                Older →
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}