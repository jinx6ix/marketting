"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/supabase/server";

export interface ActionResult {
  error?: string;
  id?: string;
}

interface CreateItemAction {
  type?: string;
  platforms?: string[];
  title?: string;
  body_draft?: string;
  hashtags?: string[];
  destination?: string;
}

/**
 * Accept a recommendation: if it carries a suggested create_item, materialize
 * it as a draft marketing item (with targets for matching connected accounts)
 * and link it back via created_item_id.
 */
export async function acceptRecommendation(id: string): Promise<ActionResult> {
  const { user, orgId, supabase } = await getSessionContext();
  if (!user || !orgId) return { error: "Unauthorized" };

  const { data: rec } = await supabase
    .from("ai_recommendations")
    .select("*")
    .eq("id", id)
    .eq("org_id", orgId)
    .single();
  if (!rec) return { error: "Recommendation not found" };
  if (rec.status !== "proposed") {
    return { error: `Already ${rec.status}` };
  }

  const suggestion = (rec.suggested_action as { create_item?: CreateItemAction } | null)
    ?.create_item;

  let createdItemId: string | null = null;
  if (suggestion) {
    const itemType = ["social_post", "promotion", "announcement"].includes(
      suggestion.type ?? ""
    )
      ? (suggestion.type as "social_post" | "promotion" | "announcement")
      : "social_post";

    const { data: item, error: itemError } = await supabase
      .from("marketing_items")
      .insert({
        org_id: orgId,
        type: itemType,
        title: suggestion.title ?? rec.title,
        body: suggestion.body_draft ?? "",
        hashtags: suggestion.hashtags ?? [],
        destination: suggestion.destination ?? null,
        status: "draft",
        ai_generated: true,
        created_by: user.id,
      })
      .select("id")
      .single();
    if (itemError || !item) {
      return { error: itemError?.message ?? "Failed to create item" };
    }
    createdItemId = item.id;

    // Target connected accounts on the suggested platforms
    if (suggestion.platforms?.length) {
      const { data: accounts } = await supabase
        .from("social_accounts")
        .select("id, platform")
        .eq("org_id", orgId)
        .eq("status", "active")
        .in("platform", suggestion.platforms as never[]);
      if (accounts?.length) {
        await supabase.from("post_targets").insert(
          accounts.map((a) => ({
            org_id: orgId,
            item_id: item.id,
            social_account_id: a.id,
            platform: a.platform,
          }))
        );
      }
    }
  }

  const { error } = await supabase
    .from("ai_recommendations")
    .update({
      status: "accepted",
      created_item_id: createdItemId,
    })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/strategies");
  revalidatePath(`/strategies/${rec.strategy_id}`);
  revalidatePath("/items");
  return { id: createdItemId ?? id };
}

export async function dismissRecommendation(id: string): Promise<ActionResult> {
  const { user, orgId, supabase } = await getSessionContext();
  if (!user || !orgId) return { error: "Unauthorized" };

  const { data: rec, error } = await supabase
    .from("ai_recommendations")
    .update({ status: "dismissed" })
    .eq("id", id)
    .eq("org_id", orgId)
    .select("strategy_id")
    .single();
  if (error || !rec) return { error: error?.message ?? "Update failed" };

  revalidatePath(`/strategies/${rec.strategy_id}`);
  return { id };
}

export async function deleteStrategy(id: string): Promise<ActionResult> {
  const { user, orgId, supabase } = await getSessionContext();
  if (!user || !orgId) return { error: "Unauthorized" };

  const { error } = await supabase
    .from("ai_strategies")
    .delete()
    .eq("id", id)
    .eq("org_id", orgId);
  if (error) return { error: error.message };

  revalidatePath("/strategies");
  return { id };
}
