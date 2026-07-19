import { notFound } from "next/navigation";
import Link from "next/link";
import { getSessionContext } from "@/lib/supabase/server";
import { CampaignForm } from "@/features/campaigns/components/campaign-form";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
              </TableRow>
            </TableHeader>
            <TableBody>
              {(items ?? []).map((i) => (
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
                    {i.scheduled_at ? new Date(i.scheduled_at).toLocaleString() : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {(items ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                    No items yet —{" "}
                    <Link href="/items/new" className="text-primary hover:underline">
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
    </div>
  );
}
