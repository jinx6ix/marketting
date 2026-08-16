import Link from "next/link";
import { ArrowLeft, Hash } from "lucide-react";
import { getSessionContext } from "@/lib/supabase/server";
import { Composer } from "@/features/marketing-items/components/composer";
import type { Platform } from "@/types/database";

export const metadata = { title: "New Item" };

export default async function NewItemPage() {
  const { orgId, supabase } = await getSessionContext();

  const [{ data: accounts }, { data: campaigns }, { data: org }] =
    await Promise.all([
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
      supabase
        .from("organizations")
        .select("default_hashtags")
        .eq("id", orgId!)
        .single(),
    ]);

  const defaultHashtags = org?.default_hashtags ?? [];

  return (
    <div className="max-w-5xl space-y-4">
      <div>
        <Link
          href="/items"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          Back to items
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">New marketing item</h1>
            <p className="text-sm text-muted-foreground">
              Write a master copy, then optionally customize it per platform below.
            </p>
          </div>
          {defaultHashtags.length > 0 && (
            <div className="flex items-center gap-1.5 rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs text-muted-foreground">
              <Hash className="size-3.5 shrink-0" />
              <span>
                {defaultHashtags.length} default hashtag
                {defaultHashtags.length === 1 ? "" : "s"} pre-filled from{" "}
                <Link href="/settings/organization" className="text-primary hover:underline">
                  org settings
                </Link>
              </span>
            </div>
          )}
        </div>
      </div>

      {defaultHashtags.length === 0 && (
        <div className="flex items-start gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          <Hash className="mt-0.5 size-3.5 shrink-0" />
          <span>
            No default hashtags configured yet — items you create will start
            with an empty hashtag list. Set some up under{" "}
            <Link href="/settings/organization" className="text-primary hover:underline">
              Settings → Organization
            </Link>{" "}
            to have them pre-filled here automatically.
          </span>
        </div>
      )}

      <Composer
        orgId={orgId!}
        accounts={
          (accounts ?? []) as {
            id: string;
            platform: Platform;
            handle: string | null;
            display_name: string | null;
          }[]
        }
        campaigns={campaigns ?? []}
        initial={{ hashtags: defaultHashtags }}
      />
    </div>
  );
}