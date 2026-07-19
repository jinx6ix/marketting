import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionContext } from "@/lib/supabase/server";
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
import { Badge } from "@/components/ui/badge";
import { LineSeries } from "@/components/charts/line-series";
import { RadarCompare } from "@/components/charts/radar-compare";
import { PLATFORM_LABELS } from "@/components/charts/theme";
import {
  ManualSnapshotForm,
  DeleteCompetitorButton,
} from "@/features/competitors/components/snapshot-form";
import { formatNumber, relativeTime } from "@/lib/utils";
import type { Platform } from "@/types/database";

export const metadata = { title: "Competitor" };

/** Normalize a you/them pair to 0-100 against the max of the two. */
function norm(you: number, them: number): { you: number; them: number } {
  const max = Math.max(you, them, 1);
  return {
    you: Math.round((you / max) * 100),
    them: Math.round((them / max) * 100),
  };
}

export default async function CompetitorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { orgId, supabase } = await getSessionContext();

  const { data: competitor } = await supabase
    .from("competitors")
    .select("*, competitor_accounts(*)")
    .eq("id", id)
    .eq("org_id", orgId!)
    .single();
  if (!competitor) notFound();

  const accounts = competitor.competitor_accounts ?? [];
  const accountIds = accounts.map((a) => a.id);
  const since = new Date(Date.now() - 90 * 86400_000).toISOString();
  const since30 = new Date(Date.now() - 30 * 86400_000).toISOString();

  const [
    { data: snapshots },
    { data: posts },
    { data: ownLatest },
    { data: ownItems },
  ] = await Promise.all([
    accountIds.length
      ? supabase
          .from("competitor_snapshots")
          .select("*")
          .in("competitor_account_id", accountIds)
          .gte("captured_at", since)
          .order("captured_at")
      : Promise.resolve({ data: [] as never[] }),
    accountIds.length
      ? supabase
          .from("competitor_posts")
          .select("*")
          .in("competitor_account_id", accountIds)
          .order("posted_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [] as never[] }),
    supabase.from("v_account_latest_metrics").select("*").eq("org_id", orgId!),
    supabase
      .from("marketing_items")
      .select("id")
      .eq("org_id", orgId!)
      .in("status", ["published", "partially_published"])
      .gte("created_at", since30),
  ]);

  // ── Radar: you vs them, normalized ──
  const latestByAccount = new Map<string, NonNullable<typeof snapshots>[number]>();
  for (const s of snapshots ?? []) latestByAccount.set(s.competitor_account_id, s);

  const themFollowers = [...latestByAccount.values()].reduce(
    (s, x) => s + (x.followers ?? 0),
    0
  );
  const themEngagement = [...latestByAccount.values()].reduce(
    (s, x) => s + Number(x.avg_engagement ?? 0),
    0
  );
  const themFrequency = [...latestByAccount.values()].reduce(
    (s, x) => s + Number(x.posting_frequency ?? 0),
    0
  );
  const youFollowers = (ownLatest ?? []).reduce((s, m) => s + (m.followers ?? 0), 0);
  const youEngagement = (ownLatest ?? []).reduce(
    (s, m) => s + (m.engagement_total ?? 0),
    0
  );
  const youFrequency = ((ownItems ?? []).length / 30) * 7; // posts/week

  const fol = norm(youFollowers, themFollowers);
  const eng = norm(youEngagement, themEngagement);
  const freq = norm(youFrequency, themFrequency);
  const radarData = [
    { metric: "Followers", you: fol.you, them: fol.them },
    { metric: "Engagement", you: eng.you, them: eng.them },
    { metric: "Posts / week", you: freq.you, them: freq.them },
  ];

  // ── Follower history line (per competitor account) ──
  const dayAccount = new Map<string, Record<string, number>>();
  for (const s of snapshots ?? []) {
    if (s.followers == null) continue;
    const day = s.captured_at.slice(0, 10);
    const bucket = dayAccount.get(day) ?? {};
    bucket[s.competitor_account_id] = s.followers;
    dayAccount.set(day, bucket);
  }
  const historyData = [...dayAccount.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, buckets]) => ({ day: day.slice(5), ...buckets }));
  const historySeries = accounts.map((a) => ({
    key: a.id,
    label: `${PLATFORM_LABELS[a.platform as Platform] ?? a.platform} @${a.handle}`,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{competitor.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {competitor.destinations.map((d) => (
              <Badge key={d} variant="outline">
                {d}
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DeleteCompetitorButton id={competitor.id} name={competitor.name} />
          <Link href="/competitors" className="text-sm text-primary hover:underline">
            ← All competitors
          </Link>
        </div>
      </div>

      {competitor.notes && (
        <p className="max-w-2xl text-sm text-muted-foreground">{competitor.notes}</p>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>You vs {competitor.name}</CardTitle>
            <CardDescription>Normalized to the stronger side = 100</CardDescription>
          </CardHeader>
          <CardContent>
            <RadarCompare
              data={radarData}
              youLabel="You"
              themLabel={competitor.name}
            />
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Follower history</CardTitle>
            <CardDescription>Last 90 days of snapshots</CardDescription>
          </CardHeader>
          <CardContent>
            {historyData.length > 1 ? (
              <LineSeries data={historyData} series={historySeries} />
            ) : (
              <p className="py-12 text-center text-sm text-muted-foreground">
                Not enough snapshots yet — the competitor job polls every 6
                hours, or record one manually below.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Accounts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {accounts.map((a) => {
              const latest = latestByAccount.get(a.id);
              return (
                <div
                  key={a.id}
                  className="flex items-center justify-between rounded-md border p-2.5 text-sm"
                >
                  <div>
                    <div className="font-medium">
                      {PLATFORM_LABELS[a.platform as Platform] ?? a.platform} ·{" "}
                      {a.profile_url ? (
                        <a
                          href={a.profile_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-primary hover:underline"
                        >
                          @{a.handle}
                        </a>
                      ) : (
                        <>@{a.handle}</>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {a.last_polled_at
                        ? `Polled ${relativeTime(a.last_polled_at)}`
                        : "Never polled"}
                    </div>
                  </div>
                  <div className="text-right tabular-nums">
                    {formatNumber(latest?.followers)}
                    <div className="text-xs text-muted-foreground">followers</div>
                  </div>
                </div>
              );
            })}
            {accounts.length === 0 && (
              <p className="text-sm text-muted-foreground">No accounts.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Manual snapshot</CardTitle>
            <CardDescription>
              For platforms without public metrics
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ManualSnapshotForm
              accounts={accounts.map((a) => ({
                id: a.id,
                label: `${PLATFORM_LABELS[a.platform as Platform] ?? a.platform} @${a.handle}`,
              }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Latest metrics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Row label="Total followers" value={formatNumber(themFollowers)} />
            <Row
              label="Avg engagement"
              value={formatNumber(Math.round(themEngagement))}
            />
            <Row
              label="Posts / week"
              value={themFrequency ? themFrequency.toFixed(1) : "—"}
            />
            <Row
              label="Your posts / week"
              value={youFrequency ? youFrequency.toFixed(1) : "—"}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent posts</CardTitle>
          <CardDescription>
            Collected by the competitor polling job
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Posted</TableHead>
                <TableHead>Content</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Likes</TableHead>
                <TableHead>Comments</TableHead>
                <TableHead>Destinations</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(posts ?? []).map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {p.posted_at ? relativeTime(p.posted_at) : "—"}
                  </TableCell>
                  <TableCell className="max-w-md">
                    <span className="line-clamp-2">{p.content ?? "—"}</span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {p.media_type ?? "—"}
                  </TableCell>
                  <TableCell>{formatNumber(p.likes)}</TableCell>
                  <TableCell>{formatNumber(p.comments)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {p.destinations.length > 0 ? p.destinations.join(", ") : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {(posts ?? []).length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No posts collected yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
