import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAdapter } from "@/lib/social/registry";
import { getAccountTokens } from "@/lib/social/accounts";
import { tryAcquire, markRateLimited } from "./rate-limit";
import { SocialApiError, type TokenSet } from "@/lib/social/types";
import { aiJson } from "@/lib/ai/client";
import { tagCompetitorPostsPrompt } from "@/lib/ai/prompts/content";
import { runJob } from "./runner";
import type { Platform, Json } from "@/types/database";

/**
 * Competitor job (every 6h): poll public profiles + recent posts per
 * competitor account. Uses IG Business Discovery (needs any connected IG
 * business token), YouTube API key, X public lookups. Platforms without
 * APIs (TikTok, LinkedIn) rely on manual snapshots from the UI.
 */
export async function pollCompetitors(): Promise<ReturnType<typeof runJob>> {
  return runJob("competitors", async () => {
    const admin = createAdminClient();
    let processed = 0;

    const { data: compAccounts } = await admin
      .from("competitor_accounts")
      .select("*, competitors!inner(active)")
      .order("last_polled_at", { ascending: true, nullsFirst: true })
      .limit(30);

    for (const ca of compAccounts ?? []) {
      if (!(ca.competitors as unknown as { active: boolean }).active) continue;
      const platform = ca.platform as Platform;
      const adapter = getAdapter(platform);
      if (!adapter.fetchPublicProfile || !adapter.capabilities.competitorData)
        continue;
      if (!tryAcquire(platform)) continue;

      try {
        const tokens = await tokensForCompetitorLookup(platform, ca.org_id);

        const profile = await adapter.fetchPublicProfile(ca.handle, tokens);
        const posts = adapter.fetchPublicPosts
          ? await adapter.fetchPublicPosts(ca.handle, 25, tokens)
          : [];

        // posting frequency: posts/week over the fetched window
        let postingFrequency: number | null = null;
        const dated = posts.filter((p) => p.postedAt);
        if (dated.length >= 2) {
          const newest = Math.max(...dated.map((p) => p.postedAt!.getTime()));
          const oldest = Math.min(...dated.map((p) => p.postedAt!.getTime()));
          const weeks = Math.max((newest - oldest) / (7 * 86400_000), 0.25);
          postingFrequency = Number((dated.length / weeks).toFixed(2));
        }

        const engagements = posts.map(
          (p) => (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0)
        );
        const avgEngagement =
          engagements.length > 0
            ? engagements.reduce((a, b) => a + b, 0) / engagements.length
            : null;

        await admin.from("competitor_snapshots").insert({
          org_id: ca.org_id,
          competitor_account_id: ca.id,
          followers: profile.followers ?? null,
          following: profile.following ?? null,
          posts_count: profile.postsCount ?? null,
          avg_engagement: avgEngagement,
          posting_frequency: postingFrequency,
          source: "api",
          raw: (profile.raw ?? null) as Json,
        });

        for (const p of posts) {
          await admin.from("competitor_posts").upsert(
            {
              org_id: ca.org_id,
              competitor_account_id: ca.id,
              external_id: p.externalId,
              posted_at: p.postedAt?.toISOString() ?? null,
              content: p.content ?? null,
              media_type: p.mediaType ?? null,
              likes: p.likes ?? null,
              comments: p.comments ?? null,
              shares: p.shares ?? null,
              views: p.views ?? null,
              hashtags: p.hashtags ?? [],
              raw: (p.raw ?? null) as Json,
            },
            {
              onConflict: "competitor_account_id,external_id",
              ignoreDuplicates: false,
            }
          );
        }

        await admin
          .from("competitor_accounts")
          .update({
            external_id: profile.externalId,
            last_polled_at: new Date().toISOString(),
          })
          .eq("id", ca.id);
        processed++;
      } catch (e) {
        if (e instanceof SocialApiError && e.retryAfterMs) {
          markRateLimited(platform, e.retryAfterMs);
        }
      }
    }

    // AI destination tagging for untagged competitor posts
    await tagDestinations();

    return processed;
  });
}

/**
 * Find a usable token for public competitor lookups:
 * - instagram: any connected IG business account (Business Discovery) —
 *   the caller's IG user id is smuggled on the token object.
 * - x / facebook: any connected account token of that platform.
 * - youtube: none needed (API key).
 */
async function tokensForCompetitorLookup(
  platform: Platform,
  orgId: string
): Promise<TokenSet | undefined> {
  if (platform === "youtube") return undefined;

  const admin = createAdminClient();
  const { data: account } = await admin
    .from("social_accounts")
    .select("id, external_id")
    .eq("org_id", orgId)
    .eq("platform", platform)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (!account) return undefined;

  const { tokens } = await getAccountTokens(account.id);
  if (platform === "instagram") {
    (tokens as TokenSet & { igUserId?: string }).igUserId = account.external_id;
  }
  return tokens;
}

async function tagDestinations(): Promise<void> {
  const admin = createAdminClient();
  const { data: untagged } = await admin
    .from("competitor_posts")
    .select("id, content")
    .eq("destinations", [] as string[])
    .not("content", "is", null)
    .limit(20);

  if (!untagged || untagged.length === 0) return;

  try {
    const result = await aiJson(
      z.object({
        results: z.array(
          z.object({
            id: z.string(),
            destinations: z.array(z.string()),
            hashtags: z.array(z.string()),
          })
        ),
      }),
      {
        system:
          "You extract travel destinations and hashtags from social posts. Respond only with valid JSON.",
        user: tagCompetitorPostsPrompt(
          untagged.map((p) => ({ id: p.id, content: p.content ?? "" }))
        ),
        maxTokens: 2000,
      }
    );

    const validIds = new Set(untagged.map((p) => p.id));
    for (const r of result.data.results) {
      if (!validIds.has(r.id)) continue;
      await admin
        .from("competitor_posts")
        .update({
          destinations: r.destinations.length > 0 ? r.destinations : ["_none"],
          hashtags: r.hashtags.map((h) => h.replace(/^#/, "").toLowerCase()),
        })
        .eq("id", r.id);
    }
  } catch {
    // best-effort tagging; retried next run
  }
}
