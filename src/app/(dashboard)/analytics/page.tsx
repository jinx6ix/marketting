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
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PLATFORM_COLORS, PLATFORM_LABELS } from "@/components/charts/theme";
import { daysAgoIso, formatNumber, formatPercent } from "@/lib/utils";
import Link from "next/link";
import type { Platform } from "@/types/database";

export const metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  const { orgId, supabase } = await getSessionContext();

  const since = daysAgoIso(30).slice(0, 10);
  const sinceIso = daysAgoIso(30);

  const [
    { data: accounts },
    { data: latest },
    { data: growth },
    { data: byHour },
    { data: targets },
    { data: recentTargets },
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
    // Full (uncapped) 30-day published set, used for the per-platform
    // breakdown/comparison below — the `targets` query above is capped to
    // 50 rows for the "Top posts" table and isn't representative once an
    // org has more than 50 posts across all platforms combined.
    supabase
      .from("post_targets")
      .select("id, platform")
      .eq("org_id", orgId!)
      .eq("status", "published")
      .gte("published_at", sinceIso),
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
  const growthRows = [...dayPlatform.entries()].sort(([a], [b]) => a.localeCompare(b));
  const growthData = growthRows.map(([day, buckets]) => ({ day: day.slice(5), ...buckets }));
  const growthSeries: SeriesDef[] = [...platformsSeen].map((p) => ({
    key: p,
    label: PLATFORM_LABELS[p],
    color: PLATFORM_COLORS[p],
  }));
  // 30d growth per platform = last bucketed day's value minus the first's
  // (both are already summed across every account on that platform).
  const growth30dByPlatform = new Map<Platform, number>();
  if (growthRows.length >= 2) {
    const [, firstBuckets] = growthRows[0];
    const [, lastBuckets] = growthRows[growthRows.length - 1];
    for (const p of platformsSeen) {
      growth30dByPlatform.set(p, (lastBuckets[p] ?? 0) - (firstBuckets[p] ?? 0));
    }
  }

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

  // ── Per-platform breakdown + comparison (last 30 days) ──
  const recentIds = (recentTargets ?? []).map((t) => t.id);
  const platformByTargetId = new Map(
    (recentTargets ?? []).map((t) => [t.id, t.platform as Platform])
  );
  const { data: recentSnaps } = recentIds.length
    ? await supabase
        .from("post_metric_snapshots")
        .select("post_target_id, likes, comments, shares, impressions, engagement_rate, captured_at")
        .in("post_target_id", recentIds)
        .order("captured_at", { ascending: false })
    : { data: [] as never[] };

  const latestRecentSnap = new Map<string, NonNullable<typeof recentSnaps>[number]>();
  for (const s of recentSnaps ?? []) {
    if (!latestRecentSnap.has(s.post_target_id)) latestRecentSnap.set(s.post_target_id, s);
  }

  interface PlatformStat {
    platform: Platform;
    accounts: number;
    followers: number;
    growth30d: number | null;
    posts30d: number;
    totalEngagement30d: number;
    avgEngagementPerPost: number | null;
    avgEngagementRate: number | null;
    impressions: number;
  }

  const accountsByPlatform = new Map<Platform, number>();
  for (const a of accounts ?? []) {
    accountsByPlatform.set(a.platform, (accountsByPlatform.get(a.platform) ?? 0) + 1);
  }
  const followersByPlatform = new Map<Platform, number>();
  const impressionsByPlatform = new Map<Platform, number>();
  for (const m of latest ?? []) {
    const account = accountById.get(m.social_account_id);
    if (!account) continue;
    followersByPlatform.set(
      account.platform,
      (followersByPlatform.get(account.platform) ?? 0) + (m.followers ?? 0)
    );
    impressionsByPlatform.set(
      account.platform,
      (impressionsByPlatform.get(account.platform) ?? 0) + (m.impressions ?? 0)
    );
  }

  const postsByPlatform = new Map<Platform, number>();
  const engagementSumByPlatform = new Map<Platform, number>();
  const engagementRateSumByPlatform = new Map<Platform, { sum: number; n: number }>();
  for (const [targetId, snap] of latestRecentSnap) {
    const platform = platformByTargetId.get(targetId);
    if (!platform) continue;
    postsByPlatform.set(platform, (postsByPlatform.get(platform) ?? 0) + 1);
    const eng = (snap.likes ?? 0) + (snap.comments ?? 0) + (snap.shares ?? 0);
    engagementSumByPlatform.set(platform, (engagementSumByPlatform.get(platform) ?? 0) + eng);
    if (snap.engagement_rate != null) {
      const acc = engagementRateSumByPlatform.get(platform) ?? { sum: 0, n: 0 };
      acc.sum += snap.engagement_rate;
      acc.n += 1;
      engagementRateSumByPlatform.set(platform, acc);
    }
  }
  // Targets published but with no snapshot yet still count toward posts30d.
  for (const t of recentTargets ?? []) {
    const platform = t.platform as Platform;
    if (!latestRecentSnap.has(t.id)) {
      postsByPlatform.set(platform, (postsByPlatform.get(platform) ?? 0) + 1);
    }
  }

  const allPlatforms = new Set<Platform>([
    ...(accounts ?? []).map((a) => a.platform),
  ]);
  const platformStats: PlatformStat[] = [...allPlatforms]
    .map((platform) => {
      const posts30d = postsByPlatform.get(platform) ?? 0;
      const totalEngagement30d = engagementSumByPlatform.get(platform) ?? 0;
      const rateAcc = engagementRateSumByPlatform.get(platform);
      return {
        platform,
        accounts: accountsByPlatform.get(platform) ?? 0,
        followers: followersByPlatform.get(platform) ?? 0,
        growth30d: growth30dByPlatform.get(platform) ?? null,
        posts30d,
        totalEngagement30d,
        avgEngagementPerPost: posts30d > 0 ? totalEngagement30d / posts30d : null,
        avgEngagementRate: rateAcc && rateAcc.n > 0 ? rateAcc.sum / rateAcc.n : null,
        impressions: impressionsByPlatform.get(platform) ?? 0,
      };
    })
    .sort((a, b) => b.followers - a.followers);

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

      {/* Per-platform breakdown */}
      <div>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">
          Platform breakdown
        </h2>
        {platformStats.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {platformStats.map((s) => (
              <Card key={s.platform}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <span
                        className="size-2.5 rounded-full"
                        style={{ background: PLATFORM_COLORS[s.platform] }}
                      />
                      {PLATFORM_LABELS[s.platform]}
                    </CardTitle>
                    <Badge variant="outline">
                      {s.accounts} account{s.accounts === 1 ? "" : "s"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-y-3 text-sm">
                  <Metric label="Followers" value={formatNumber(s.followers)} />
                  <Metric
                    label="30d growth"
                    value={
                      s.growth30d == null
                        ? "—"
                        : `${s.growth30d > 0 ? "+" : ""}${formatNumber(s.growth30d)}`
                    }
                    tone={
                      s.growth30d == null
                        ? undefined
                        : s.growth30d > 0
                          ? "positive"
                          : s.growth30d < 0
                            ? "negative"
                            : undefined
                    }
                  />
                  <Metric label="Posts (30d)" value={formatNumber(s.posts30d)} />
                  <Metric
                    label="Avg engagement/post"
                    value={
                      s.avgEngagementPerPost == null
                        ? "—"
                        : formatNumber(Math.round(s.avgEngagementPerPost))
                    }
                  />
                  <Metric
                    label="Engagement rate"
                    value={formatPercent(s.avgEngagementRate)}
                  />
                  <Metric label="Impressions" value={formatNumber(s.impressions)} />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Connect a social account to see per-platform stats.
          </p>
        )}
      </div>

      {/* Platform comparison table */}
      {platformStats.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Platform comparison</CardTitle>
            <CardDescription>
              Side-by-side, last 30 days for posts/engagement figures
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Platform</TableHead>
                  <TableHead>Accounts</TableHead>
                  <TableHead>Followers</TableHead>
                  <TableHead>30d growth</TableHead>
                  <TableHead>Posts (30d)</TableHead>
                  <TableHead>Avg engagement/post</TableHead>
                  <TableHead>Engagement rate</TableHead>
                  <TableHead>Impressions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {platformStats.map((s) => (
                  <TableRow key={s.platform}>
                    <TableCell className="font-medium">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="size-2.5 rounded-full"
                          style={{ background: PLATFORM_COLORS[s.platform] }}
                        />
                        {PLATFORM_LABELS[s.platform]}
                      </span>
                    </TableCell>
                    <TableCell>{s.accounts}</TableCell>
                    <TableCell>{formatNumber(s.followers)}</TableCell>
                    <TableCell
                      className={
                        s.growth30d == null
                          ? "text-muted-foreground"
                          : s.growth30d > 0
                            ? "text-success"
                            : s.growth30d < 0
                              ? "text-destructive"
                              : undefined
                      }
                    >
                      {s.growth30d == null
                        ? "—"
                        : `${s.growth30d > 0 ? "+" : ""}${formatNumber(s.growth30d)}`}
                    </TableCell>
                    <TableCell>{formatNumber(s.posts30d)}</TableCell>
                    <TableCell>
                      {s.avgEngagementPerPost == null
                        ? "—"
                        : formatNumber(Math.round(s.avgEngagementPerPost))}
                    </TableCell>
                    <TableCell>{formatPercent(s.avgEngagementRate)}</TableCell>
                    <TableCell>{formatNumber(s.impressions)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

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

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative";
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={
          "font-medium tabular-nums " +
          (tone === "positive"
            ? "text-success"
            : tone === "negative"
              ? "text-destructive"
              : "")
        }
      >
        {value}
      </div>
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