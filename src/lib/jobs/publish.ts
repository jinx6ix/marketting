import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAdapter } from "@/lib/social/registry";
import { getAccountTokens } from "@/lib/social/accounts";
import { SocialApiError, type PublishPayload } from "@/lib/social/types";
import { nextRetryAt, tryAcquire, markRateLimited } from "./rate-limit";
import { runJob } from "./runner";
import { rollupItemStatus } from "./item-rollup";
import type { Platform } from "@/types/database";

interface MediaEntry {
  storage_path?: string;
  url?: string;
  type?: "image" | "video";
}

/**
 * Publish job: claims due post_targets, publishes via adapters,
 * handles retries, and rolls up marketing_items status.
 */
export async function publishDue(): Promise<ReturnType<typeof runJob>> {
  return runJob("publish", async () => {
    const admin = createAdminClient();
    const nowIso = new Date().toISOString();

    // Due = parent item scheduled in the past AND target pending, or a retry due.
    const { data: targets, error } = await admin
      .from("post_targets")
      .select("*, marketing_items!inner(id, status, scheduled_at, body, media, hashtags)")
      .in("status", ["pending", "queued"])
      .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
      .limit(20);
    if (error) throw new Error(error.message);

    const due = (targets ?? []).filter((t) => {
      const item = t.marketing_items as unknown as {
        status: string;
        scheduled_at: string | null;
      };
      return (
        (item.status === "scheduled" || item.status === "publishing") &&
        item.scheduled_at &&
        new Date(item.scheduled_at) <= new Date()
      );
    });

    let processed = 0;
    const touchedItems = new Set<string>();

    for (const target of due) {
      const platform = target.platform as Platform;
      if (!tryAcquire(platform)) continue;

      // claim: pending/queued -> publishing (optimistic lock via status filter)
      const { data: claimed } = await admin
        .from("post_targets")
        .update({ status: "publishing" })
        .eq("id", target.id)
        .in("status", ["pending", "queued"])
        .select("id")
        .single();
      if (!claimed) continue; // another worker claimed it

      touchedItems.add(target.item_id);
      await admin
        .from("marketing_items")
        .update({ status: "publishing" })
        .eq("id", target.item_id)
        .eq("status", "scheduled");

      try {
        const { account, tokens } = await getAccountTokens(
          target.social_account_id
        );
        const adapter = getAdapter(platform);

        const item = target.marketing_items as unknown as {
          body: string;
          media: MediaEntry[];
          hashtags: string[];
        };

        const mediaUrls = await resolveMediaUrls(
          (target.variant_media as MediaEntry[] | null) ?? item.media ?? []
        );
        const mediaType = pickMediaType(
          (target.variant_media as MediaEntry[] | null) ?? item.media ?? []
        );

        const text =
          target.variant_body ??
          [item.body, item.hashtags?.map((h) => `#${h}`).join(" ")]
            .filter(Boolean)
            .join("\n\n");

        const payload: PublishPayload = { text, mediaUrls, mediaType };
        const result = await adapter.publish(tokens, account, payload);

        await admin
          .from("post_targets")
          .update({
            status: "published",
            external_post_id: result.externalPostId,
            external_url: result.externalUrl ?? null,
            published_at: new Date().toISOString(),
            error: null,
          })
          .eq("id", target.id);
        processed++;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const retryable = e instanceof SocialApiError ? e.retryable : true;
        if (e instanceof SocialApiError && e.retryAfterMs) {
          markRateLimited(platform, e.retryAfterMs);
        }

        const retry = retryable ? nextRetryAt(target.retry_count) : null;
        await admin
          .from("post_targets")
          .update({
            status: retry ? "pending" : "failed",
            error: message.slice(0, 1000),
            retry_count: target.retry_count + 1,
            next_retry_at: retry?.toISOString() ?? null,
          })
          .eq("id", target.id);
      }
    }

    // Roll up item statuses
    for (const itemId of touchedItems) {
      await rollupItemStatus(itemId);
    }

    return processed;
  });
}

/** Turn storage paths into signed/public URLs platforms can fetch. */
async function resolveMediaUrls(media: MediaEntry[]): Promise<string[]> {
  const admin = createAdminClient();
  const urls: string[] = [];
  for (const m of media) {
    if (m.url) {
      urls.push(m.url);
    } else if (m.storage_path) {
      const { data } = await admin.storage
        .from("media")
        .createSignedUrl(m.storage_path, 60 * 60 * 24); // 24h — long enough for slow platform pulls
      if (data?.signedUrl) urls.push(data.signedUrl);
    }
  }
  return urls;
}

function pickMediaType(media: MediaEntry[]): "none" | "image" | "video" {
  if (media.length === 0) return "none";
  return media.some((m) => m.type === "video") ? "video" : "image";
}
