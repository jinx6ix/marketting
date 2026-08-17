import Link from "next/link";
import { Plus } from "lucide-react";
import { getSessionContext } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export const metadata = { title: "Campaigns" };

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const { orgId, supabase } = await getSessionContext();
  const sp = await searchParams;

  if (sp.new !== undefined) {
    const { CampaignForm } = await import(
      "@/features/campaigns/components/campaign-form"
    );
    return <CampaignForm />;
  }

  const { data: campaigns } = await supabase
    .from("campaigns")
    .select("*, marketing_items(id, status)")
    .eq("org_id", orgId!)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Campaigns</h1>
        <Button asChild>
          <Link href="/campaigns?new" className="flex items-center gap-1.5">
            <Plus className="size-4" /> New campaign
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(campaigns ?? []).map((c) => {
          const items = (c.marketing_items ?? []) as { status: string }[];
          const published = items.filter((i) =>
            ["published", "partially_published"].includes(i.status)
          ).length;
          return (
            <Link key={c.id} href={`/campaigns/${c.id}`}>
              <Card className="h-full transition-colors hover:border-primary/50">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{c.name}</CardTitle>
                    <StatusBadge status={c.status} />
                  </div>
                  <CardDescription>
                    {c.destination ?? "No destination"} ·{" "}
                    {c.objective ?? "no objective"}
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  <div>
                    {items.length} items · {published} published
                  </div>
                  {c.start_date && (
                    <div className="mt-1 text-xs">
                      {c.start_date} → {c.end_date ?? "…"}
                    </div>
                  )}
                </CardContent>
              </Card>
            </Link>
          );
        })}
        {(campaigns ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">
            No campaigns yet — group related marketing items into a campaign to
            track aggregate performance.
          </p>
        )}
      </div>
    </div>
  );
}