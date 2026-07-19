import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAdapter, isPlatform } from "@/lib/social/registry";
import { upsertSocialAccount } from "@/lib/social/accounts";
import { appUrl } from "@/lib/social/oauth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
) {
  const { platform } = await params;
  if (!isPlatform(platform)) {
    return NextResponse.json({ error: "Unknown platform" }, { status: 400 });
  }

  const sp = request.nextUrl.searchParams;
  const code = sp.get("code");
  const state = sp.get("state");
  const oauthError = sp.get("error") ?? sp.get("error_description");

  const fail = (reason: string) =>
    NextResponse.redirect(
      appUrl(`/settings/accounts?error=${encodeURIComponent(reason)}`)
    );

  if (oauthError) return fail(oauthError);
  if (!code || !state) return fail("missing_code_or_state");

  const admin = createAdminClient();

  // Validate + consume state
  const { data: stateRow } = await admin
    .from("oauth_states")
    .select("*")
    .eq("state", state)
    .single();
  if (!stateRow || stateRow.platform !== platform) return fail("invalid_state");
  await admin.from("oauth_states").delete().eq("state", state);
  if (new Date(stateRow.expires_at) < new Date()) return fail("state_expired");

  try {
    const adapter = getAdapter(platform);
    const tokens = await adapter.exchangeCode(
      code,
      stateRow.code_verifier ?? undefined
    );
    const profiles = await adapter.fetchProfile(tokens);

    // Connect all discovered profiles (e.g. all FB pages / IG accounts).
    for (const profile of profiles) {
      await upsertSocialAccount({
        orgId: stateRow.org_id,
        userId: stateRow.user_id,
        platform,
        profile,
        userTokens: tokens,
      });
    }

    const dest = stateRow.redirect_to ?? "/settings/accounts";
    return NextResponse.redirect(
      appUrl(`${dest}${dest.includes("?") ? "&" : "?"}connected=${platform}`)
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : "connection_failed";
    return fail(message.slice(0, 200));
  }
}
