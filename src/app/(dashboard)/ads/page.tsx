import Link from "next/link";
import { Plus, Megaphone } from "lucide-react";
import { getSessionContext } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatTile } from "@/components/charts/stat-tile";
import { PLATFORM_COLORS, PLATFORM_LABELS } from "@/components/charts/theme";
import { formatNumber } from "@/lib/utils";
import type { Platform } from "@/types/database";

export const metadata = { title: "Ads" };

export default async function AdsPage() {
  const { orgId, supabase } = await getSessionContext();

  const [{ data: campaigns }, { data: allSnapshots }] = await Promise.all([
    supabase
      .from("ad_campaigns")
      .select("*")
      .eq("org_id", orgId!)
      .order("created_at", { ascending: false }),
    supabase
      .from("ad_performance_snapshots")
      .select("campaign_id, spend, impressions, clicks")
      .eq("org_id", orgId!),
  ]);

  const spendByCampaign = new Map<string, { spend: number; impressions: number; clicks: number }>();
  for (const s of allSnapshots ?? []) {
    const bucket = spendByCampaign.get(s.campaign_id) ?? { spend: 0, impressions: 0, clicks: 0 };
    bucket.spend += s.spend ?? 0;
    bucket.impressions += s.impressions ?? 0;
    bucket.clicks += s.clicks ?? 0;
    spendByCampaign.set(s.campaign_id, bucket);
  }

  const activeCount = (campaigns ?? []).filter((c) => c.status === "active").length;
  const totalSpend = [...spendByCampaign.values()].reduce((s, v) => s + v.spend, 0);
  const liveCount = (campaigns ?? []).filter((c) => c.management_mode === "live").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Ads</h1>
          <p className="text-sm text-muted-foreground">
            Plan and track ad campaigns — internally, or live via a connected
            ad account.
          </p>
        </div>
        <Button asChild>
          <Link href="/ads/new" className="flex items-center gap-1.5">
            <Plus className="size-4" /> New campaign
          </Link>
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Active campaigns" value={activeCount} format="raw" />
        <StatTile label="Total spend tracked" value={totalSpend} format="raw" />
        <StatTile label="Live-mode campaigns" value={liveCount} format="raw" />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(campaigns ?? []).map((c) => {
          const perf = spendByCampaign.get(c.id);
          return (
            <Link key={c.id} href={`/ads/${c.id}`}>
              <Card className="h-full transition-colors hover:border-primary/50">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{c.name}</CardTitle>
                    <StatusBadge status={c.status} />
                  </div>
                  <CardDescription className="flex flex-wrap items-center gap-1.5">
                    <span
                      className="size-2 rounded-full"
                      style={{ background: PLATFORM_COLORS[c.platform as Platform] }}
                    />
                    {PLATFORM_LABELS[c.platform as Platform]}
                    <Badge variant="outline">
                      {c.management_mode === "live" ? "Live" : "Internal"}
                    </Badge>
                    {c.last_sync_error && (
                      <Badge variant="destructive">Sync issue</Badge>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">Budget</div>
                    <div className="font-medium">
                      {c.budget != null ? `${c.currency} ${formatNumber(c.budget)}` : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Spend</div>
                    <div className="font-medium">
                      {perf ? `${c.currency} ${formatNumber(perf.spend)}` : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Clicks</div>
                    <div className="font-medium">{formatNumber(perf?.clicks ?? 0)}</div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
        {(campaigns ?? []).length === 0 && (
          <Card className="md:col-span-2 xl:col-span-3">
            <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
              <Megaphone className="size-8 text-muted-foreground" />
              <div>
                <p className="font-medium">No ad campaigns yet</p>
                <p className="text-sm text-muted-foreground">
                  Track budgets and performance internally, or push a
                  campaign live via a connected ad account.
                </p>
              </div>
              <Button asChild>
                <Link href="/ads/new" className="flex items-center gap-1.5">
                  <Plus className="size-4" /> New campaign
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}