import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parse,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { toZonedTime, fromZonedTime } from "date-fns-tz";
import { getSessionContext } from "@/lib/supabase/server";
import { getOrgTimezone } from "@/lib/org-timezone";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { StatTile } from "@/components/charts/stat-tile";
import { PLATFORM_COLORS, PLATFORM_LABELS } from "@/components/charts/theme";
import { cn } from "@/lib/utils";
import type { Platform } from "@/types/database";

export const metadata = { title: "Calendar" };

const STATUS_DOT: Record<string, string> = {
  draft: "bg-muted-foreground",
  scheduled: "bg-primary",
  publishing: "bg-warning",
  published: "bg-success",
  partially_published: "bg-warning",
  failed: "bg-destructive",
};

const ALL_PLATFORMS: Platform[] = [
  "facebook",
  "instagram",
  "x",
  "tiktok",
  "youtube",
  "linkedin",
  "pinterest",
];

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; platform?: string }>;
}) {
  const { orgId, supabase } = await getSessionContext();
  const { month, platform } = await searchParams;
  const timezone = await getOrgTimezone(supabase, orgId!);

  // Everything below operates on "zoned" Date objects — toZonedTime shifts
  // a real instant so its LOCAL getters (what date-fns's startOfMonth,
  // isSameDay, format, etc. all read internally) show the org's timezone's
  // wall-clock time, regardless of what timezone the server process itself
  // is actually running in. Vercel always runs Node in UTC (independent of
  // deployment region) while local dev inherits the OS's timezone — without
  // this, the day a post's card appears under, and what time it displays,
  // would shift near midnight/hour boundaries between the two.
  const nowZoned = toZonedTime(new Date(), timezone);
  const current = month ? parse(month, "yyyy-MM", nowZoned) : nowZoned;
  const monthStart = startOfMonth(current);
  const monthEnd = endOfMonth(current);
  const gridStart = startOfWeek(monthStart);
  const gridEnd = endOfWeek(monthEnd);

  // The DB query needs real UTC instants, not the shifted "zoned" ones —
  // convert back before hitting Supabase.
  const gridStartUtc = fromZonedTime(gridStart, timezone).toISOString();
  const gridEndUtc = fromZonedTime(gridEnd, timezone).toISOString();

  const { data: rawItems } = await supabase
    .from("marketing_items")
    .select(
      "id, title, status, scheduled_at, type, destination, post_targets(platform)"
    )
    .eq("org_id", orgId!)
    .not("scheduled_at", "is", null)
    .gte("scheduled_at", gridStartUtc)
    .lte("scheduled_at", gridEndUtc)
    .order("scheduled_at");

  const items = (rawItems ?? []).map((i) => ({
    ...i,
    // Pre-convert once here so every render-time comparison/format below
    // just uses this directly instead of re-converting repeatedly.
    scheduledZoned: i.scheduled_at ? toZonedTime(i.scheduled_at, timezone) : null,
    platforms: [
      ...new Set((i.post_targets ?? []).map((t) => t.platform as Platform)),
    ],
  }));

  const visibleItems = platform
    ? items.filter((i) => i.platforms.includes(platform as Platform))
    : items;

  const inMonth = visibleItems.filter(
    (i) => i.scheduledZoned && isSameMonth(i.scheduledZoned, current)
  );
  const scheduledCount = inMonth.filter((i) => i.status === "scheduled").length;
  const publishedCount = inMonth.filter((i) =>
    ["published", "partially_published"].includes(i.status)
  ).length;
  const attentionCount = inMonth.filter((i) =>
    ["failed", "partially_published"].includes(i.status)
  ).length;

  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const prev = format(addMonths(current, -1), "yyyy-MM");
  const next = format(addMonths(current, 1), "yyyy-MM");

  function monthHref(m: string) {
    const params = new URLSearchParams();
    params.set("month", m);
    if (platform) params.set("platform", platform);
    return `/calendar?${params.toString()}`;
  }

  return (
    <div className="flex h-full flex-col space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Calendar</h1>
          <p className="text-sm text-muted-foreground">
            Everything scheduled or published, at a glance.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <form action="/calendar" method="GET" className="flex items-center gap-1.5">
            {month && <input type="hidden" name="month" value={month} />}
            <Select
              name="platform"
              defaultValue={platform ?? ""}
              className="h-8 w-36 text-xs"
            >
              <option value="">All platforms</option>
              {ALL_PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {PLATFORM_LABELS[p]}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="outline" size="sm" className="h-8">
              Filter
            </Button>
          </form>
          <Button variant="outline" size="icon" asChild>
            <Link href={monthHref(prev)} aria-label="Previous month">
              <ChevronLeft />
            </Link>
          </Button>
          <span className="w-36 text-center text-sm font-medium">
            {format(current, "MMMM yyyy")}
          </span>
          <Button variant="outline" size="icon" asChild>
            <Link href={monthHref(next)} aria-label="Next month">
              <ChevronRight />
            </Link>
          </Button>
          {month && (
            <Button variant="ghost" size="sm" asChild>
              <Link href={platform ? `/calendar?platform=${platform}` : "/calendar"}>
                Today
              </Link>
            </Button>
          )}
          <Button size="sm" asChild>
            <Link href="/items/new" className="flex items-center gap-1.5">
              <Plus className="size-4" /> New
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Scheduled this month" value={scheduledCount} format="raw" />
        <StatTile label="Published this month" value={publishedCount} format="raw" />
        <StatTile label="Needs attention" value={attentionCount} format="raw" />
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
          const dayItems = visibleItems.filter(
            (i) => i.scheduledZoned && isSameDay(i.scheduledZoned, day)
          );
          const dateParam = format(day, "yyyy-MM-dd");
          const isToday = isSameDay(day, nowZoned);
          return (
            <div
              key={day.toISOString()}
              className={cn(
                "group relative flex min-h-24 flex-col bg-background p-1.5",
                !isSameMonth(day, current) && "bg-muted/40 text-muted-foreground"
              )}
            >
              <div className="flex items-center justify-between">
                <div
                  className={cn(
                    "flex size-5 items-center justify-center rounded-full text-[11px]",
                    isToday && "bg-primary font-semibold text-primary-foreground"
                  )}
                >
                  {format(day, "d")}
                </div>
                <Link
                  href={`/items/new?date=${dateParam}`}
                  className="hidden size-5 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100 sm:flex"
                  aria-label={`New item for ${dateParam}`}
                  title="New item for this day"
                >
                  <Plus className="size-3.5" />
                </Link>
              </div>
              <div className="mt-1 max-h-28 space-y-1 overflow-y-auto pr-0.5">
                {dayItems.map((item) => (
                  <Link
                    key={item.id}
                    href={`/items/${item.id}`}
                    className="block truncate rounded border bg-card px-1.5 py-1 transition-colors hover:border-primary/50"
                    title={`${item.title} — ${item.status.replace(/_/g, " ")}${
                      item.scheduledZoned
                        ? ` at ${format(item.scheduledZoned, "HH:mm")}`
                        : ""
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          STATUS_DOT[item.status] ?? "bg-muted-foreground"
                        )}
                      />
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {item.scheduledZoned ? format(item.scheduledZoned, "HH:mm") : ""}
                      </span>
                      <span className="truncate">{item.title}</span>
                    </div>
                    {item.platforms.length > 0 && (
                      <div className="mt-0.5 flex items-center gap-0.5 pl-3">
                        {item.platforms.slice(0, 5).map((p) => (
                          <span
                            key={p}
                            className="size-1.5 rounded-full"
                            style={{ background: PLATFORM_COLORS[p] }}
                            title={PLATFORM_LABELS[p]}
                          />
                        ))}
                        {item.platforms.length > 5 && (
                          <span className="text-[10px] text-muted-foreground">
                            +{item.platforms.length - 5}
                          </span>
                        )}
                      </div>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-4">
          {Object.entries(STATUS_DOT).map(([status, cls]) => (
            <span key={status} className="flex items-center gap-1.5">
              <span className={cn("size-2 rounded-full", cls)} />
              {status.replace(/_/g, " ")}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {ALL_PLATFORMS.map((p) => (
            <span key={p} className="flex items-center gap-1.5">
              <span
                className="size-2 rounded-full"
                style={{ background: PLATFORM_COLORS[p] }}
              />
              {PLATFORM_LABELS[p]}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}