import "server-only";
import { z } from "zod";
import {
  SocialProviderAdapter,
  TokenSet,
  ConnectedProfile,
  PublishPayload,
  PublishResult,
  AccountMetrics,
  PostMetrics,
  FetchedMention,
  PublicProfileData,
  PublicPost,
  SocialApiError,
  socialFetch,
} from "../types";
import { metaAdapter } from "./meta";

const GRAPH = "https://graph.facebook.com/v25.0";

/**
 * Instagram (Business/Creator accounts) via Meta Graph API.
 * OAuth is shared with the Meta app; fetchProfile discovers IG accounts
 * linked to the user's Facebook Pages. Publishing requires media.
 * Business Discovery API powers competitor tracking.
 */
export const instagramAdapter: SocialProviderAdapter = {
  platform: "instagram",
  capabilities: {
    publishText: false,
    publishImage: true,
    publishVideo: true,
    nativeScheduling: false,
    postMetrics: true,
    accountMetrics: true,
    mentions: true,
    keywordSearch: true, // hashtag search, 30/week limit
    competitorData: true, // Business Discovery
    maxTextLength: 2200,
    notes: [
      "Requires an Instagram Business/Creator account linked to a Facebook Page.",
      "Posts must include an image or video (no text-only).",
      "Hashtag search limited to 30 unique hashtags per week.",
    ],
  },

  // OAuth is via the same Meta app — reuse the FB dialog with IG scopes.
  getAuthUrl: (state) => metaAdapter.getAuthUrl(state),
  exchangeCode: (code) => metaAdapter.exchangeCode(code),
  refreshToken: (tokens) => metaAdapter.refreshToken(tokens),

  async fetchProfile(tokens): Promise<ConnectedProfile[]> {
    // Find IG business accounts through the user's pages.
    const res = await socialFetch(
      "instagram",
      `${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,name,profile_picture_url}&access_token=${encodeURIComponent(
        tokens.accessToken
      )}`
    );
    const data = z
      .object({
        data: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            access_token: z.string(),
            instagram_business_account: z
              .object({
                id: z.string(),
                username: z.string(),
                name: z.string().optional(),
                profile_picture_url: z.string().optional(),
              })
              .optional(),
          })
        ),
      })
      .parse(await res.json());

    const profiles = data.data
      .filter((p) => p.instagram_business_account)
      .map<ConnectedProfile>((p) => ({
        externalId: p.instagram_business_account!.id,
        handle: p.instagram_business_account!.username,
        displayName:
          p.instagram_business_account!.name ??
          p.instagram_business_account!.username,
        avatarUrl: p.instagram_business_account!.profile_picture_url,
        tokenOverride: { accessToken: p.access_token },
        metadata: { linked_page_id: p.id },
      }));

    if (profiles.length === 0) {
      throw new SocialApiError(
        "instagram",
        "no_ig_account",
        "No Instagram Business account linked to your Facebook Pages. Link one in Instagram settings."
      );
    }
    return profiles;
  },

  async publish(tokens, account, post: PublishPayload): Promise<PublishResult> {
    const igId = account.external_id;
    if (post.mediaUrls.length === 0) {
      throw new SocialApiError(
        "instagram",
        "media_required",
        "Instagram requires an image or video"
      );
    }

    let creationId: string;

    if (post.mediaUrls.length === 1) {
      const isVideo = post.mediaType === "video";
      const params = new URLSearchParams({
        caption: post.text,
        access_token: tokens.accessToken,
        ...(isVideo
          ? { media_type: "REELS", video_url: post.mediaUrls[0] }
          : { image_url: post.mediaUrls[0] }),
      });
      const res = await socialFetch("instagram", `${GRAPH}/${igId}/media`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      creationId = z.object({ id: z.string() }).parse(await res.json()).id;

      if (isVideo) await waitForContainer(igId, creationId, tokens);
    } else {
      // carousel
      const children: string[] = [];
      for (const url of post.mediaUrls.slice(0, 10)) {
        const res = await socialFetch("instagram", `${GRAPH}/${igId}/media`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            image_url: url,
            is_carousel_item: "true",
            access_token: tokens.accessToken,
          }).toString(),
        });
        children.push(z.object({ id: z.string() }).parse(await res.json()).id);
      }
      const carouselRes = await socialFetch(
        "instagram",
        `${GRAPH}/${igId}/media`,
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            media_type: "CAROUSEL",
            children: children.join(","),
            caption: post.text,
            access_token: tokens.accessToken,
          }).toString(),
        }
      );
      creationId = z
        .object({ id: z.string() })
        .parse(await carouselRes.json()).id;
    }

    const publishRes = await socialFetch(
      "instagram",
      `${GRAPH}/${igId}/media_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          creation_id: creationId,
          access_token: tokens.accessToken,
        }).toString(),
      }
    );
    const mediaId = z
      .object({ id: z.string() })
      .parse(await publishRes.json()).id;

    // fetch permalink
    let permalink: string | undefined;
    try {
      const linkRes = await socialFetch(
        "instagram",
        `${GRAPH}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(
          tokens.accessToken
        )}`
      );
      permalink = z
        .object({ permalink: z.string().optional() })
        .parse(await linkRes.json()).permalink;
    } catch {
      /* non-fatal */
    }

    return { externalPostId: mediaId, externalUrl: permalink };
  },

  async fetchAccountMetrics(tokens, account): Promise<AccountMetrics> {
    const res = await socialFetch(
      "instagram",
      `${GRAPH}/${account.external_id}?fields=followers_count,follows_count,media_count&access_token=${encodeURIComponent(
        tokens.accessToken
      )}`
    );
    const data = z
      .object({
        followers_count: z.number().optional(),
        follows_count: z.number().optional(),
        media_count: z.number().optional(),
      })
      .parse(await res.json());

    let reach: number | undefined;
    try {
      const insightsRes = await socialFetch(
        "instagram",
        `${GRAPH}/${account.external_id}/insights?metric=reach&period=day&access_token=${encodeURIComponent(
          tokens.accessToken
        )}`
      );
      const insights = (await insightsRes.json()) as {
        data?: { values?: { value?: number }[] }[];
      };
      reach = insights.data?.[0]?.values?.at(-1)?.value;
    } catch {
      /* insights require advanced access; non-fatal */
    }

    return {
      followers: data.followers_count,
      following: data.follows_count,
      postsCount: data.media_count,
      reach,
      raw: data,
    };
  },

  async fetchPostMetrics(tokens, _account, externalPostId): Promise<PostMetrics> {
    const res = await socialFetch(
      "instagram",
      `${GRAPH}/${externalPostId}?fields=like_count,comments_count&access_token=${encodeURIComponent(
        tokens.accessToken
      )}`
    );
    const data = z
      .object({
        like_count: z.number().optional(),
        comments_count: z.number().optional(),
      })
      .parse(await res.json());
    return { likes: data.like_count, comments: data.comments_count, raw: data };
  },

  async fetchMentions(tokens, account, since): Promise<FetchedMention[]> {
    // Comments on recent own media
    const mediaRes = await socialFetch(
      "instagram",
      `${GRAPH}/${account.external_id}/media?fields=id,permalink&limit=10&access_token=${encodeURIComponent(
        tokens.accessToken
      )}`
    );
    const media = (await mediaRes.json()) as {
      data?: { id: string; permalink?: string }[];
    };

    const mentions: FetchedMention[] = [];
    for (const m of media.data ?? []) {
      try {
        const commentsRes = await socialFetch(
          "instagram",
          `${GRAPH}/${m.id}/comments?fields=id,text,username,timestamp&access_token=${encodeURIComponent(
            tokens.accessToken
          )}`
        );
        const comments = (await commentsRes.json()) as {
          data?: { id: string; text?: string; username?: string; timestamp?: string }[];
        };
        for (const c of comments.data ?? []) {
          const at = c.timestamp ? new Date(c.timestamp) : undefined;
          if (at && at < since) continue;
          if (c.username === account.handle) continue;
          mentions.push({
            externalId: c.id,
            kind: "comment",
            authorHandle: c.username,
            content: c.text,
            externalUrl: m.permalink,
            occurredAt: at,
            raw: c,
          });
        }
      } catch {
        /* per-media comment failures are non-fatal */
      }
    }
    return mentions;
  },

  async fetchPublicProfile(handle, tokens): Promise<PublicProfileData> {
    if (!tokens) {
      throw new SocialApiError(
        "instagram",
        "token_required",
        "Business Discovery requires a connected IG business account"
      );
    }
    // business_discovery must be called on OUR ig user id — callers pass
    // tokens from any connected IG account; account id rides in metadata.
    const igUserId = (tokens as TokenSet & { igUserId?: string }).igUserId;
    if (!igUserId) {
      throw new SocialApiError(
        "instagram",
        "ig_user_required",
        "Business Discovery requires the connected IG account id"
      );
    }
    const res = await socialFetch(
      "instagram",
      `${GRAPH}/${igUserId}?fields=business_discovery.username(${encodeURIComponent(
        handle
      )}){id,username,name,followers_count,follows_count,media_count}&access_token=${encodeURIComponent(
        tokens.accessToken
      )}`
    );
    const data = z
      .object({
        business_discovery: z.object({
          id: z.string(),
          username: z.string(),
          name: z.string().optional(),
          followers_count: z.number().optional(),
          follows_count: z.number().optional(),
          media_count: z.number().optional(),
        }),
      })
      .parse(await res.json());
    const bd = data.business_discovery;
    return {
      externalId: bd.id,
      handle: bd.username,
      displayName: bd.name,
      followers: bd.followers_count,
      following: bd.follows_count,
      postsCount: bd.media_count,
      raw: bd,
    };
  },

  async fetchPublicPosts(handle, limit, tokens): Promise<PublicPost[]> {
    if (!tokens) {
      throw new SocialApiError(
        "instagram",
        "token_required",
        "Business Discovery requires a connected IG business account"
      );
    }
    const igUserId = (tokens as TokenSet & { igUserId?: string }).igUserId;
    if (!igUserId) {
      throw new SocialApiError(
        "instagram",
        "ig_user_required",
        "Business Discovery requires the connected IG account id"
      );
    }
    const res = await socialFetch(
      "instagram",
      `${GRAPH}/${igUserId}?fields=business_discovery.username(${encodeURIComponent(
        handle
      )}){media.limit(${Math.min(limit, 25)}){id,caption,media_type,like_count,comments_count,timestamp,permalink}}&access_token=${encodeURIComponent(
        tokens.accessToken
      )}`
    );
    const data = (await res.json()) as {
      business_discovery?: {
        media?: {
          data?: {
            id: string;
            caption?: string;
            media_type?: string;
            like_count?: number;
            comments_count?: number;
            timestamp?: string;
            permalink?: string;
          }[];
        };
      };
    };
    return (data.business_discovery?.media?.data ?? []).map((m) => ({
      externalId: m.id,
      postedAt: m.timestamp ? new Date(m.timestamp) : undefined,
      content: m.caption,
      mediaType:
        m.media_type === "VIDEO"
          ? ("reel" as const)
          : m.media_type === "CAROUSEL_ALBUM"
            ? ("carousel" as const)
            : ("image" as const),
      likes: m.like_count,
      comments: m.comments_count,
      hashtags: extractHashtags(m.caption ?? ""),
      raw: m,
    }));
  },
};

function extractHashtags(text: string): string[] {
  return [...text.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1].toLowerCase());
}

async function waitForContainer(
  igId: string,
  creationId: string,
  tokens: TokenSet,
  maxWaitMs = 60_000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const res = await socialFetch(
      "instagram",
      `${GRAPH}/${creationId}?fields=status_code&access_token=${encodeURIComponent(
        tokens.accessToken
      )}`
    );
    const status = z
      .object({ status_code: z.string().optional() })
      .parse(await res.json()).status_code;
    if (status === "FINISHED") return;
    if (status === "ERROR") {
      throw new SocialApiError(
        "instagram",
        "container_error",
        "Instagram video processing failed"
      );
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new SocialApiError(
    "instagram",
    "container_timeout",
    "Instagram video processing timed out",
    true
  );
}
