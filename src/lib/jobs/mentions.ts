import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAdapter } from "@/lib/social/registry";
import { getAccountTokens } from "@/lib/social/accounts";
import { tryAcquire, markRateLimited } from "./rate-limit";
import { SocialApiError } from "@/lib/social/types";
import { aiJson } from "@/lib/ai/client";
import { sentimentPrompt } from "@/lib/ai/prompts/content";
import { runJob } from "./runner";
import type { Platform, Json } from "@/types/database";

/**
 * Mentions job (every 10 min): fetch mentions/comments per connected
 * account since last fetch, dedupe via unique constraint, then batch
 * AI sentiment classification for new rows.
 */
export async function collectMentions(): Promise<ReturnType<typeof runJob>> {
  return runJob("mentions", async () => {
    const admin = createAdminClient();
    let processed = 0;

    const { data: accounts } = await admin
      .from("social_accounts")
      .select("id, org_id, platform, metadata")
      .eq("status", "active")
      .limit(50);

    for (const acc of accounts ?? []) {
      const platform = acc.platform as Platform;
      const adapter = getAdapter(platform);
      if (!adapter.fetchMentions || !adapter.capabilities.mentions) continue;
      if (!tryAcquire(platform)) continue;

      const meta = acc.metadata as { last_mentions_fetch?: string };
      const since = meta?.last_mentions_fetch
        ? new Date(meta.last_mentions_fetch)
        : new Date(Date.now() - 24 * 3600_000);

      try {
        const { account, tokens } = await getAccountTokens(acc.id);
        const fetched = await adapter.fetchMentions(tokens, account, since);

        for (const m of fetched) {
          const { error } = await admin.from("mentions").upsert(
            {
              org_id: acc.org_id,
              social_account_id: acc.id,
              platform,
              kind: m.kind,
              external_id: m.externalId,
              author_handle: m.authorHandle ?? null,
              author_name: m.authorName ?? null,
              author_avatar_url: m.authorAvatarUrl ?? null,
              content: m.content ?? null,
              external_url: m.externalUrl ?? null,
              occurred_at: m.occurredAt?.toISOString() ?? null,
              raw: (m.raw ?? null) as Json,
            },
            {
              onConflict: "org_id,platform,external_id,kind",
              ignoreDuplicates: true,
            }
          );
          if (!error) processed++;
        }

        await admin
          .from("social_accounts")
          .update({
            metadata: {
              ...(acc.metadata as Record<string, unknown>),
              last_mentions_fetch: new Date().toISOString(),
            } as Json,
          })
          .eq("id", acc.id);
      } catch (e) {
        if (e instanceof SocialApiError && e.retryAfterMs) {
          markRateLimited(platform, e.retryAfterMs);
        }
      }
    }

    // Sentiment classification for unclassified mentions (batch of 20).
    await classifySentiments();

    return processed;
  });
}

async function classifySentiments(): Promise<void> {
  const admin = createAdminClient();
  const { data: unclassified } = await admin
    .from("mentions")
    .select("id, content")
    .is("sentiment", null)
    .not("content", "is", null)
    .limit(20);

  if (!unclassified || unclassified.length === 0) return;

  try {
    const result = await aiJson(
      z.object({
        results: z.array(
          z.object({
            id: z.string(),
            sentiment: z.enum(["positive", "neutral", "negative"]),
          })
        ),
      }),
      {
        system:
          "You are a sentiment classifier for a travel company's social mentions. Respond only with valid JSON.",
        user: sentimentPrompt(
          unclassified.map((m) => ({ id: m.id, content: m.content ?? "" }))
        ),
        maxTokens: 1500,
      }
    );

    const validIds = new Set(unclassified.map((m) => m.id));
    for (const r of result.data.results) {
      if (!validIds.has(r.id)) continue;
      await admin
        .from("mentions")
        .update({ sentiment: r.sentiment })
        .eq("id", r.id);
    }
  } catch {
    // Sentiment is best-effort; mentions remain unclassified and get retried.
  }
}
