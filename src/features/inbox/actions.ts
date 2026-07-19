"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/supabase/server";

export interface ActionResult {
  error?: string;
  id?: string;
}

export async function markMentionRead(
  id: string,
  isRead = true
): Promise<ActionResult> {
  const { user, orgId, supabase } = await getSessionContext();
  if (!user || !orgId) return { error: "Unauthorized" };

  const { error } = await supabase
    .from("mentions")
    .update({ is_read: isRead })
    .eq("id", id)
    .eq("org_id", orgId);
  if (error) return { error: error.message };

  revalidatePath("/inbox");
  revalidatePath("/dashboard");
  return { id };
}

export async function markAllMentionsRead(): Promise<ActionResult> {
  const { user, orgId, supabase } = await getSessionContext();
  if (!user || !orgId) return { error: "Unauthorized" };

  const { error } = await supabase
    .from("mentions")
    .update({ is_read: true })
    .eq("org_id", orgId)
    .eq("is_read", false);
  if (error) return { error: error.message };

  revalidatePath("/inbox");
  revalidatePath("/dashboard");
  return {};
}

export async function markMentionReplied(
  id: string,
  replied = true
): Promise<ActionResult> {
  const { user, orgId, supabase } = await getSessionContext();
  if (!user || !orgId) return { error: "Unauthorized" };

  const { error } = await supabase
    .from("mentions")
    .update({ replied, is_read: true })
    .eq("id", id)
    .eq("org_id", orgId);
  if (error) return { error: error.message };

  revalidatePath("/inbox");
  return { id };
}

const keywordSchema = z.object({
  keyword: z.string().trim().min(1, "Keyword is required").max(120),
  kind: z.enum(["hashtag", "keyword", "destination", "brand"]),
});

export async function addKeyword(values: {
  keyword: string;
  kind: string;
}): Promise<ActionResult> {
  const { user, orgId, supabase } = await getSessionContext();
  if (!user || !orgId) return { error: "Unauthorized" };

  const parsed = keywordSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { data, error } = await supabase
    .from("tracked_keywords")
    .insert({
      org_id: orgId,
      keyword: parsed.data.keyword.replace(/^#/, ""),
      kind: parsed.data.kind,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Insert failed" };

  revalidatePath("/inbox");
  return { id: data.id };
}

export async function toggleKeyword(
  id: string,
  active: boolean
): Promise<ActionResult> {
  const { user, orgId, supabase } = await getSessionContext();
  if (!user || !orgId) return { error: "Unauthorized" };

  const { error } = await supabase
    .from("tracked_keywords")
    .update({ active })
    .eq("id", id)
    .eq("org_id", orgId);
  if (error) return { error: error.message };

  revalidatePath("/inbox");
  return { id };
}

export async function deleteKeyword(id: string): Promise<ActionResult> {
  const { user, orgId, supabase } = await getSessionContext();
  if (!user || !orgId) return { error: "Unauthorized" };

  const { error } = await supabase
    .from("tracked_keywords")
    .delete()
    .eq("id", id)
    .eq("org_id", orgId);
  if (error) return { error: error.message };

  revalidatePath("/inbox");
  return { id };
}
