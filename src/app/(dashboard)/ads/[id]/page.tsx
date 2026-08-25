import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { getSessionContext } from "@/lib/supabase/server";
import { getOrgTimezone } from "@/lib/org-timezone";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
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
import { AdStatusControls } from "@/features/ads/components/ad-status-controls";
import { RecordPerformanceForm } from "@/features/ads/components/record-performance-form";
import { SyncLiveButton } from "@/features/ads/components/sync-live-button";
import { PLATFORM_LABELS } from "@/components/charts/theme";
import { formatNumber, formatInTimeZone, relativeTime } from "@/lib/utils";
import type { Platform } from "@/types/database";

export const metadata = { title: "Ad Campaign" };

export default async function AdCampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { orgId, supabase } = await getSessionContext();
  const timezone = await getOrgTimezone(supabase, orgId!);

  const { data: campaign } = await supabase
    .from("ad_campaigns")
    .select("*, marketing_items(title), social_accounts(handle, display_name)")
    .eq("id", id)
    .eq("org_id", orgId!)
    .single();
  if (!campaign) notFound();

  const { data: snapshots } = await supabase
    .from("ad_performance_snapshots")
    .select("*")
    .eq("campaign_id", id)
    .order("captured_at", { ascending: false })
    .limit(50);

  const totals = (snapshots ?? []).reduce(
    (acc, s) => ({
      spend: acc.spend + (s.spend ?? 0),
      impressions: acc.impressions + (s.impressions ?? 0),
      clicks: acc.clicks + (s.clicks ?? 0),
      conversions: acc.conversions + (s.conversions ?? 0),
    }),
    { spend: 0, impressions: 0, clicks: 0, conversions: 0 }
  );

  const linkedItem = campaign.marketing_items as { title: string } | null;
  const linkedAccount = campaign.social_accounts as
    | { handle: string | null; display_name: string | null }
    | null;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link
          href="/ads"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          All ads
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{campaign.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <StatusBadge status={campaign.status} />
              <Badge variant="outline">
                {campaign.management_mode === "live" ? "Live" : "Internal"}
              </Badge>
              <span>{PLATFORM_LABELS[campaign.platform as Platform]}</span>
              <span>· {campaign.objective}</span>
            </div>
          </div>
          <AdStatusControls id={id} status={campaign.status} />
        </div>
      </div>

      {campaign.last_sync_error && (
        <Card className="border-destructive/50">
          <CardContent className="flex items-start gap-2 py-4 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{campaign.last_sync_error}</span>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <div>
            <div className="text-xs text-muted-foreground">Budget</div>
            <div className="font-medium">
              {campaign.budget != null ? `${campaign.currency} ${formatNumber(campaign.budget)}` : "—"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Dates</div>
            <div className="font-medium">
              {campaign.start_date ?? "—"} → {campaign.end_date ?? "—"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Destination</div>
            <div className="font-medium">{campaign.destination ?? "—"}</div>
          </div>
          {linkedItem && (
            <div>
              <div className="text-xs text-muted-foreground">Linked creative</div>
              <div className="font-medium">{linkedItem.title}</div>
            </div>
          )}
          {campaign.management_mode === "live" && (
            <>
              <div>
                <div className="text-xs text-muted-foreground">Ad account</div>
                <div className="font-medium">
                  {linkedAccount?.display_name ?? linkedAccount?.handle ?? "—"} /{" "}
                  {campaign.meta_ad_account_id}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Last synced</div>
                <div className="font-medium">
                  {campaign.last_synced_at ? relativeTime(campaign.last_synced_at) : "never"}
                </div>
              </div>
            </>
          )}
          {campaign.targeting_notes && (
            <div className="col-span-full">
              <div className="text-xs text-muted-foreground">Targeting notes</div>
              <p className="whitespace-pre-wrap">{campaign.targeting_notes}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Total spend" value={`${campaign.currency} ${formatNumber(totals.spend)}`} />
        <StatCard label="Impressions" value={formatNumber(totals.impressions)} />
        <StatCard label="Clicks" value={formatNumber(totals.clicks)} />
        <StatCard label="Conversions" value={formatNumber(totals.conversions)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Performance</CardTitle>
          <CardDescription>
            {campaign.management_mode === "live"
              ? "Pulled from Meta, or entered manually as a backup."
              : "Entered manually — this campaign runs outside the app."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {campaign.management_mode === "live" && campaign.external_campaign_id && (
            <SyncLiveButton campaignId={id} />
          )}
          <RecordPerformanceForm campaignId={id} />

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Spend</TableHead>
                <TableHead className="text-right">Impressions</TableHead>
                <TableHead className="text-right">Clicks</TableHead>
                <TableHead className="text-right">Conversions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(snapshots ?? []).map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="text-muted-foreground">
                    {formatInTimeZone(s.captured_at, timezone, { dateStyle: "medium", timeStyle: "short" })}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{s.source}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(s.spend)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(s.impressions)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(s.clicks)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(s.conversions)}</TableCell>
                </TableRow>
              ))}
              {(snapshots ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                    No performance entries yet.
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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-lg font-semibold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}