import "server-only";
import { AdsApiError, type AdsProviderAdapter } from "../types";

const GRAPH = "https://graph.facebook.com/v21.0";

const OBJECTIVE_MAP: Record<string, string> = {
  awareness: "OUTCOME_AWARENESS",
  traffic: "OUTCOME_TRAFFIC",
  engagement: "OUTCOME_ENGAGEMENT",
  leads: "OUTCOME_LEADS",
  conversions: "OUTCOME_SALES",
  bookings: "OUTCOME_SALES",
};

interface MetaErrorBody {
  error?: { message?: string; code?: number };
}

/**
 * Meta Marketing API adapter. Requires the connected account's token to
 * carry the `ads_management` permission — a separate, harder-to-get
 * approval tier than the basic posting access this app otherwise uses
 * (Meta requires business verification and a distinct app review for
 * ads). This is real, working code against Meta's actual API; until that
 * permission is granted every call here fails with a clearly classified
 * error instead of a cryptic one, rather than silently pretending to work.
 */
export const metaAds: AdsProviderAdapter = {
  async createLiveCampaign(input, accessToken) {
    const res = await fetch(`${GRAPH}/act_${input.adAccountId}/campaigns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        objective: OBJECTIVE_MAP[input.objective] ?? "OUTCOME_AWARENESS",
        status: "PAUSED", // never auto-launch spending money — created paused, user activates explicitly
        special_ad_categories: [],
        access_token: accessToken,
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as MetaErrorBody;
      const message = body.error?.message ?? `HTTP ${res.status}`;
      if (res.status === 403 || /ads_management|permission/i.test(message)) {
        throw new AdsApiError(
          "meta",
          "permission_denied",
          "Meta rejected this request — the connected account's token doesn't have ads_management permission. This requires Meta Business verification and a separate app review from your regular posting access.",
          false
        );
      }
      throw new AdsApiError("meta", `http_${res.status}`, message, res.status === 429);
    }
    const data = (await res.json()) as { id: string };
    return { externalCampaignId: data.id };
  },

  async fetchPerformance(externalCampaignId, accessToken) {
    const res = await fetch(
      `${GRAPH}/${externalCampaignId}/insights?fields=spend,impressions,clicks&access_token=${encodeURIComponent(
        accessToken
      )}`
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as MetaErrorBody;
      throw new AdsApiError(
        "meta",
        `http_${res.status}`,
        body.error?.message ?? "Could not fetch ad performance",
        res.status >= 500 || res.status === 429
      );
    }
    const data = (await res.json()) as {
      data?: { spend?: string; impressions?: string; clicks?: string }[];
    };
    const row = data.data?.[0] ?? {};
    return {
      spend: row.spend != null ? Number(row.spend) : null,
      impressions: row.impressions != null ? Number(row.impressions) : null,
      clicks: row.clicks != null ? Number(row.clicks) : null,
      conversions: null, // requires a configured conversion action; not available generically
    };
  },

  async setStatus(externalCampaignId, status, accessToken) {
    const res = await fetch(`${GRAPH}/${externalCampaignId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: status.toUpperCase(),
        access_token: accessToken,
      }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as MetaErrorBody;
      throw new AdsApiError(
        "meta",
        `http_${res.status}`,
        body.error?.message ?? "Could not update ad status",
        res.status >= 500 || res.status === 429
      );
    }
  },
};