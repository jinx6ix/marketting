import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { appUrl } from "@/lib/social/oauth";

/**
 * Exchanges the one-time `code` from Supabase auth emails (password recovery,
 * invites, email confirmation) for a session, then forwards to `next`.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = request.nextUrl.searchParams.get("next") ?? "/dashboard";
  // Only allow same-origin relative redirects.
  const dest = next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(appUrl(dest));
    }
  }

  return NextResponse.redirect(
    appUrl("/login?error=Link%20expired%20or%20invalid.%20Request%20a%20new%20one.")
  );
}
