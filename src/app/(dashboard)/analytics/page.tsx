import { getSessionContext } from "@/lib/supabase/server";
import { StatTile } from "@/components/charts/stat-tile";
import { LineSeries, type SeriesDef } from "@/components/charts/line-series";
import { BarSeries } from "@/components/charts/bar-series";
import { Heatmap, type HeatCell } from "@/components/charts/heatmap";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PLATFORM_COLORS, PLATFORM_LABELS } from "@/components/charts/theme";
import { formatNumber } from "@/lib/utils";
import Link from "next/link";
import type { Platform } from "@/types/database";

export const metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  const { orgId, supabase } = await getSessionContext();

  const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);

  const [
    { data: accounts },
    { data: latest },
    { data: growth },
    { data: byHour },
    { data: targets },
  ] = await Promise.all([
    supabase
      .from("social_accounts")
      .select("id, platform, handle, display_name")
      .eq("org_id", orgId!),
    supabase.from("v_account_latest_metrics").select("*").eq("org_id", orgId!),
    supabase
      .from("v_follower_growth")
      .select("social_account_id, day, followers, engagement_total")
      .eq("org_id", orgId!)
      .gte("day", since)
      .order("day"),
    supabase.from("v_engagement_by_hour").select("*").eq("org_id", orgId!),
    supabase
      .from("post_targets")
      .select(
        "id, platform, published_at, external_url, marketing_items(id, title)"
      )
      .eq("org_id", orgId!)
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(50),
  ]);

  const accountById = new Map((accounts ?? []).map((a) => [a.id, a]));

  // ── KPI totals ──
  const totalFollowers = (latest ?? []).reduce((s, m) => s + (m.followers ?? 0), 0);
  const totalImpressions = (latest ?? []).reduce(
    (s, m) => s + (m.impressions ?? 0),
    0
  );
  const totalReach = (latest ?? []).reduce((s, m) => s + (m.reach ?? 0), 0);
  const totalEngagement = (latest ?? []).reduce(
    (s, m) => s + (m.engagement_total ?? 0),
    0
  );

  // ── Follower growth per platform ──
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
  const growthData = [...dayPlatform.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, buckets]) => ({ day: day.slice(5), ...buckets }));
  const growthSeries: SeriesDef[] = [...platformsSeen].map((p) => ({
    key: p,
    label: PLATFORM_LABELS[p],
    color: PLATFORM_COLORS[p],
  }));

  // ── Best posting times heatmap (all platforms combined) ──
  const heatAgg = new Map<string, number>();
  for (const row of byHour ?? []) {
    const key = `${row.dow}-${row.hour}`;
    heatAgg.set(key, (heatAgg.get(key) ?? 0) + (row.total_engagement ?? 0));
  }
  const heatCells: HeatCell[] = [...heatAgg.entries()].map(([key, value]) => {
    const [dow, hour] = key.split("-").map(Number);
    return { dow, hour, value };
  });

  // ── Engagement per platform bar chart ──
  const engByPlatform = new Map<string, number>();
  for (const m of latest ?? []) {
    const account = accountById.get(m.social_account_id);
    if (!account) continue;
    engByPlatform.set(
      account.platform,
      (engByPlatform.get(account.platform) ?? 0) + (m.engagement_total ?? 0)
    );
  }
  const engagementData = [...engByPlatform.entries()].map(([platform, value]) => ({
    platform: PLATFORM_LABELS[platform as Platform] ?? platform,
    engagement: value,
  }));

  // ── Top posts: latest snapshot per published target ──
  const targetIds = (targets ?? []).map((t) => t.id);
  const { data: postSnaps } = targetIds.length
    ? await supabase
        .from("post_metric_snapshots")
        .select(
          "post_target_id, likes, comments, shares, impressions, engagement_rate, captured_at"
        )
        .in("post_target_id", targetIds)
        .order("captured_at", { ascending: false })
    : { data: [] as never[] };

  const latestSnap = new Map<string, NonNullable<typeof postSnaps>[number]>();
  for (const s of postSnaps ?? []) {
    if (!latestSnap.has(s.post_target_id)) latestSnap.set(s.post_target_id, s);
  }
  const topPosts = (targets ?? [])
    .map((t) => ({ target: t, metrics: latestSnap.get(t.id) }))
    .sort(
      (a, b) =>
        ((b.metrics?.likes ?? 0) + (b.metrics?.comments ?? 0) + (b.metrics?.shares ?? 0)) -
        ((a.metrics?.likes ?? 0) + (a.metrics?.comments ?? 0) + (a.metrics?.shares ?? 0))
    )
    .slice(0, 10);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Analytics</h1>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Followers" value={totalFollowers} />
        <StatTile label="Impressions" value={totalImpressions} />
        <StatTile label="Reach" value={totalReach} />
        <StatTile label="Engagement" value={totalEngagement} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Follower growth</CardTitle>
            <CardDescription>Last 30 days, per platform</CardDescription>
          </CardHeader>
          <CardContent>
            {growthData.length > 1 ? (
              <LineSeries data={growthData} series={growthSeries} />
            ) : (
              <EmptyChart />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Engagement by platform</CardTitle>
            <CardDescription>Latest account snapshots</CardDescription>
          </CardHeader>
          <CardContent>
            {engagementData.length > 0 ? (
              <BarSeries
                data={engagementData}
                series={[{ key: "engagement", label: "Engagement" }]}
                xKey="platform"
              />
            ) : (
              <EmptyChart />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Best posting times</CardTitle>
          <CardDescription>
            Total engagement of your published posts by weekday and hour
          </CardDescription>
        </CardHeader>
        <CardContent>
          {heatCells.length > 0 ? <Heatmap cells={heatCells} /> : <EmptyChart />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Top posts</CardTitle>
          <CardDescription>
            Published posts ranked by likes + comments + shares
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Post</TableHead>
                <TableHead>Platform</TableHead>
                <TableHead>Likes</TableHead>
                <TableHead>Comments</TableHead>
                <TableHead>Shares</TableHead>
                <TableHead>Impressions</TableHead>
                <TableHead>Published</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topPosts.map(({ target, metrics }) => {
                const item = target.marketing_items as {
                  id: string;
                  title: string;
                } | null;
                return (
                  <TableRow key={target.id}>
                    <TableCell>
                      {item ? (
                        <Link
                          href={`/items/${item.id}`}
                          className="font-medium hover:underline"
                        >
                          {item.title}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {PLATFORM_LABELS[target.platform as Platform] ??
                        target.platform}
                    </TableCell>
                    <TableCell>{formatNumber(metrics?.likes)}</TableCell>
                    <TableCell>{formatNumber(metrics?.comments)}</TableCell>
                    <TableCell>{formatNumber(metrics?.shares)}</TableCell>
                    <TableCell>{formatNumber(metrics?.impressions)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {target.published_at
                        ? new Date(target.published_at).toLocaleDateString()
                        : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
              {topPosts.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No published posts yet — metrics appear after posts publish
                    and the metrics job runs.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {(accounts ?? []).length === 0 && (
        <p className="text-sm text-muted-foreground">
          Connect social accounts in{" "}
          <Link href="/settings/accounts" className="text-primary hover:underline">
            Settings
          </Link>{" "}
          to start collecting analytics.
        </p>
      )}
    </div>
  );
}

function EmptyChart() {
  return (
    <p className="py-12 text-center text-sm text-muted-foreground">
      Not enough data yet.
    </p>
  );
}
