import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/supabase/server";
import { isPlatform } from "@/lib/social/registry";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
) {
  const { platform } = await params;
  if (!isPlatform(platform)) {
    return NextResponse.json({ error: "Unknown platform" }, { status: 400 });
  }
  const { user, orgId, supabase } = await getSessionContext();
  if (!user || !orgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    accountId?: string;
  };
  if (!body.accountId) {
    return NextResponse.json({ error: "accountId required" }, { status: 400 });
  }

  // RLS enforces org membership + role.
  const { error } = await supabase
    .from("social_accounts")
    .delete()
    .eq("id", body.accountId)
    .eq("org_id", orgId)
    .eq("platform", platform);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}
