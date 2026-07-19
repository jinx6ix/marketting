"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/supabase/server";
import {
  campaignFormSchema,
  type CampaignFormValues,
} from "@/features/marketing-items/schemas";

export interface ActionResult {
  error?: string;
  id?: string;
}

export async function createCampaign(
  values: CampaignFormValues
): Promise<ActionResult> {
  const { user, orgId, supabase } = await getSessionContext();
  if (!user || !orgId) return { error: "Unauthorized" };

  const parsed = campaignFormSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;

  const { data, error } = await supabase
    .from("campaigns")
    .insert({
      org_id: orgId,
      name: v.name,
      description: v.description || null,
      objective: v.objective ?? null,
      destination: v.destination || null,
      tour_package: v.tour_package || null,
      start_date: v.start_date || null,
      end_date: v.end_date || null,
      budget: v.budget ?? null,
      status: v.status,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Insert failed" };

  revalidatePath("/campaigns");
  return { id: data.id };
}

export async function updateCampaign(
  id: string,
  values: CampaignFormValues
): Promise<ActionResult> {
  const { user, orgId, supabase } = await getSessionContext();
  if (!user || !orgId) return { error: "Unauthorized" };

  const parsed = campaignFormSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;

  const { error } = await supabase
    .from("campaigns")
    .update({
      name: v.name,
      description: v.description || null,
      objective: v.objective ?? null,
      destination: v.destination || null,
      tour_package: v.tour_package || null,
      start_date: v.start_date || null,
      end_date: v.end_date || null,
      budget: v.budget ?? null,
      status: v.status,
    })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${id}`);
  return { id };
}

export async function deleteCampaign(id: string): Promise<ActionResult> {
  const { user, orgId, supabase } = await getSessionContext();
  if (!user || !orgId) return { error: "Unauthorized" };

  const { error } = await supabase.from("campaigns").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/campaigns");
  return { id };
}
