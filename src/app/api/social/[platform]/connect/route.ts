import { NextRequest, NextResponse } from "next/server";
import { getSessionContext } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAdapter, isPlatform } from "@/lib/social/registry";
import { generateState, generatePkcePair, appUrl } from "@/lib/social/oauth";

const PKCE_PLATFORMS = new Set(["x", "tiktok", "pinterest"]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
) {
  const { platform } = await params;
  if (!isPlatform(platform)) {
    return NextResponse.json({ error: "Unknown platform" }, { status: 400 });
  }

  const { user, orgId } = await getSessionContext();
  if (!user || !orgId) {
    return NextResponse.redirect(appUrl("/login"));
  }

  const state = generateState();
  let codeChallenge: string | undefined;
  let codeVerifier: string | undefined;
  if (PKCE_PLATFORMS.has(platform)) {
    const pair = generatePkcePair();
    codeChallenge = pair.codeChallenge;
    codeVerifier = pair.codeVerifier;
  }

  const admin = createAdminClient();
  const { error } = await admin.from("oauth_states").insert({
    state,
    org_id: orgId,
    user_id: user.id,
    platform,
    code_verifier: codeVerifier ?? null,
    redirect_to: request.nextUrl.searchParams.get("next") ?? "/settings/accounts",
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  if (error) {
    return NextResponse.json({ error: "Failed to start OAuth" }, { status: 500 });
  }

  const adapter = getAdapter(platform);
  return NextResponse.redirect(adapter.getAuthUrl(state, codeChallenge));
}
