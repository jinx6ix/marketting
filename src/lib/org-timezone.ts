import "server-only";
import type { getSessionContext } from "@/lib/supabase/server";

/**
 * Fetches the org's configured display timezone (organizations.timezone),
 * defaulting to UTC if unset. Use this — never the server process's
 * ambient timezone — for any Server Component formatting a date for
 * display: Vercel always runs functions in UTC regardless of region,
 * while local dev inherits the OS's timezone, so unqualified formatting
 * looks right locally and silently shifts once deployed.
 */
export async function getOrgTimezone(
  supabase: Awaited<ReturnType<typeof getSessionContext>>["supabase"],
  orgId: string
): Promise<string> {
  const { data } = await supabase
    .from("organizations")
    .select("timezone")
    .eq("id", orgId)
    .single();
  return data?.timezone || "UTC";
}