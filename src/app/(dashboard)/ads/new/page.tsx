import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getSessionContext } from "@/lib/supabase/server";
import { AdCampaignForm } from "@/features/ads/components/ad-campaign-form";
import type { Platform } from "@/types/database";

export const metadata = { title: "New Ad Campaign" };

export default async function NewAdCampaignPage() {
  const { orgId, supabase } = await getSessionContext();

  const [{ data: accounts }, { data: items }] = await Promise.all([
    supabase
      .from("social_accounts")
      .select("id, platform, handle, display_name")
      .eq("org_id", orgId!)
      .eq("status", "active")
      .order("platform"),
    supabase
      .from("marketing_items")
      .select("id, title")
      .eq("org_id", orgId!)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/ads"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          All ads
        </Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">New ad campaign</h1>
      </div>
      <AdCampaignForm
        accounts={
          (accounts ?? []) as {
            id: string;
            platform: Platform;
            handle: string | null;
            display_name: string | null;
          }[]
        }
        items={items ?? []}
      />
    </div>
  );
}