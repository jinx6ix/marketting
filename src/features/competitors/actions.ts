"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSessionContext } from "@/lib/supabase/server";

export interface ActionResult {
  error?: string;
  id?: string;
}

const PLATFORMS = [
  "facebook",
  "instagram",
  "x",
  "tiktok",
  "youtube",
  "linkedin",
  "pinterest",
] as const;

const accountSchema = z.object({
  platform: z.enum(PLATFORMS),
  handle: z.string().trim().min(1).max(120),
  profile_url: z.string().url().optional().or(z.literal("")),
});

const competitorSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  notes: z.string().max(2000).optional(),
  niche: z.array(z.string().max(80)).max(20).default([]),
  destinations: z.array(z.string().max(120)).max(50).default([]),
  accounts: z.array(accountSchema).default([]),
});

export type CompetitorFormValues = z.input<typeof competitorSchema>;

export async function createCompetitor(
  values: CompetitorFormValues
): Promise<ActionResult> {
  const { user, orgId, supabase } = await getSessionContext();
  if (!user || !orgId) return { error: "Unauthorized" };

  const parsed = competitorSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;

  const { data: competitor, error } = await supabase
    .from("competitors")
    .insert({
      org_id: orgId,
      name: v.name,
      notes: v.notes || null,
      niche: v.niche,
      destinations: v.destinations,
    })
    .select("id")
    .single();
  if (error || !competitor) return { error: error?.message ?? "Insert failed" };

  if (v.accounts.length > 0) {
    const { error: accountsError } = await supabase
      .from("competitor_accounts")
      .insert(
        v.accounts.map((a) => ({
          org_id: orgId,
          competitor_id: competitor.id,
          platform: a.platform,
          handle: a.handle.replace(/^@/, ""),
          profile_url: a.profile_url || null,
        }))
      );
    if (accountsError) return { error: accountsError.message };
  }

  revalidatePath("/competitors");
  return { id: competitor.id };
}

export async function addCompetitorAccount(
  competitorId: string,
  values: { platform: string; handle: string; profile_url?: string }
): Promise<ActionResult> {
  const { user, orgId, supabase } = await getSessionContext();
  if (!user || !orgId) return { error: "Unauthorized" };

  const parsed = accountSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { data, error } = await supabase
    .from("competitor_accounts")
    .insert({
      org_id: orgId,
      competitor_id: competitorId,
      platform: parsed.data.platform,
      handle: parsed.data.handle.replace(/^@/, ""),
      profile_url: parsed.data.profile_url || null,
    })
    .select("id")
    .single();
  if (error || !data) return { error: error?.message ?? "Insert failed" };

  revalidatePath(`/competitors/${competitorId}`);
  return { id: data.id };
}

export async function deleteCompetitor(id: string): Promise<ActionResult> {
  const { user, orgId, supabase } = await getSessionContext();
  if (!user || !orgId) return { error: "Unauthorized" };

  const { error } = await supabase
    .from("competitors")
    .delete()
    .eq("id", id)
    .eq("org_id", orgId);
  if (error) return { error: error.message };

  revalidatePath("/competitors");
  redirect("/competitors");
}

const manualSnapshotSchema = z.object({
  competitor_account_id: z.string().uuid(),
  followers: z.coerce.number().int().min(0).optional(),
  posts_count: z.coerce.number().int().min(0).optional(),
  avg_engagement: z.coerce.number().min(0).optional(),
  posting_frequency: z.coerce.number().min(0).optional(),
});

export async function addManualSnapshot(values: {
  competitor_account_id: string;
  followers?: number | string;
  posts_count?: number | string;
  avg_engagement?: number | string;
  posting_frequency?: number | string;
}): Promise<ActionResult> {
  const { user, orgId, supabase } = await getSessionContext();
  if (!user || !orgId) return { error: "Unauthorized" };

  const parsed = manualSnapshotSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const v = parsed.data;

  const { error } = await supabase.from("competitor_snapshots").insert({
    org_id: orgId,
    competitor_account_id: v.competitor_account_id,
    followers: v.followers ?? null,
    posts_count: v.posts_count ?? null,
    avg_engagement: v.avg_engagement ?? null,
    posting_frequency: v.posting_frequency ?? null,
    source: "manual",
  });
  if (error) return { error: error.message };

  revalidatePath("/competitors");
  return {};
}
