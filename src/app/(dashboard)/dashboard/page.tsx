import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  Inbox as InboxIcon,
  Lightbulb,
  AlertTriangle,
} from "lucide-react";
import { getSessionContext } from "@/lib/supabase/server";
import { StatTile } from "@/components/charts/stat-tile";
import { LineSeries, type SeriesDef } from "@/components/charts/line-series";
import { StatusBadge } from "@/components/status-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PLATFORM_COLORS, PLATFORM_LABELS } from "@/components/charts/theme";
import { daysAgoIso, relativeTime } from "@/lib/utils";
import type { Platform } from "@/types/database";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const { orgId, supabase } = await getSessionContext();

  const since = daysAgoIso(30).slice(0, 10);

  const [
    { data: accounts },
    { data: latest },
    { data: growth },
    { data: upcoming },
    { data: mentions },
    { count: unreadCount },
    { data: strategy },
    { data: attentionItems },
    { count: attentionCount },
  ] = await Promise.all([
    supabase
      .from("social_accounts")
      .select("id, platform, handle, display_name, status")
      .eq("org_id", orgId!),
    supabase.from("v_account_latest_metrics").select("*").eq("org_id", orgId!),
    supabase
      .from("v_follower_growth")
      .select("social_account_id, day, followers")
      .eq("org_id", orgId!)
      .gte("day", since)
      .order("day"),
    supabase
      .from("marketing_items")
      .select("id, title, status, scheduled_at, destination")
      .eq("org_id", orgId!)
      .eq("status", "scheduled")
      .order("scheduled_at", { ascending: true })
      .limit(5),
    supabase
      .from("mentions")
      .select("id, platform, author_handle, author_name, content, sentiment, occurred_at, is_read")
      .eq("org_id", orgId!)
      .order("occurred_at", { ascending: false })
      .limit(5),
    supabase
      .from("mentions")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId!)
      .eq("is_read", false),
    supabase
      .from("ai_strategies")
      .select("id, title, summary, status, created_at, ai_recommendations(id, title, priority, status)")
      .eq("org_id", orgId!)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Items needing attention: failed to publish, or published on some
    // platforms but not others. Org-scoped (RLS), safe to show every member
    // — unlike job_runs (no org_id), which stays admin-only under
    // Settings → Jobs.
    supabase
      .from("marketing_items")
      .select("id, title, status, updated_at")
      .eq("org_id", orgId!)
      .in("status", ["failed", "partially_published"])
      .order("updated_at", { ascending: false })
      .limit(5),
    supabase
      .from("marketing_items")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId!)
      .in("status", ["failed", "partially_published"]),
  ]);

  const accountById = new Map((accounts ?? []).map((a) => [a.id, a]));

  // KPI totals from latest snapshots
  const totalFollowers = (latest ?? []).reduce((s, m) => s + (m.followers ?? 0), 0);
  const totalEngagement = (latest ?? []).reduce(
    (s, m) => s + (m.engagement_total ?? 0),
    0
  );

  // 30d follower delta: earliest vs latest point per account
  let followerDelta = 0;
  const byAccount = new Map<string, { first: number; last: number }>();
  for (const row of growth ?? []) {
    if (row.followers == null) continue;
    const e = byAccount.get(row.social_account_id);
    if (!e) {
      byAccount.set(row.social_account_id, { first: row.followers, last: row.followers });
    } else {
      e.last = row.followers;
    }
  }
  for (const { first, last } of byAccount.values()) followerDelta += last - first;

  // Follower growth chart: one series per platform (sum accounts per platform per day)
  const dayPlatform = new Map<string, Record<string, number>>();
  const platformsSeen = new Set<Platform>();
  for (const row of growth ?? []) {
    const account = accountById.get(row.social_account_id);
    if (!account || row.followers == null) continue;
    platformsSeen.add(account.platform);
    const day = String(row.day);
    const bucket = dayPlatform.get(day) ?? {};
    bucket[account.platform] = (bucket[account.platform] ?? 0) + row.followers;
    dayPlatform.set(day, bucket);
  }
  const chartData = [...dayPlatform.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, buckets]) => ({ day: day.slice(5), ...buckets }));
  const series: SeriesDef[] = [...platformsSeen].map((p) => ({
    key: p,
    label: PLATFORM_LABELS[p],
    color: PLATFORM_COLORS[p],
  }));

  const activeAccounts = (accounts ?? []).filter((a) => a.status === "active");
  const recommendations = (strategy?.ai_recommendations ?? [])
    .filter((r) => r.status === "proposed")
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 4);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Dashboard</h1>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Total followers"
          value={totalFollowers}
          delta={followerDelta}
        />
        <StatTile label="Total engagement" value={totalEngagement} />
        <StatTile
          label="Connected accounts"
          value={activeAccounts.length}
          format="raw"
        />
        <StatTile label="Unread mentions" value={unreadCount ?? 0} format="raw" />
      </div>

      {(attentionCount ?? 0) > 0 && (
        <Card className="border-destructive/40 bg-destructive/[0.03]">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="size-4 text-destructive" />
                Needs attention
              </CardTitle>
              <Link
                href="/items?status=failed,partially_published"
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                View all ({attentionCount}) <ArrowRight className="size-3" />
              </Link>
            </div>
            <CardDescription>
              Items that failed to publish, or only went out on some
              platforms
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(attentionItems ?? []).map((item) => (
              <Link
                key={item.id}
                href={`/items/${item.id}`}
                className="flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-background p-2.5 transition-colors hover:border-destructive/60"
              >
                <span className="truncate text-sm font-medium">{item.title}</span>
                <StatusBadge status={item.status} />
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Follower growth</CardTitle>
            <CardDescription>Last 30 days, per platform</CardDescription>
          </CardHeader>
          <CardContent>
            {chartData.length > 1 ? (
              <LineSeries data={chartData} series={series} />
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Not enough data yet — snapshots accumulate as the metrics job
                runs.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="size-4" /> Up next
              </CardTitle>
              <Link
                href="/calendar"
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Calendar <ArrowRight className="size-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {(upcoming ?? []).map((item) => (
              <Link
                key={item.id}
                href={`/items/${item.id}`}
                className="block rounded-md border p-2.5 transition-colors hover:border-primary/50"
              >
                <div className="truncate text-sm font-medium">{item.title}</div>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <StatusBadge status={item.status} />
                  {item.scheduled_at && (
                    <span>
                      {new Date(item.scheduled_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  )}
                </div>
              </Link>
            ))}
            {(upcoming ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nothing scheduled.{" "}
                <Link href="/items/new" className="text-primary hover:underline">
                  Create an item
                </Link>
                .
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <InboxIcon className="size-4" /> Latest mentions
              </CardTitle>
              <Link
                href="/inbox"
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Inbox <ArrowRight className="size-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {(mentions ?? []).map((m) => (
              <div key={m.id} className="rounded-md border p-2.5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {m.author_name ?? m.author_handle ?? "Unknown"}
                  </span>
                  <span>· {PLATFORM_LABELS[m.platform as Platform] ?? m.platform}</span>
                  {m.occurred_at && <span>· {relativeTime(m.occurred_at)}</span>}
                  {!m.is_read && (
                    <span className="ml-auto size-2 rounded-full bg-primary" />
                  )}
                </div>
                <p className="mt-1 line-clamp-2 text-sm">{m.content}</p>
              </div>
            ))}
            {(mentions ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">
                No mentions yet — they appear as the monitoring job polls your
                platforms.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Lightbulb className="size-4" /> Latest strategy
              </CardTitle>
              <Link
                href="/strategies"
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                Strategies <ArrowRight className="size-3" />
              </Link>
            </div>
            {strategy && <CardDescription>{strategy.title}</CardDescription>}
          </CardHeader>
          <CardContent className="space-y-3">
            {strategy ? (
              <>
                {strategy.summary && (
                  <p className="text-sm text-muted-foreground">{strategy.summary}</p>
                )}
                {recommendations.map((r) => (
                  <Link
                    key={r.id}
                    href={`/strategies/${strategy.id}`}
                    className="flex items-center justify-between gap-2 rounded-md border p-2.5 transition-colors hover:border-primary/50"
                  >
                    <span className="truncate text-sm">{r.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      P{r.priority}
                    </span>
                  </Link>
                ))}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No strategy yet — generate one from the{" "}
                <Link href="/strategies" className="text-primary hover:underline">
                  Strategies
                </Link>{" "}
                page.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}