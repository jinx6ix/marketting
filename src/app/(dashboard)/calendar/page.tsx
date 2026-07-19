import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  parse,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { getSessionContext } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata = { title: "Calendar" };

const STATUS_DOT: Record<string, string> = {
  draft: "bg-muted-foreground",
  scheduled: "bg-primary",
  publishing: "bg-warning",
  published: "bg-success",
  partially_published: "bg-warning",
  failed: "bg-destructive",
};

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { orgId, supabase } = await getSessionContext();
  const { month } = await searchParams;

  const current = month
    ? parse(month, "yyyy-MM", new Date())
    : new Date();
  const monthStart = startOfMonth(current);
  const monthEnd = endOfMonth(current);
  const gridStart = startOfWeek(monthStart);
  const gridEnd = endOfWeek(monthEnd);

  const { data: items } = await supabase
    .from("marketing_items")
    .select("id, title, status, scheduled_at, type, destination")
    .eq("org_id", orgId!)
    .not("scheduled_at", "is", null)
    .gte("scheduled_at", gridStart.toISOString())
    .lte("scheduled_at", gridEnd.toISOString())
    .order("scheduled_at");

  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const prev = format(addMonths(current, -1), "yyyy-MM");
  const next = format(addMonths(current, 1), "yyyy-MM");

  return (
    <div className="flex h-full flex-col space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Calendar</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" asChild>
            <Link href={`/calendar?month=${prev}`} aria-label="Previous month">
              <ChevronLeft />
            </Link>
          </Button>
          <span className="w-36 text-center text-sm font-medium">
            {format(current, "MMMM yyyy")}
          </span>
          <Button variant="outline" size="icon" asChild>
            <Link href={`/calendar?month=${next}`} aria-label="Next month">
              <ChevronRight />
            </Link>
          </Button>
          {month && (
            <Button variant="ghost" size="sm" asChild>
              <Link href="/calendar">Today</Link>
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border text-xs">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div
            key={d}
            className="bg-muted px-2 py-1.5 text-center font-medium text-muted-foreground"
          >
            {d}
          </div>
        ))}
        {days.map((day) => {
          const dayItems = (items ?? []).filter(
            (i) => i.scheduled_at && isSameDay(new Date(i.scheduled_at), day)
          );
          return (
            <div
              key={day.toISOString()}
              className={cn(
                "min-h-24 space-y-1 bg-background p-1.5",
                !isSameMonth(day, current) && "bg-muted/40 text-muted-foreground"
              )}
            >
              <div
                className={cn(
                  "flex size-5 items-center justify-center rounded-full text-[11px]",
                  isToday(day) && "bg-primary font-semibold text-primary-foreground"
                )}
              >
                {format(day, "d")}
              </div>
              {dayItems.map((item) => (
                <Link
                  key={item.id}
                  href={`/items/${item.id}`}
                  className="flex items-center gap-1.5 truncate rounded border bg-card px-1.5 py-1 transition-colors hover:border-primary/50"
                  title={`${item.title} — ${item.status.replace(/_/g, " ")}${
                    item.scheduled_at
                      ? ` at ${format(new Date(item.scheduled_at), "HH:mm")}`
                      : ""
                  }`}
                >
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      STATUS_DOT[item.status] ?? "bg-muted-foreground"
                    )}
                  />
                  <span className="truncate">{item.title}</span>
                </Link>
              ))}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        {Object.entries(STATUS_DOT).map(([status, cls]) => (
          <span key={status} className="flex items-center gap-1.5">
            <span className={cn("size-2 rounded-full", cls)} />
            {status.replace(/_/g, " ")}
          </span>
        ))}
      </div>
    </div>
  );
}
