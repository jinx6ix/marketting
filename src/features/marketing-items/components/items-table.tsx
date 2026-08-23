"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
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
import { DeleteButton } from "@/components/delete-button";
import { deleteItem, bulkDeleteItems } from "@/features/marketing-items/actions";
import { relativeTime, formatInTimeZone } from "@/lib/utils";

export interface ItemRow {
  id: string;
  title: string;
  type: string;
  status: string;
  destination: string | null;
  scheduled_at: string | null;
  created_at: string;
  campaigns: { name: string } | null;
}

export function ItemsTable({ items, timezone }: { items: ItemRow[]; timezone: string }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const allSelected = items.length > 0 && selected.size === items.length;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(items.map((i) => i.id)));
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function bulkDelete() {
    setError(null);
    startTransition(async () => {
      const result = await bulkDeleteItems([...selected]);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSelected(new Set());
    });
  }

  return (
    <div className="space-y-2">
      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <span>{selected.size} selected</span>
          <div className="flex items-center gap-2">
            {error && <span className="text-xs text-destructive">{error}</span>}
            <Button
              variant="destructive"
              size="sm"
              disabled={pending}
              onClick={bulkDelete}
              className="gap-1.5"
            >
              <Trash2 className="size-3.5" />
              {pending ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select all"
                />
              </TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Destination</TableHead>
              <TableHead>Campaign</TableHead>
              <TableHead>Scheduled</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => toggleOne(item.id)}
                    aria-label={`Select ${item.title}`}
                  />
                </TableCell>
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
                  {item.campaigns?.name ?? "—"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {item.scheduled_at
                    ? formatInTimeZone(item.scheduled_at, timezone, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })
                    : relativeTime(item.created_at)}
                </TableCell>
                <TableCell>
                  <DeleteButton label={item.title} onDelete={deleteItem.bind(null, item.id)} />
                </TableCell>
              </TableRow>
            ))}
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                  No items yet. Create your first marketing item.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}