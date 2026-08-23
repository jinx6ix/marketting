import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAdapter } from "@/lib/social/registry";
import { getAccountTokens, saveAccountTokens } from "@/lib/social/accounts";
import { sendAlert } from "@/lib/alerts";
import { runJob } from "./runner";
import type { Platform } from "@/types/database";

/**
 * Token refresh (daily): refresh anything expiring within 7 days.
 * Accounts that cannot refresh (e.g. LinkedIn without partner approval)
 * are marked 'expired' so the UI shows a reconnect banner.
 */
export async function refreshExpiringTokens(): Promise<ReturnType<typeof runJob>> {
  return runJob("token-refresh", async () => {
    const admin = createAdminClient();
    const cutoff = new Date(Date.now() + 7 * 86400_000).toISOString();

    const { data: expiring } = await admin
      .from("social_accounts")
      .select("id, platform, handle, display_name")
      .eq("status", "active")
      .not("token_expires_at", "is", null)
      .lte("token_expires_at", cutoff)
      .limit(50);

    let processed = 0;
    for (const acc of expiring ?? []) {
      try {
        const { tokens } = await getAccountTokens(acc.id);
        const adapter = getAdapter(acc.platform as Platform);
        const refreshed = await adapter.refreshToken(tokens);
        await saveAccountTokens(acc.id, refreshed);
        processed++;
      } catch {
        await admin
          .from("social_accounts")
          .update({ status: "expired" })
          .eq("id", acc.id);
        // This is the more urgent of the two "expired" paths: the token
        // was going to run out within 7 days regardless, and the proactive
        // refresh — the thing meant to prevent that — just failed. The
        // account will stop working for real publishing/metrics soon if
        // nobody reconnects it.
        await sendAlert(
          `⚠️ ${acc.platform} account "${acc.display_name ?? acc.handle ?? acc.id}" needs reconnecting — its access token is expiring within 7 days and the automatic refresh failed.`
        );
      }
    }
    return processed;
  });
}