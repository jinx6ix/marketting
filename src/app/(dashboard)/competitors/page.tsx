import Link from "next/link";
import { Plus } from "lucide-react";
import { getSessionContext } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Sparkline } from "@/components/charts/sparkline";
import { PLATFORM_LABELS } from "@/components/charts/theme";
import { daysAgoIso, formatNumber } from "@/lib/utils";
import type { Platform } from "@/types/database";

export const metadata = { title: "Competitors" };

export default async function CompetitorsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const { orgId, supabase } = await getSessionContext();
  const sp = await searchParams;

  if (sp.new !== undefined) {
    const { CompetitorForm } = await import(
      "@/features/competitors/components/competitor-form"
    );
    return <CompetitorForm />;
  }

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Competitors</h1>
        <Button asChild>
          <Link href="/competitors?new" className="flex items-center gap-1.5">
            <Plus className="size-4" /> Add competitor
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(competitors ?? []).map((c) => {
          const accounts = c.competitor_accounts ?? [];
          const totalFollowers = accounts.reduce(
            (s, a) => s + (latestByAccount.get(a.id)?.followers ?? 0),
            0
          );
          // sparkline: use the account with the most history
          const spark =
            accounts
              .map((a) => historyByAccount.get(a.id) ?? [])
              .sort((a, b) => b.length - a.length)[0] ?? [];
          return (
            <Link key={c.id} href={`/competitors/${c.id}`}>
              <Card className="h-full transition-colors hover:border-primary/50">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{c.name}</CardTitle>
                    {spark.length > 1 && (
                      <Sparkline values={spark} color="var(--chart-5)" />
                    )}
                  </div>
                  <CardDescription>
                    {c.destinations.length > 0
                      ? c.destinations.slice(0, 3).join(", ")
                      : "No destinations tagged"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="text-sm">
                    <span className="text-2xl font-semibold tabular-nums">
                      {formatNumber(totalFollowers)}
                    </span>{" "}
                    <span className="text-muted-foreground">followers tracked</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
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
                </CardContent>
              </Card>
            </Link>
          );
        })}
        {(competitors ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            No competitors tracked yet — add rival agencies to compare
            followers, posting cadence, and destination coverage.
          </p>
        )}
      </div>
    </div>
  );
}
