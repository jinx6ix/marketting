import type { ReactNode } from "react";
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
import { daysAgoIso, formatNumber, formatPercent, isStale, relativeTime, formatInTimeZone } from "@/lib/utils";
import { getOrgTimezone } from "@/lib/org-timezone";
import { DateRangeTabs } from "@/components/analytics/date-range-tabs";
import { ExportCsvButton } from "@/components/export-csv-button";
import { RefreshDataButton } from "@/features/settings/components/refresh-data-button";
import Link from "next/link";
import type { Platform } from "@/types/database";

export const metadata = { title: "Analytics" };
// The "Refresh data" button's Server Action can touch dozens of accounts
// and posts sequentially (each a real platform API call) — give it more
// room than the default route timeout instead of risking it getting cut
// off mid-sweep.
export const maxDuration = 300;

const VALID_RANGES = [7, 30, 90];

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { orgId, supabase } = await getSessionContext();
  const timezone = await getOrgTimezone(supabase, orgId!);
  const { range } = await searchParams;
  const days = VALID_RANGES.includes(Number(range)) ? Number(range) : 30;

  const since = daysAgoIso(days).slice(0, 10);
  const sinceIso = daysAgoIso(days);

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
      .select("id, platform, handle, display_name, avatar_url")
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
    // Full (uncapped) date-range published set, used for the per-account
    // breakdown below — the `targets` query above is capped to 50 rows for
    // the "Top posts" table and isn't representative once an org has more
    // than 50 posts across all accounts combined.
    supabase
      .from("post_targets")
      .select("id, platform, social_account_id, item_id")
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

  // ── Follower growth per platform (chart) ──
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

  // ── Per-account 30d follower growth (first vs. last day in window) ──
  const growthByAccount = new Map<string, { day: string; followers: number }[]>();
  for (const row of growth ?? []) {
    if (row.followers == null) continue;
    const arr = growthByAccount.get(row.social_account_id) ?? [];
    arr.push({ day: String(row.day), followers: row.followers });
    growthByAccount.set(row.social_account_id, arr);
  }
  for (const arr of growthByAccount.values()) arr.sort((a, b) => a.day.localeCompare(b.day));
  function accountGrowth30d(accountId: string): number | null {
    const arr = growthByAccount.get(accountId);
    if (!arr || arr.length < 2) return null;
    return arr[arr.length - 1].followers - arr[0].followers;
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

  // ── Per-account breakdown (last 30 days) — single source of truth that
  // the platform comparison table below is then rolled up from, so the two
  // views can never silently disagree. ──
  const recentIds = (recentTargets ?? []).map((t) => t.id);
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

  const postsByAccount = new Map<string, number>();
  const engagementSumByAccount = new Map<string, number>();
  const engagementRateSumByAccount = new Map<string, { sum: number; n: number }>();
  for (const t of recentTargets ?? []) {
    postsByAccount.set(t.social_account_id, (postsByAccount.get(t.social_account_id) ?? 0) + 1);
    const snap = latestRecentSnap.get(t.id);
    if (!snap) continue;
    const eng = (snap.likes ?? 0) + (snap.comments ?? 0) + (snap.shares ?? 0);
    engagementSumByAccount.set(
      t.social_account_id,
      (engagementSumByAccount.get(t.social_account_id) ?? 0) + eng
    );
    if (snap.engagement_rate != null) {
      const acc = engagementRateSumByAccount.get(t.social_account_id) ?? { sum: 0, n: 0 };
      acc.sum += snap.engagement_rate;
      acc.n += 1;
      engagementRateSumByAccount.set(t.social_account_id, acc);
    }
  }

  const latestByAccount = new Map((latest ?? []).map((m) => [m.social_account_id, m]));

  // ── Engagement by content type (image vs. video vs. text-only) ──
  // One batched query for every distinct item behind the date-range
  // targets, rather than a query per post.
  const itemIdsForMedia = [...new Set((recentTargets ?? []).map((t) => t.item_id))];
  const { data: mediaItems } = itemIdsForMedia.length
    ? await supabase
        .from("marketing_items")
        .select("id, media")
        .in("id", itemIdsForMedia)
    : { data: [] as { id: string; media: unknown }[] };
  const mediaTypeByItem = new Map(
    (mediaItems ?? []).map((mi) => {
      const media = (mi.media ?? []) as { type?: string }[];
      const type =
        media.length === 0
          ? "text"
          : media.some((m) => m.type === "video")
            ? "video"
            : "image";
      return [mi.id, type];
    })
  );
  const contentTypeAgg = new Map<string, { engagement: number; posts: number }>();
  for (const t of recentTargets ?? []) {
    const type = mediaTypeByItem.get(t.item_id) ?? "text";
    const snap = latestRecentSnap.get(t.id);
    const eng = snap ? (snap.likes ?? 0) + (snap.comments ?? 0) + (snap.shares ?? 0) : 0;
    const bucket = contentTypeAgg.get(type) ?? { engagement: 0, posts: 0 };
    bucket.engagement += eng;
    bucket.posts += 1;
    contentTypeAgg.set(type, bucket);
  }
  const CONTENT_TYPE_LABELS: Record<string, string> = {
    image: "Image",
    video: "Video",
    text: "Text only",
  };
  const contentTypeData = [...contentTypeAgg.entries()]
    .map(([type, v]) => ({
      type: CONTENT_TYPE_LABELS[type] ?? type,
      avgEngagement: v.posts > 0 ? Math.round(v.engagement / v.posts) : 0,
      posts: v.posts,
    }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement);

  // ── Hashtag performance ──
  // Which hashtags actually correlate with engagement — reuses the same
  // item batch already fetched above for content-type, just also pulling
  // `hashtags` instead of a second query.
  const { data: itemsForHashtags } = itemIdsForMedia.length
    ? await supabase
        .from("marketing_items")
        .select("id, hashtags")
        .in("id", itemIdsForMedia)
    : { data: [] as { id: string; hashtags: string[] }[] };
  const hashtagsByItem = new Map(
    (itemsForHashtags ?? []).map((mi) => [mi.id, mi.hashtags ?? []])
  );
  const hashtagAgg = new Map<string, { engagement: number; posts: number }>();
  for (const t of recentTargets ?? []) {
    const tags = hashtagsByItem.get(t.item_id) ?? [];
    if (tags.length === 0) continue;
    const snap = latestRecentSnap.get(t.id);
    const eng = snap ? (snap.likes ?? 0) + (snap.comments ?? 0) + (snap.shares ?? 0) : 0;
    for (const tag of tags) {
      const key = tag.toLowerCase();
      const bucket = hashtagAgg.get(key) ?? { engagement: 0, posts: 0 };
      bucket.engagement += eng;
      bucket.posts += 1;
      hashtagAgg.set(key, bucket);
    }
  }
  // Only hashtags used on 2+ posts in this window — a single-use tag's
  // "average" is really just that one post's number, not a pattern.
  const hashtagPerformance = [...hashtagAgg.entries()]
    .filter(([, v]) => v.posts >= 2)
    .map(([tag, v]) => ({
      tag,
      avgEngagement: Math.round(v.engagement / v.posts),
      posts: v.posts,
    }))
    .sort((a, b) => b.avgEngagement - a.avgEngagement)
    .slice(0, 15);

  interface AccountStat {
    id: string;
    platform: Platform;
    handle: string | null;
    displayName: string | null;
    avatarUrl: string | null;
    followers: number;
    growth30d: number | null;
    posts30d: number;
    totalEngagement30d: number;
    avgEngagementPerPost: number | null;
    avgEngagementRate: number | null;
    impressions: number;
  }

  const accountStats: AccountStat[] = (accounts ?? [])
    .map((a) => {
      const m = latestByAccount.get(a.id);
      const posts30d = postsByAccount.get(a.id) ?? 0;
      const totalEngagement30d = engagementSumByAccount.get(a.id) ?? 0;
      const rateAcc = engagementRateSumByAccount.get(a.id);
      return {
        id: a.id,
        platform: a.platform,
        handle: a.handle,
        displayName: a.display_name,
        avatarUrl: a.avatar_url,
        followers: m?.followers ?? 0,
        growth30d: accountGrowth30d(a.id),
        posts30d,
        totalEngagement30d,
        avgEngagementPerPost: posts30d > 0 ? totalEngagement30d / posts30d : null,
        avgEngagementRate: rateAcc && rateAcc.n > 0 ? rateAcc.sum / rateAcc.n : null,
        impressions: m?.impressions ?? 0,
      };
    })
    .sort((a, b) => b.followers - a.followers);

  // Platform-level rollup, aggregated from the per-account figures above
  // (not recomputed independently) so the comparison table and the account
  // cards can never disagree.
  interface PlatformStat {
    platform: Platform;
    accounts: number;
    followers: number;
    growth30d: number | null;
    posts30d: number;
    avgEngagementPerPost: number | null;
    avgEngagementRate: number | null;
    impressions: number;
  }
  const byPlatformGroup = new Map<Platform, AccountStat[]>();
  for (const s of accountStats) {
    const list = byPlatformGroup.get(s.platform) ?? [];
    list.push(s);
    byPlatformGroup.set(s.platform, list);
  }
  const platformStats: PlatformStat[] = [...byPlatformGroup.entries()]
    .map(([platform, group]) => {
      const posts30d = group.reduce((s, a) => s + a.posts30d, 0);
      const totalEngagement30d = group.reduce((s, a) => s + a.totalEngagement30d, 0);
      const rateGroup = group.filter((a) => a.avgEngagementRate != null);
      const growthGroup = group.filter((a) => a.growth30d != null);
      return {
        platform,
        accounts: group.length,
        followers: group.reduce((s, a) => s + a.followers, 0),
        growth30d:
          growthGroup.length > 0
            ? growthGroup.reduce((s, a) => s + (a.growth30d ?? 0), 0)
            : null,
        posts30d,
        avgEngagementPerPost: posts30d > 0 ? totalEngagement30d / posts30d : null,
        avgEngagementRate:
          rateGroup.length > 0
            ? rateGroup.reduce((s, a) => s + (a.avgEngagementRate ?? 0), 0) / rateGroup.length
            : null,
        impressions: group.reduce((s, a) => s + a.impressions, 0),
      };
    })
    .sort((a, b) => b.followers - a.followers);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Performance across every connected account, last {days} days.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RefreshDataButton />
          <DateRangeTabs current={days} />
        </div>
      </div>

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
            <CardDescription>Last {days} days, per platform</CardDescription>
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

      {contentTypeData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Engagement by content type</CardTitle>
            <CardDescription>
              Average engagement per post, image vs. video vs. text-only, last{" "}
              {days} days
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BarSeries
              data={contentTypeData}
              series={[{ key: "avgEngagement", label: "Avg engagement/post" }]}
              xKey="type"
            />
          </CardContent>
        </Card>
      )}

      {hashtagPerformance.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Hashtag performance</CardTitle>
            <CardDescription>
              Average engagement per post for hashtags used 2+ times, last{" "}
              {days} days
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Hashtag</TableHead>
                  <TableHead className="text-right">Posts</TableHead>
                  <TableHead className="text-right">Avg engagement/post</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {hashtagPerformance.map((h) => (
                  <TableRow key={h.tag}>
                    <TableCell className="font-medium text-primary">#{h.tag}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {h.posts}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(h.avgEngagement)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Platform comparison — aggregate rollup of every account below */}
      {platformStats.length > 1 && (
        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <SectionHeading
              title="Platform comparison"
              description="Every connected account on a platform, rolled into one row"
              noMargin
            />
            <ExportCsvButton
              filename={`platform-comparison-${days}d.csv`}
              headers={[
                "Platform",
                "Accounts",
                "Followers",
                `${days}d Growth`,
                `Posts (${days}d)`,
                "Avg engagement/post",
                "Engagement rate %",
                "Impressions",
              ]}
              rows={platformStats.map((r) => [
                PLATFORM_LABELS[r.platform],
                r.accounts,
                r.followers,
                r.growth30d ?? "",
                r.posts30d,
                r.avgEngagementPerPost == null ? "" : Math.round(r.avgEngagementPerPost),
                r.avgEngagementRate == null ? "" : r.avgEngagementRate.toFixed(1),
                r.impressions,
              ])}
            />
          </div>
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Platform</TableHead>
                    <TableHead className="text-right">Accounts</TableHead>
                    <TableHead className="text-right">Followers</TableHead>
                    <TableHead className="text-right">{days}d growth</TableHead>
                    <TableHead className="text-right">Posts ({days}d)</TableHead>
                    <TableHead className="text-right">Avg engagement/post</TableHead>
                    <TableHead className="text-right">Engagement rate</TableHead>
                    <TableHead className="text-right">Impressions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {platformStats.map((s) => (
                    <TableRow key={s.platform}>
                      <TableCell className="font-medium">
                        <span className="inline-flex items-center gap-2">
                          <PlatformDot platform={s.platform} />
                          {PLATFORM_LABELS[s.platform]}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {s.accounts}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {formatNumber(s.followers)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <GrowthValue value={s.growth30d} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(s.posts30d)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {s.avgEngagementPerPost == null
                          ? "—"
                          : formatNumber(Math.round(s.avgEngagementPerPost))}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatPercent(s.avgEngagementRate)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(s.impressions)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Per-account breakdown — every connected account shown individually,
          e.g. two Instagram accounts get two separate cards. */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <SectionHeading
            title="Accounts"
            description="Each connected account individually — sorted by followers"
            noMargin
          />
          {accountStats.length > 0 && (
            <ExportCsvButton
              filename={`account-breakdown-${days}d.csv`}
              headers={[
                "Account",
                "Platform",
                "Handle",
                "Followers",
                `${days}d Growth`,
                `Posts (${days}d)`,
                "Avg engagement/post",
                "Engagement rate %",
                "Impressions",
              ]}
              rows={accountStats.map((r) => [
                r.displayName ?? r.handle ?? "",
                PLATFORM_LABELS[r.platform],
                r.handle ?? "",
                r.followers,
                r.growth30d ?? "",
                r.posts30d,
                r.avgEngagementPerPost == null ? "" : Math.round(r.avgEngagementPerPost),
                r.avgEngagementRate == null ? "" : r.avgEngagementRate.toFixed(1),
                r.impressions,
              ])}
            />
          )}
        </div>
        {accountStats.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {accountStats.map((s) => (
              <AccountCard key={s.id} stat={s} />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              Connect a social account to see per-account stats.
            </CardContent>
          </Card>
        )}
      </section>

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
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topPosts.map(({ target, metrics }) => {
                const item = target.marketing_items as {
                  id: string;
                  title: string;
                } | null;
                const stale = metrics && isStale(metrics.captured_at, 36);
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
                        ? formatInTimeZone(target.published_at, timezone, {
                            dateStyle: "medium",
                          })
                        : "—"}
                    </TableCell>
                    <TableCell
                      className={
                        stale ? "font-medium text-warning" : "text-muted-foreground"
                      }
                      title={
                        stale
                          ? "No fresh metrics sync in over 36 hours — these numbers may not match the platform right now."
                          : undefined
                      }
                    >
                      {metrics ? relativeTime(metrics.captured_at) : "never"}
                    </TableCell>
                  </TableRow>
                );
              })}
              {topPosts.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8}
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

function SectionHeading({
  title,
  description,
  noMargin,
}: {
  title: string;
  description: string;
  noMargin?: boolean;
}) {
  return (
    <div className={noMargin ? undefined : "mb-3"}>
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

function PlatformDot({ platform }: { platform: Platform }) {
  return (
    <span
      className="size-2.5 shrink-0 rounded-full ring-2 ring-background"
      style={{ background: PLATFORM_COLORS[platform] }}
    />
  );
}

function GrowthValue({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  if (value === 0) return <span className="text-muted-foreground">0</span>;
  return (
    <span className={value > 0 ? "text-success" : "text-destructive"}>
      {value > 0 ? "+" : ""}
      {formatNumber(value)}
    </span>
  );
}

function AccountCard({
  stat,
}: {
  stat: {
    id: string;
    platform: Platform;
    handle: string | null;
    displayName: string | null;
    avatarUrl: string | null;
    followers: number;
    growth30d: number | null;
    posts30d: number;
    avgEngagementPerPost: number | null;
    avgEngagementRate: number | null;
    impressions: number;
  };
}) {
  const name = stat.displayName ?? stat.handle ?? "Account";
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          {stat.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={stat.avatarUrl}
              alt=""
              className="size-10 shrink-0 rounded-full ring-1 ring-border"
            />
          ) : (
            <div
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
              style={{ background: PLATFORM_COLORS[stat.platform] }}
            >
              {name.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold leading-tight">{name}</div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {stat.handle && <span className="truncate">@{stat.handle}</span>}
            </div>
          </div>
          <Badge variant="outline" className="shrink-0 gap-1.5">
            <PlatformDot platform={stat.platform} />
            {PLATFORM_LABELS[stat.platform]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-4 text-sm">
        <Metric label="Followers" value={formatNumber(stat.followers)} />
        <Metric label="30d growth" value={<GrowthValue value={stat.growth30d} />} />
        <Metric label="Posts (30d)" value={formatNumber(stat.posts30d)} />
        <Metric
          label="Avg engagement/post"
          value={
            stat.avgEngagementPerPost == null
              ? "—"
              : formatNumber(Math.round(stat.avgEngagementPerPost))
          }
        />
        <Metric label="Engagement rate" value={formatPercent(stat.avgEngagementRate)} />
        <Metric label="Impressions" value={formatNumber(stat.impressions)} />
      </CardContent>
    </Card>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium tabular-nums">{value}</div>
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