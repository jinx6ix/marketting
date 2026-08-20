import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { getAdapter } from "@/lib/social/registry";
import { getAccountTokens } from "@/lib/social/accounts";
import {
  SocialApiError,
  type PublishPayload,
} from "@/lib/social/types";
import { formatForPlatform } from "@/lib/social/format";
import { resolvePlatformMedia, type MediaEntry } from "@/lib/social/media-resolver";
import {
  nextRetryAt,
  tryAcquire,
  markRateLimited,
} from "./rate-limit";
import { runJob } from "./runner";
import { rollupItemStatus } from "./item-rollup";
import type { Platform, Json } from "@/types/database";

/**
 * Publish job:
 *
 * 1. Finds pending/queued post targets.
 * 2. Filters them to targets whose parent marketing item is due.
 * 3. Acquires a platform rate-limit slot.
 * 4. Claims the target using an optimistic database lock.
 * 5. Loads the connected social account and tokens.
 * 6. Resolves platform-specific media (compresses oversized images, reuses
 *    a previously-generated variant if one exists).
 * 7. Publishes through the platform adapter.
 * 8. Persists the external post ID.
 * 9. Handles retryable/non-retryable failures.
 * 10. Rolls the parent marketing item status up.
 */
export async function publishDue(): Promise<ReturnType<typeof runJob>> {
  return runJob("publish", async () => {
    const admin = createAdminClient();
    const now = new Date();
    const nowIso = now.toISOString();

    console.log("[publish] ========================================");
    console.log("[publish] Starting publish job");
    console.log("[publish] Current time:", nowIso);

    // -----------------------------------------------------------------------
    // 1. Find pending/queued targets that are eligible for retry.
    // -----------------------------------------------------------------------

    const { data: targets, error } = await admin
      .from("post_targets")
      .select(
        "*, marketing_items!inner(id, status, scheduled_at, title, body, media, hashtags)"
      )
      .in("status", ["pending", "queued"])
      .or(`next_retry_at.is.null,next_retry_at.lte.${nowIso}`)
      .limit(20);

    if (error) {
      console.error("[publish] TARGET QUERY ERROR:", error);
      throw new Error(error.message);
    }

    console.log("[publish] Targets returned from database:", targets?.length ?? 0);

    // -----------------------------------------------------------------------
    // 2. Diagnostic output for every target returned by the database.
    // -----------------------------------------------------------------------

    for (const target of targets ?? []) {
      const item = target.marketing_items as unknown as {
        id: string;
        status: string;
        scheduled_at: string | null;
        title: string;
      };

      console.log("[publish] DATABASE TARGET:", {
        targetId: target.id,
        itemId: target.item_id,
        platform: target.platform,
        targetStatus: target.status,
        retryCount: target.retry_count,
        nextRetryAt: target.next_retry_at,
        itemStatus: item?.status,
        scheduledAt: item?.scheduled_at,
        title: item?.title,
      });
    }

    // -----------------------------------------------------------------------
    // 3. Filter targets to items that are actually due.
    // -----------------------------------------------------------------------

    const due = (targets ?? []).filter((target) => {
      const item = target.marketing_items as unknown as {
        id: string;
        status: string;
        scheduled_at: string | null;
      };

      const itemStatusIsValid =
        item.status === "scheduled" ||
        item.status === "publishing";

      const hasScheduledAt = Boolean(item.scheduled_at);

      const scheduledTimeIsDue =
        hasScheduledAt &&
        new Date(item.scheduled_at as string).getTime() <= now.getTime();

      const isDue =
        itemStatusIsValid &&
        hasScheduledAt &&
        scheduledTimeIsDue;

      console.log("[publish] DUE CHECK:", {
        targetId: target.id,
        itemId: target.item_id,
        platform: target.platform,
        targetStatus: target.status,
        itemStatus: item.status,
        scheduledAt: item.scheduled_at,
        itemStatusIsValid,
        hasScheduledAt,
        scheduledTimeIsDue,
        isDue,
      });

      return isDue;
    });

    console.log("[publish] Due targets:", due.length);

    if (due.length === 0) {
      console.log("[publish] No due targets found.");
      console.log("[publish] ========================================");
      return 0;
    }

    let processed = 0;
    const touchedItems = new Set<string>();

    // -----------------------------------------------------------------------
    // 4. Process each due target.
    // -----------------------------------------------------------------------

    for (const target of due) {
      const platform = target.platform as Platform;

      console.log("[publish] ----------------------------------------");
      console.log("[publish] PROCESSING TARGET:", {
        targetId: target.id,
        itemId: target.item_id,
        platform,
        status: target.status,
      });

      // ---------------------------------------------------------------------
      // 4A. Rate limit
      // ---------------------------------------------------------------------

      let acquired = false;

      try {
        acquired = await tryAcquire(platform);
      } catch (error) {
        console.error("[publish] RATE LIMIT ERROR:", {
          targetId: target.id,
          platform,
          error,
        });

        // Rate limiter is intended to fail open, but keep this defensive.
        acquired = true;
      }

      console.log("[publish] RATE LIMIT RESULT:", {
        targetId: target.id,
        platform,
        acquired,
      });

      if (!acquired) {
        console.log("[publish] SKIPPED - RATE LIMITED:", {
          targetId: target.id,
          platform,
        });

        continue;
      }

      // ---------------------------------------------------------------------
      // 4B. Claim target
      //
      // maybeSingle(), not single(): when another worker claims this same
      // target first (a real, expected race between /api/cron/publish and
      // /api/cron/retry-partial, or two overlapping publish ticks), this
      // update matches 0 rows. single() treats 0 rows as an error
      // (PGRST116, "Cannot coerce the result to a single JSON object"),
      // which is noisy and semantically wrong — losing a claim race is a
      // normal, expected outcome, not a database failure. With
      // maybeSingle(), that case now comes back as claimError: null,
      // claimed: null, and falls through to the ordinary
      // "SKIPPED - TARGET WAS NOT CLAIMED" log below instead of the
      // "CLAIM DATABASE ERROR" one.
      // ---------------------------------------------------------------------

      console.log("[publish] Attempting to claim target:", {
        targetId: target.id,
        platform,
        currentStatus: target.status,
      });

      const { data: claimed, error: claimError } = await admin
        .from("post_targets")
        .update({
          status: "publishing",
        })
        .eq("id", target.id)
        .in("status", ["pending", "queued"])
        .select("id, status")
        .maybeSingle();

      console.log("[publish] CLAIM RESULT:", {
        targetId: target.id,
        platform,
        claimed,
        claimError,
      });

      if (claimError) {
        console.error("[publish] CLAIM DATABASE ERROR:", {
          targetId: target.id,
          platform,
          error: claimError.message,
          details: claimError.details,
          hint: claimError.hint,
          code: claimError.code,
        });

        continue;
      }

      if (!claimed) {
        console.log(
          "[publish] SKIPPED - TARGET ALREADY CLAIMED BY ANOTHER WORKER:",
          {
            targetId: target.id,
            platform,
          }
        );

        continue;
      }

      console.log("[publish] TARGET CLAIMED:", {
        targetId: target.id,
        platform,
      });

      touchedItems.add(target.item_id);

      // ---------------------------------------------------------------------
      // 4C. Move parent marketing item into publishing state.
      // ---------------------------------------------------------------------

      const { error: itemStatusError } = await admin
        .from("marketing_items")
        .update({
          status: "publishing",
        })
        .eq("id", target.item_id)
        .eq("status", "scheduled");

      if (itemStatusError) {
        console.error("[publish] ITEM STATUS UPDATE ERROR:", {
          targetId: target.id,
          itemId: target.item_id,
          platform,
          error: itemStatusError,
        });
      }

      // ---------------------------------------------------------------------
      // 4D. Idempotency check.
      //
      // If the platform post was already created but our DB write previously
      // failed, don't create another post.
      // ---------------------------------------------------------------------

      if (target.external_post_id) {
        console.log("[publish] EXISTING EXTERNAL POST FOUND:", {
          targetId: target.id,
          platform,
          externalPostId: target.external_post_id,
        });

        try {
          await finalizeTarget(admin, target.id, {
            status: "published",
            external_post_id: target.external_post_id,
            external_url: target.external_url ?? null,
            published_at:
              target.published_at ?? new Date().toISOString(),
            error: null,
          });

          processed++;

          console.log("[publish] EXISTING POST FINALIZED:", {
            targetId: target.id,
            platform,
          });
        } catch (error) {
          console.error("[publish] FINALIZE EXISTING POST ERROR:", {
            targetId: target.id,
            platform,
            error,
          });
        }

        continue;
      }

      let published = false;

      try {
        // -------------------------------------------------------------------
        // 4E. Load social account and tokens.
        // -------------------------------------------------------------------

        console.log("[publish] Loading account tokens:", {
          targetId: target.id,
          platform,
          socialAccountId: target.social_account_id,
        });

        const { account, tokens } = await getAccountTokens(
          target.social_account_id
        );

        console.log("[publish] Account loaded:", {
          targetId: target.id,
          platform,
          accountId: target.social_account_id,
          accountPlatform: account?.platform,
        });

        // -------------------------------------------------------------------
        // 4F. Load adapter.
        // -------------------------------------------------------------------

        console.log("[publish] Loading adapter:", {
          targetId: target.id,
          platform,
        });

        const adapter = getAdapter(platform);

        console.log("[publish] Adapter loaded:", {
          targetId: target.id,
          platform,
          adapterFound: Boolean(adapter),
        });

        // -------------------------------------------------------------------
        // 4G. Get marketing item data.
        // -------------------------------------------------------------------

        const item = target.marketing_items as unknown as {
          title: string;
          body: string;
          media: MediaEntry[];
          hashtags: string[];
        };

        console.log("[publish] Item data:", {
          targetId: target.id,
          platform,
          title: item.title,
          bodyLength: item.body?.length ?? 0,
          mediaCount: item.media?.length ?? 0,
          hashtagCount: item.hashtags?.length ?? 0,
        });

        // -------------------------------------------------------------------
        // 4H. Resolve platform-specific media.
        //
        // Reuses target.variant_media if a compressed variant already
        // exists for this target; otherwise checks each image against this
        // platform's real size limit (Meta rejects Facebook photos over
        // 10MB outright — error_subcode 1366046, "Photos should be less
        // than 10 MB") and compresses anything oversized, persisting the
        // result back onto variant_media so retries reuse it instead of
        // re-compressing from scratch every attempt.
        // -------------------------------------------------------------------

        console.log("[publish] MEDIA VARIANT CHECK:", {
          targetId: target.id,
          platform,
          hasExistingVariant: Boolean(
            target.variant_media &&
              (target.variant_media as MediaEntry[]).length > 0
          ),
        });

        // Bounded: image compression involves a storage download, a sharp
        // re-encode, and a storage upload — any one of those hanging
        // (a slow/stuck native binary call, a stalled network request)
        // would otherwise block this target indefinitely, which is
        // exactly what "stuck in publishing, reaped after 15 minutes"
        // looks like. Give it 45s; on timeout, fall back to the
        // unmodified original rather than block the whole job — the
        // platform's own size-limit error (if any) can still surface
        // normally afterward instead of the target silently hanging.
        let mediaSource: MediaEntry[];
        try {
          mediaSource = await withTimeout(
            resolvePlatformMedia(
              platform,
              item.media ?? [],
              target.variant_media as MediaEntry[] | null,
              async (variant) => {
                console.log("[publish] MEDIA VARIANT CREATED:", {
                  targetId: target.id,
                  platform,
                  variantMediaCount: variant.length,
                });

                const { error: variantError } = await admin
                  .from("post_targets")
                  .update({ variant_media: variant as unknown as Json })
                  .eq("id", target.id);

                if (variantError) {
                  console.error("[publish] MEDIA VARIANT SAVE ERROR:", {
                    targetId: target.id,
                    platform,
                    error: variantError,
                  });
                }
              }
            ),
            45_000,
            "resolvePlatformMedia"
          );
        } catch (mediaError) {
          console.error(
            "[publish] MEDIA RESOLUTION FAILED OR TIMED OUT — falling back to original media:",
            {
              targetId: target.id,
              platform,
              error:
                mediaError instanceof Error
                  ? mediaError.message
                  : String(mediaError),
            }
          );
          mediaSource = item.media ?? [];
        }

        const mediaType = pickMediaType(mediaSource);

        console.log("[publish] MEDIA:", {
          targetId: target.id,
          platform,
          mediaCount: mediaSource.length,
          mediaType,
        });

        // -------------------------------------------------------------------
        // YouTube validation.
        // -------------------------------------------------------------------

        if (platform === "youtube" && mediaType !== "video") {
          throw new SocialApiError(
            "youtube",
            "video_required",
            "YouTube requires a video — this item's media is image-only",
            false
          );
        }

        const mediaUrls = await resolveMediaUrls(mediaSource);

        console.log("[publish] MEDIA URLS RESOLVED:", {
          targetId: target.id,
          platform,
          mediaUrlCount: mediaUrls.length,
        });

        // -------------------------------------------------------------------
        // 4I. Format content for the platform.
        // -------------------------------------------------------------------

        const formatted = target.variant_body
          ? {
              text: target.variant_body,
              title: item.title,
            }
          : formatForPlatform(platform, {
              title: item.title,
              body: item.body,
              hashtags: item.hashtags ?? [],
            });

        console.log("[publish] CONTENT FORMATTED:", {
          targetId: target.id,
          platform,
          textLength: formatted.text?.length ?? 0,
          title: formatted.title,
        });

        const payload: PublishPayload = {
          text: formatted.text,
          title: formatted.title,
          mediaUrls,
          mediaType,
        };

        console.log("[publish] CALLING PLATFORM ADAPTER:", {
          targetId: target.id,
          platform,
          mediaType,
          mediaUrlCount: mediaUrls.length,
        });

        // -------------------------------------------------------------------
        // 4J. Actual social platform API call.
        // -------------------------------------------------------------------

        const result = await adapter.publish(
          tokens,
          account,
          payload
        );

        published = true;

        console.log("[publish] PLATFORM PUBLISH SUCCESS:", {
          targetId: target.id,
          platform,
          externalPostId: result.externalPostId,
          externalUrl: result.externalUrl,
        });

        // -------------------------------------------------------------------
        // 4K. Persist successful publication.
        // -------------------------------------------------------------------

        await finalizeTarget(admin, target.id, {
          status: "published",
          external_post_id: result.externalPostId,
          external_url: result.externalUrl ?? null,
          published_at: new Date().toISOString(),
          error: null,
        });

        processed++;

        console.log("[publish] TARGET FINALIZED:", {
          targetId: target.id,
          platform,
          processed,
        });
      } catch (e) {
        // -------------------------------------------------------------------
        // If the platform accepted the post but final DB persistence failed,
        // DO NOT reset to pending because that could create a duplicate.
        // -------------------------------------------------------------------

        if (published) {
          console.error(
            "[publish] PLATFORM ACCEPTED POST BUT FINALIZE FAILED:",
            {
              targetId: target.id,
              platform,
              error: e,
            }
          );

          continue;
        }

        const message =
          e instanceof Error ? e.message : String(e);

        const retryable =
          e instanceof SocialApiError
            ? e.retryable
            : true;

        console.error("[publish] PUBLISH ERROR:", {
          targetId: target.id,
          itemId: target.item_id,
          platform,
          error: message,
          retryable,
          errorObject: e,
        });

        if (
          e instanceof SocialApiError &&
          e.retryAfterMs
        ) {
          console.log("[publish] MARKING PLATFORM RATE LIMITED:", {
            targetId: target.id,
            platform,
            retryAfterMs: e.retryAfterMs,
          });

          await markRateLimited(
            platform,
            e.retryAfterMs
          );
        }

        const retry = retryable
          ? nextRetryAt(target.retry_count)
          : null;

        const newStatus = retry
          ? "pending"
          : "failed";

        console.log("[publish] TARGET FAILURE STATE:", {
          targetId: target.id,
          platform,
          newStatus,
          retryAt: retry?.toISOString() ?? null,
          retryCount: target.retry_count + 1,
        });

        const { error: updateError } = await admin
          .from("post_targets")
          .update({
            status: newStatus,
            error: message.slice(0, 1000),
            retry_count: target.retry_count + 1,
            next_retry_at:
              retry?.toISOString() ?? null,
          })
          .eq("id", target.id);

        if (updateError) {
          console.error(
            "[publish] FAILED TO SAVE TARGET ERROR:",
            {
              targetId: target.id,
              platform,
              error: updateError,
            }
          );
        }
      }
    }

    // -----------------------------------------------------------------------
    // 5. Roll up marketing item statuses.
    // -----------------------------------------------------------------------

    console.log("[publish] Rolling up touched items:", {
      count: touchedItems.size,
      itemIds: [...touchedItems],
    });

    for (const itemId of touchedItems) {
      try {
        await rollupItemStatus(itemId);

        console.log("[publish] ITEM ROLLUP COMPLETE:", {
          itemId,
        });
      } catch (error) {
        console.error("[publish] ITEM ROLLUP ERROR:", {
          itemId,
          error,
        });
      }
    }

    console.log("[publish] JOB COMPLETE:", {
      processed,
      touchedItems: touchedItems.size,
    });

    console.log("[publish] ========================================");

    return processed;
  });
}

/**
 * Persist a target's final publish state.
 *
 * The platform may already have accepted the post, so this write is retried
 * before allowing the job to give up.
 */
async function finalizeTarget(
  admin: ReturnType<typeof createAdminClient>,
  targetId: string,
  fields: {
    status: "published";
    external_post_id: string;
    external_url: string | null;
    published_at: string;
    error: null;
  }
): Promise<void> {
  let lastError: string | null = null;

  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await admin
      .from("post_targets")
      .update(fields)
      .eq("id", targetId);

    if (!error) {
      console.log("[publish] FINALIZE DATABASE SUCCESS:", {
        targetId,
        attempt: attempt + 1,
      });

      return;
    }

    lastError = error.message;

    console.error("[publish] FINALIZE DATABASE RETRY:", {
      targetId,
      attempt: attempt + 1,
      error: error.message,
    });

    await new Promise((resolve) =>
      setTimeout(resolve, 500 * (attempt + 1))
    );
  }

  throw new Error(
    `Failed to persist published state: ${lastError}`
  );
}

/**
 * Turn storage paths into signed/public URLs that platforms can fetch.
 */
async function resolveMediaUrls(media: MediaEntry[]): Promise<string[]> {
  const admin = createAdminClient();
  const urls: string[] = [];

  for (const m of media) {
    let url: string | null = null;

    if (m.url) {
      url = m.url;
    } else if (m.storage_path) {
      console.log("[publish] Creating signed URL:", {
        storagePath: m.storage_path,
      });

      const { data, error } = await admin.storage
        .from("media")
        .createSignedUrl(m.storage_path, 60 * 60 * 24);

      if (error) {
        console.error("[publish] SIGNED URL ERROR:", {
          storagePath: m.storage_path,
          error: error.message,
        });

        continue;
      }

      url = data?.signedUrl ?? null;

      // Never log the actual signed URL — it carries an access token in
      // its query string. hasUrl + storagePath is enough to debug this
      // step; the previous version logged url.substring(0, 200), which
      // for a typical Supabase signed URL includes the token itself since
      // the query string starts well before character 200.
      console.log("[publish] SIGNED URL CREATED:", {
        storagePath: m.storage_path,
        hasUrl: !!url,
      });
    }

    if (!url) {
      console.error("[publish] NO MEDIA URL:", { storagePath: m.storage_path });
      continue;
    }

    // Check whether our own server can actually access the file.
    try {
      const response = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
      });

      console.log("[publish] MEDIA HEAD RESULT:", {
        storagePath: m.storage_path,
        status: response.status,
        ok: response.ok,
        contentType: response.headers.get("content-type"),
        contentLength: response.headers.get("content-length"),
      });

      if (!response.ok) {
        console.error("[publish] MEDIA URL IS NOT ACCESSIBLE:", {
          storagePath: m.storage_path,
          status: response.status,
          statusText: response.statusText,
        });

        continue;
      }

      const contentType =
        response.headers.get("content-type")?.toLowerCase() ?? "";

      const contentLength = response.headers.get("content-length");

      console.log("[publish] MEDIA VALIDATION:", {
        storagePath: m.storage_path,
        contentType,
        contentLength,
        sizeMB: contentLength
          ? (Number(contentLength) / 1024 / 1024).toFixed(2)
          : "unknown",
      });

      urls.push(url);
    } catch (error) {
      console.error("[publish] MEDIA FETCH FAILED:", {
        storagePath: m.storage_path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return urls;
}

function pickMediaType(
  media: MediaEntry[]
): "none" | "image" | "video" {
  if (media.length === 0) {
    return "none";
  }

  return media.some(
    (entry) => entry.type === "video"
  )
    ? "video"
    : "image";
}

/** Rejects with an Error after `ms` if `promise` hasn't settled by then. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}