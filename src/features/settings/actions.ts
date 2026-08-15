"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSessionContext } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { OrgRole } from "@/types/database";

export interface ActionResult {
  error?: string;
  message?: string;
}

const ASSIGNABLE_ROLES = ["admin", "editor", "viewer"] as const;

async function requireManagerRole(): Promise<
  | { error: string }
  | { orgId: string; userId: string; role: OrgRole }
> {
  const { user, orgId, supabase } = await getSessionContext();
  if (!user || !orgId) return { error: "Unauthorized" };
  const { data: membership } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .single();
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return { error: "Only owners and admins can manage the team" };
  }
  return { orgId, userId: user.id, role: membership.role };
}

/** Find an existing auth user by email (admin API has no direct lookup). */
async function findUserIdByEmail(email: string): Promise<string | null> {
  const admin = createAdminClient();
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error || !data.users.length) return null;
    const match = data.users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase()
    );
    if (match) return match.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

export async function inviteMember(values: {
  email: string;
  role: string;
}): Promise<ActionResult> {
  const ctx = await requireManagerRole();
  if ("error" in ctx) return { error: ctx.error };

  const parsed = z
    .object({ email: z.string().email(), role: z.enum(ASSIGNABLE_ROLES) })
    .safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { email, role } = parsed.data;

  const admin = createAdminClient();
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  // Existing user → just add membership; new user → send a Supabase invite.
  let invitedUserId = await findUserIdByEmail(email);
  let message = "Member added.";
  if (!invitedUserId) {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${base.replace(/\/$/, "")}/auth/callback?next=/reset-password`,
    });
    if (error || !data.user) {
      return { error: error?.message ?? "Invite failed" };
    }
    invitedUserId = data.user.id;
    message = "Invite email sent.";
  }

  const { error: memberError } = await admin.from("org_members").upsert({
    org_id: ctx.orgId,
    user_id: invitedUserId,
    role,
  });
  if (memberError) return { error: memberError.message };

  // Default them into this org if they have none yet.
  await admin
    .from("profiles")
    .upsert({ id: invitedUserId }, { ignoreDuplicates: true });
  const { data: profile } = await admin
    .from("profiles")
    .select("default_org_id")
    .eq("id", invitedUserId)
    .single();
  if (profile && !profile.default_org_id) {
    await admin
      .from("profiles")
      .update({ default_org_id: ctx.orgId })
      .eq("id", invitedUserId);
  }

  revalidatePath("/settings/team");
  return { message };
}

export async function updateMemberRole(
  memberUserId: string,
  role: string
): Promise<ActionResult> {
  const ctx = await requireManagerRole();
  if ("error" in ctx) return { error: ctx.error };

  const parsed = z.enum(["owner", ...ASSIGNABLE_ROLES]).safeParse(role);
  if (!parsed.success) return { error: "Invalid role" };
  // Only owners can grant/revoke ownership.
  if (parsed.data === "owner" && ctx.role !== "owner") {
    return { error: "Only an owner can promote to owner" };
  }

  const { supabase } = await getSessionContext();
  const { data: current } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", ctx.orgId)
    .eq("user_id", memberUserId)
    .single();
  if (!current) return { error: "Member not found" };

  if (current.role === "owner" && parsed.data !== "owner") {
    const { count } = await supabase
      .from("org_members")
      .select("user_id", { count: "exact", head: true })
      .eq("org_id", ctx.orgId)
      .eq("role", "owner");
    if ((count ?? 0) <= 1) {
      return { error: "Cannot demote the last owner" };
    }
  }

  const { error } = await supabase
    .from("org_members")
    .update({ role: parsed.data })
    .eq("org_id", ctx.orgId)
    .eq("user_id", memberUserId);
  if (error) return { error: error.message };

  revalidatePath("/settings/team");
  return {};
}

export async function removeMember(memberUserId: string): Promise<ActionResult> {
  const ctx = await requireManagerRole();
  if ("error" in ctx) return { error: ctx.error };

  const { supabase } = await getSessionContext();
  const { data: current } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", ctx.orgId)
    .eq("user_id", memberUserId)
    .single();
  if (!current) return { error: "Member not found" };
  if (current.role === "owner") {
    const { count } = await supabase
      .from("org_members")
      .select("user_id", { count: "exact", head: true })
      .eq("org_id", ctx.orgId)
      .eq("role", "owner");
    if ((count ?? 0) <= 1) return { error: "Cannot remove the last owner" };
  }

  const { error } = await supabase
    .from("org_members")
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("user_id", memberUserId);
  if (error) return { error: error.message };

  revalidatePath("/settings/team");
  return {};
}

const orgSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  timezone: z.string().trim().min(1).max(64),
  industry_niche: z.array(z.string().trim().min(1).max(80)).max(20),
  default_hashtags: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(80)
        .transform((h) => (h.startsWith("#") ? h : `#${h}`))
    )
    .max(30),
});

export async function updateOrganization(values: {
  name: string;
  timezone: string;
  industry_niche: string[];
  default_hashtags: string[];
}): Promise<ActionResult> {
  const ctx = await requireManagerRole();
  if ("error" in ctx) return { error: ctx.error };

  const parsed = orgSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { supabase } = await getSessionContext();
  const { error } = await supabase
    .from("organizations")
    .update(parsed.data)
    .eq("id", ctx.orgId);
  if (error) return { error: error.message };

  revalidatePath("/settings/organization");
  revalidatePath("/", "layout");
  return { message: "Organization updated." };
}