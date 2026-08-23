"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/supabase/server";
import { friendlyActionError } from "@/lib/jobs/action-errors";
import { Platform } from "@/types/database"; // Add this import

export interface ActionResult {
  error?: string;
  id?: string;
}

/** Save an existing item's content as a reusable template. */
export async function saveAsTemplate(
  itemId: string,
  name: string
): Promise<ActionResult> {
  const { user, orgId, supabase } = await getSessionContext();
  
  if (!user || !orgId) {
    return { error: "Unauthorized" };
  }
  
  if (!name.trim()) {
    return { error: "Template needs a name" };
  }

  const { data: item, error: itemError } = await supabase
    .from("marketing_items")
    .select("type, title, body, hashtags, destination, post_targets(platform)")
    .eq("id", itemId)
    .eq("org_id", orgId)
    .single();
  
  if (itemError || !item) {
    return { error: "Item not found" };
  }

  const platforms = [
    ...new Set((item.post_targets ?? []).map((t: { platform: Platform }) => t.platform)),
  ];

  const { data: template, error: insertError } = await supabase
    .from("content_templates")
    .insert({
      org_id: orgId,
      name: name.trim(),
      type: item.type,
      title: item.title,
      body: item.body,
      hashtags: item.hashtags,
      destination: item.destination,
      default_platforms: platforms,
      created_by: user.id,
    })
    .select("id")
    .single();
  
  if (insertError || !template) {
    return { error: friendlyActionError(insertError, "Save failed") };
  }

  revalidatePath("/items/new");
  return { id: template.id };
}

/** Delete a content template by ID. */
export async function deleteTemplate(id: string): Promise<void> {
  const { user, orgId, supabase } = await getSessionContext();
  
  if (!user || !orgId) {
    throw new Error("Unauthorized");
  }

  const { error } = await supabase
    .from("content_templates")
    .delete()
    .eq("id", id)
    .eq("org_id", orgId);
  
  if (error) {
    throw new Error(friendlyActionError(error) || "Failed to delete template");
  }

  revalidatePath("/items/new");
}