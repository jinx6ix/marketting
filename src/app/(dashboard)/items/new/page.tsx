import { getSessionContext } from "@/lib/supabase/server";
import { Composer } from "@/features/marketing-items/components/composer";
import type { Platform } from "@/types/database";

export const metadata = { title: "New Item" };

export default async function NewItemPage() {
  const { orgId, supabase } = await getSessionContext();

  const [{ data: accounts }, { data: campaigns }] = await Promise.all([
    supabase
      .from("social_accounts")
      .select("id, platform, handle, display_name")
      .eq("org_id", orgId!)
      .eq("status", "active")
      .order("platform"),
    supabase
      .from("campaigns")
      .select("id, name")
      .eq("org_id", orgId!)
      .in("status", ["draft", "active"])
      .order("name"),
  ]);

  return (
    <Composer
      orgId={orgId!}
      accounts={(accounts ?? []) as { id: string; platform: Platform; handle: string | null; display_name: string | null }[]}
      campaigns={campaigns ?? []}
    />
  );
}
