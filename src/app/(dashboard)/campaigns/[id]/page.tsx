import { notFound } from "next/navigation";
import Link from "next/link";
import { getSessionContext } from "@/lib/supabase/server";
import { CampaignForm } from "@/features/campaigns/components/campaign-form";
import { UtmBuilder } from "@/features/campaigns/components/utm-builder";
import { StatusBadge } from "@/components/status-badge";
import { StatTile } from "@/components/charts/stat-tile";
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
import { formatNumber } from "@/lib/utils";

export const metadata = { title: "Campaign" };

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { orgId, supabase } = await getSessionContext();

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .eq("org_id", orgId!)
    .single();
  if (!campaign) notFound();

  const { data: items } = await supabase
    .from("marketing_items")
    .select("id, title, type, status, scheduled_at")
    .eq("campaign_id", id)
    .order("scheduled_at", { ascending: true, nullsFirst: false });

  // ── Performance rollup: latest snapshot per published target ──
  const itemIds = (items ?? []).map((i) => i.id);
  const { data: targets } = itemIds.length
    ? await supabase
        .from("post_targets")
        .select("id, item_id, status")
        .in("item_id", itemIds)
    : { data: [] as never[] };
  const targetIds = (targets ?? []).map((t) => t.id);
  const { data: snapshots } = targetIds.length
    ? await supabase
        .from("post_metric_snapshots")
        .select(
          "post_target_id, likes, comments, shares, impressions, reach, captured_at"
        )
        .in("post_target_id", targetIds)
        .order("captured_at", { ascending: false })
    : { data: [] as never[] };

  const latestByTarget = new Map<string, NonNullable<typeof snapshots>[number]>();
  for (const s of snapshots ?? []) {
    if (!latestByTarget.has(s.post_target_id)) latestByTarget.set(s.post_target_id, s);
  }

  const targetsByItem = new Map<string, string[]>();
  for (const t of targets ?? []) {
    const list = targetsByItem.get(t.item_id) ?? [];
    list.push(t.id);
    targetsByItem.set(t.item_id, list);
  }

  const itemEngagement = (itemId: string) => {
    let likes = 0,
      comments = 0,
      shares = 0,
      impressions = 0;
    for (const targetId of targetsByItem.get(itemId) ?? []) {
      const m = latestByTarget.get(targetId);
      if (!m) continue;
      likes += m.likes ?? 0;
      comments += m.comments ?? 0;
      shares += m.shares ?? 0;
      impressions += Number(m.impressions ?? 0);
    }
    return { likes, comments, shares, impressions };
  };

  const totals = itemIds.reduce(
    (acc, itemId) => {
      const e = itemEngagement(itemId);
      return {
        likes: acc.likes + e.likes,
        comments: acc.comments + e.comments,
        shares: acc.shares + e.shares,
        impressions: acc.impressions + e.impressions,
      };
    },
    { likes: 0, comments: 0, shares: 0, impressions: 0 }
  );
  const published = (items ?? []).filter((i) =>
    ["published", "partially_published"].includes(i.status)
  ).length;

  return (
    <div className="space-y-8">
      <CampaignForm
        campaignId={id}
        initial={{
          name: campaign.name,
          description: campaign.description ?? undefined,
          objective: campaign.objective ?? undefined,
          destination: campaign.destination ?? undefined,
          tour_package: campaign.tour_package ?? undefined,
          start_date: campaign.start_date ?? undefined,
          end_date: campaign.end_date ?? undefined,
          budget: campaign.budget ?? undefined,
          status: campaign.status,
        }}
      />

      <div className="max-w-2xl space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Impressions" value={totals.impressions} />
          <StatTile label="Likes" value={totals.likes} />
          <StatTile label="Comments" value={totals.comments} />
          <StatTile label="Shares" value={totals.shares} />
        </div>
        <p className="text-xs text-muted-foreground">
          Aggregated from the latest metric snapshot of every published post in
          this campaign ({published} of {itemIds.length} items published).
        </p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Items in this campaign</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Scheduled</TableHead>
                <TableHead>Engagement</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(items ?? []).map((i) => {
                const e = itemEngagement(i.id);
                const engagement = e.likes + e.comments + e.shares;
                return (
                  <TableRow key={i.id}>
                    <TableCell>
                      <Link href={`/items/${i.id}`} className="hover:underline">
                        {i.title}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={i.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {i.scheduled_at
                        ? new Date(i.scheduled_at).toLocaleString()
                        : "—"}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {engagement > 0 ? formatNumber(engagement) : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
              {(items ?? []).length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="py-6 text-center text-muted-foreground"
                  >
                    No items yet —{" "}
                    <Link
                      href="/items/new"
                      className="text-primary hover:underline"
                    >
                      create one
                    </Link>{" "}
                    and assign it to this campaign.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>UTM link builder</CardTitle>
          <CardDescription>
            Tag landing-page links so bookings can be attributed to this
            campaign in your web analytics.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UtmBuilder campaignName={campaign.name} />
        </CardContent>
      </Card>
    </div>
  );
}
