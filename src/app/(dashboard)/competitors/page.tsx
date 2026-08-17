import Link from "next/link";
import { Plus, Search, Users } from "lucide-react";
import { getSessionContext } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatTile } from "@/components/charts/stat-tile";
import { Sparkline } from "@/components/charts/sparkline";
import { PLATFORM_LABELS } from "@/components/charts/theme";
import { ArchiveCompetitorButton } from "@/features/competitors/components/snapshot-form";
import { daysAgoIso, formatNumber, cn } from "@/lib/utils";
import type { Platform } from "@/types/database";

export const metadata = { title: "Competitors" };

type StatusFilter = "active" | "archived" | "all";

export default async function CompetitorsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; q?: string; status?: string }>;
}) {
  const { orgId, supabase } = await getSessionContext();
  const sp = await searchParams;

  if (sp.new !== undefined) {
    const { CompetitorForm } = await import(
      "@/features/competitors/components/competitor-form"
    );
    return <CompetitorForm />;
  }

  const status: StatusFilter =
    sp.status === "archived" || sp.status === "all" ? sp.status : "active";
  const q = (sp.q ?? "").trim();

  const since = daysAgoIso(30);

  const [{ data: competitors }, { data: latest }, { data: history }] =
    await Promise.all([
      supabase
        .from("competitors")
        .select("*, competitor_accounts(id, platform, handle)")
        .eq("org_id", orgId!)
        .order("created_at", { ascending: false }),
      supabase.from("v_competitor_latest").select("*").eq("org_id", orgId!),
      supabase
        .from("competitor_snapshots")
        .select("competitor_account_id, captured_at, followers")
        .eq("org_id", orgId!)
        .gte("captured_at", since)
        .order("captured_at"),
    ]);

  const latestByAccount = new Map(
    (latest ?? []).map((l) => [l.competitor_account_id, l])
  );
  const historyByAccount = new Map<string, number[]>();
  for (const s of history ?? []) {
    if (s.followers == null) continue;
    const arr = historyByAccount.get(s.competitor_account_id) ?? [];
    arr.push(s.followers);
    historyByAccount.set(s.competitor_account_id, arr);
  }

  const enriched = (competitors ?? []).map((c) => {
    const accounts = c.competitor_accounts ?? [];
    const totalFollowers = accounts.reduce(
      (s, a) => s + (latestByAccount.get(a.id)?.followers ?? 0),
      0
    );
    const growth30d = accounts.reduce((s, a) => {
      const arr = historyByAccount.get(a.id) ?? [];
      if (arr.length < 2) return s;
      return s + (arr[arr.length - 1] - arr[0]);
    }, 0);
    const hasHistory = accounts.some(
      (a) => (historyByAccount.get(a.id) ?? []).length >= 2
    );
    const spark =
      accounts
        .map((a) => historyByAccount.get(a.id) ?? [])
        .sort((a, b) => b.length - a.length)[0] ?? [];
    return { competitor: c, accounts, totalFollowers, growth30d, hasHistory, spark };
  });

  const activeCount = enriched.filter((e) => e.competitor.active).length;
  const archivedCount = enriched.length - activeCount;
  const totalFollowersTracked = enriched
    .filter((e) => e.competitor.active)
    .reduce((s, e) => s + e.totalFollowers, 0);
  const frequencies = (latest ?? [])
    .map((l) => Number(l.posting_frequency ?? 0))
    .filter((n) => n > 0);
  const avgPostsPerWeek =
    frequencies.length > 0
      ? frequencies.reduce((s, n) => s + n, 0) / frequencies.length
      : null;

  const visible = enriched
    .filter((e) =>
      status === "all" ? true : status === "archived" ? !e.competitor.active : e.competitor.active
    )
    .filter((e) =>
      q ? e.competitor.name.toLowerCase().includes(q.toLowerCase()) : true
    )
    .sort((a, b) => b.totalFollowers - a.totalFollowers);

  const TABS: { label: string; value: StatusFilter; count: number }[] = [
    { label: "Active", value: "active", count: activeCount },
    { label: "Archived", value: "archived", count: archivedCount },
    { label: "All", value: "all", count: enriched.length },
  ];

  function tabHref(value: StatusFilter) {
    const params = new URLSearchParams();
    if (value !== "active") params.set("status", value);
    if (q) params.set("q", q);
    const qs = params.toString();
    return qs ? `/competitors?${qs}` : "/competitors";
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Competitors</h1>
          <p className="text-sm text-muted-foreground">
            Track rival agencies to compare followers, posting cadence, and
            destination coverage.
          </p>
        </div>
        <Button asChild>
          <Link href="/competitors?new" className="flex items-center gap-1.5">
            <Plus className="size-4" /> Add competitor
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Active competitors" value={activeCount} format="raw" />
        <StatTile label="Followers tracked" value={totalFollowersTracked} />
        <StatTile
          label="Avg. posts/week"
          value={avgPostsPerWeek == null ? null : avgPostsPerWeek.toFixed(1)}
          format="raw"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-md border p-0.5">
          {TABS.map((t) => (
            <Link
              key={t.value}
              href={tabHref(t.value)}
              className={cn(
                "rounded px-3 py-1 text-xs transition-colors",
                status === t.value
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent"
              )}
            >
              {t.label} ({t.count})
            </Link>
          ))}
        </div>
        <form action="/competitors" method="GET" className="relative">
          {status !== "active" && <input type="hidden" name="status" value={status} />}
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={q}
            placeholder="Search competitors…"
            className="h-8 w-56 pl-8 text-sm"
          />
        </form>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visible.map(({ competitor: c, accounts, totalFollowers, growth30d, hasHistory, spark }) => (
          <Card key={c.id} className={cn("flex flex-col", !c.active && "opacity-70")}>
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <Link href={`/competitors/${c.id}`} className="min-w-0">
                  <CardTitle className="truncate text-base hover:underline">
                    {c.name}
                  </CardTitle>
                </Link>
                {spark.length > 1 && <Sparkline values={spark} color="var(--chart-5)" />}
              </div>
              <CardDescription className="flex items-center gap-1.5">
                {!c.active && (
                  <Badge variant="outline" className="shrink-0">
                    Archived
                  </Badge>
                )}
                <span className="truncate">
                  {c.destinations.length > 0
                    ? c.destinations.slice(0, 3).join(", ")
                    : "No destinations tagged"}
                </span>
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col justify-between space-y-3">
              <div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-semibold tabular-nums">
                    {formatNumber(totalFollowers)}
                  </span>
                  <span className="text-sm text-muted-foreground">followers</span>
                  {hasHistory && (
                    <span
                      className={cn(
                        "text-xs font-medium tabular-nums",
                        growth30d > 0
                          ? "text-success"
                          : growth30d < 0
                            ? "text-destructive"
                            : "text-muted-foreground"
                      )}
                    >
                      {growth30d > 0 ? "+" : ""}
                      {formatNumber(growth30d)} / 30d
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {accounts.map((a) => (
                    <Badge key={a.id} variant="outline">
                      {PLATFORM_LABELS[a.platform as Platform] ?? a.platform} ·{" "}
                      @{a.handle}
                    </Badge>
                  ))}
                  {accounts.length === 0 && (
                    <span className="text-xs text-muted-foreground">
                      No accounts yet
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between border-t pt-3">
                <Link
                  href={`/competitors/${c.id}`}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  View details →
                </Link>
                <ArchiveCompetitorButton id={c.id} active={c.active} />
              </div>
            </CardContent>
          </Card>
        ))}

        {visible.length === 0 && enriched.length > 0 && (
          <Card className="md:col-span-2 xl:col-span-3">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              {q
                ? `No competitors match "${q}".`
                : `No ${status === "all" ? "" : status} competitors.`}
            </CardContent>
          </Card>
        )}

        {enriched.length === 0 && (
          <Card className="md:col-span-2 xl:col-span-3">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <Users className="size-8 text-muted-foreground" />
              <div>
                <p className="font-medium">No competitors tracked yet</p>
                <p className="text-sm text-muted-foreground">
                  Add rival agencies to compare followers, posting cadence,
                  and destination coverage.
                </p>
              </div>
              <Button asChild size="sm">
                <Link href="/competitors?new" className="flex items-center gap-1.5">
                  <Plus className="size-4" /> Add competitor
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}