import "server-only";
import { z } from "zod";
import {
  SocialProviderAdapter,
  ConnectedProfile,
  PublishPayload,
  PublishResult,
  AccountMetrics,
  PostMetrics,
  FetchedMention,
  SocialApiError,
  socialFetch,
} from "../types";
import { redirectUri, formBody } from "../oauth";

const GRAPH = "https://graph.facebook.com/v25.0";

const tokenResponse = z.object({
  access_token: z.string(),
  token_type: z.string().optional(),
  expires_in: z.number().optional(),
});

const pagesResponse = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      access_token: z.string(),
      picture: z
        .object({ data: z.object({ url: z.string() }) })
        .optional(),
    })
  ),
});

/**
 * Facebook Pages adapter (Meta Graph API).
 * Dev-mode apps can post to admin-owned Pages immediately; Advanced Access
 * (App Review + business verification) is needed for other users' pages.
 */
export const metaAdapter: SocialProviderAdapter = {
  platform: "facebook",
  capabilities: {
    publishText: true,
    publishImage: true,
    publishVideo: true,
    nativeScheduling: true,
    postMetrics: true,
    accountMetrics: true,
    mentions: true,
    keywordSearch: false,
    competitorData: true,
    maxTextLength: 63206,
    notes: [
      "Requires a Facebook Page (not a personal profile).",
      "Dev mode works on pages you admin; App Review needed for Advanced Access.",
    ],
  },

  getAuthUrl(state) {
    const params = new URLSearchParams({
      client_id: process.env.META_APP_ID!,
      redirect_uri: redirectUri("facebook"),
      state,
      scope: [
        "pages_show_list",
        "pages_manage_posts",
        "pages_read_engagement",
        "pages_read_user_content",
        "business_management",
        "instagram_basic",
        "instagram_content_publish",
        "instagram_manage_comments",
        "instagram_manage_insights",
      ].join(","),
      response_type: "code",
    });
    return `https://www.facebook.com/v25.0/dialog/oauth?${params}`;
  },

  async exchangeCode(code) {
    // short-lived user token
    const res = await socialFetch(
      "facebook",
      `${GRAPH}/oauth/access_token?${new URLSearchParams({
        client_id: process.env.META_APP_ID!,
        client_secret: process.env.META_APP_SECRET!,
        redirect_uri: redirectUri("facebook"),
        code,
      })}`
    );
    const short = tokenResponse.parse(await res.json());

    // exchange for long-lived (~60 days)
    const longRes = await socialFetch(
      "facebook",
      `${GRAPH}/oauth/access_token?${new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: process.env.META_APP_ID!,
        client_secret: process.env.META_APP_SECRET!,
        fb_exchange_token: short.access_token,
      })}`
    );
    const long = tokenResponse.parse(await longRes.json());
    return {
      accessToken: long.access_token,
      expiresAt: long.expires_in
        ? new Date(Date.now() + long.expires_in * 1000)
        : undefined,
    };
  },

  async refreshToken(tokens) {
    // Long-lived user tokens are re-exchanged the same way.
    const res = await socialFetch(
      "facebook",
      `${GRAPH}/oauth/access_token?${new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: process.env.META_APP_ID!,
        client_secret: process.env.META_APP_SECRET!,
        fb_exchange_token: tokens.accessToken,
      })}`
    );
    const long = tokenResponse.parse(await res.json());
    return {
      accessToken: long.access_token,
      expiresAt: long.expires_in
        ? new Date(Date.now() + long.expires_in * 1000)
        : undefined,
    };
  },

  async fetchProfile(tokens) {
    const res = await socialFetch(
      "facebook",
      `${GRAPH}/me/accounts?fields=id,name,access_token,picture&access_token=${encodeURIComponent(
        tokens.accessToken
      )}`
    );
    const pages = pagesResponse.parse(await res.json());
    if (pages.data.length === 0) {
      throw new SocialApiError(
        "facebook",
        "no_pages",
        "No Facebook Pages found for this user. Create a Page first."
      );
    }
    return pages.data.map<ConnectedProfile>((p) => ({
      externalId: p.id,
      handle: p.name,
      displayName: p.name,
      avatarUrl: p.picture?.data.url,
      // Page tokens don't expire while the user token is valid.
      tokenOverride: { accessToken: p.access_token },
      metadata: { kind: "page" },
    }));
  },

  async publish(tokens, account, post: PublishPayload): Promise<PublishResult> {
    const pageId = account.external_id;
    let postId: string;

    if (post.mediaType === "image" && post.mediaUrls.length > 0) {
      if (post.mediaUrls.length === 1) {
        const res = await socialFetch("facebook", `${GRAPH}/${pageId}/photos`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: formBody({
            url: post.mediaUrls[0],
            caption: post.text,
            access_token: tokens.accessToken,
          }),
        });
        const data = z
          .object({ post_id: z.string().optional(), id: z.string() })
          .parse(await res.json());
        postId = data.post_id ?? data.id;
      } else {
        // multi-photo: upload unpublished, then attach
        const mediaIds: string[] = [];
        for (const url of post.mediaUrls) {
          const res = await socialFetch("facebook", `${GRAPH}/${pageId}/photos`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: formBody({
              url,
              published: "false",
              access_token: tokens.accessToken,
            }),
          });
          mediaIds.push(z.object({ id: z.string() }).parse(await res.json()).id);
        }
        const feedRes = await socialFetch("facebook", `${GRAPH}/${pageId}/feed`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: formBody({
            message: post.text,
            attached_media: JSON.stringify(
              mediaIds.map((id) => ({ media_fbid: id }))
            ),
            access_token: tokens.accessToken,
          }),
        });
        postId = z.object({ id: z.string() }).parse(await feedRes.json()).id;
      }
    } else if (post.mediaType === "video" && post.mediaUrls.length > 0) {
      const res = await socialFetch("facebook", `${GRAPH}/${pageId}/videos`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody({
          file_url: post.mediaUrls[0],
          description: post.text,
          access_token: tokens.accessToken,
        }),
      });
      postId = z.object({ id: z.string() }).parse(await res.json()).id;
    } else {
      const res = await socialFetch("facebook", `${GRAPH}/${pageId}/feed`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody({
          message: post.text,
          ...(post.link ? { link: post.link } : {}),
          access_token: tokens.accessToken,
        }),
      });
      postId = z.object({ id: z.string() }).parse(await res.json()).id;
    }

    return {
      externalPostId: postId,
      externalUrl: `https://www.facebook.com/${postId}`,
    };
  },

  async fetchAccountMetrics(tokens, account): Promise<AccountMetrics> {
    const res = await socialFetch(
      "facebook",
      `${GRAPH}/${account.external_id}?fields=followers_count,fan_count&access_token=${encodeURIComponent(
        tokens.accessToken
      )}`
    );
    const data = z
      .object({
        followers_count: z.number().optional(),
        fan_count: z.number().optional(),
      })
      .parse(await res.json());

    let impressions: number | undefined;
    try {
      const insightsRes = await socialFetch(
        "facebook",
        `${GRAPH}/${account.external_id}/insights?metric=page_impressions&period=day&access_token=${encodeURIComponent(
          tokens.accessToken
        )}`
      );
      const insights = (await insightsRes.json()) as {
        data?: { values?: { value?: number }[] }[];
      };
      impressions = insights.data?.[0]?.values?.at(-1)?.value;
    } catch {
      // insights need pages_read_engagement advanced access; non-fatal
    }

    return {
      followers: data.followers_count ?? data.fan_count,
      impressions,
      raw: data,
    };
  },

  async fetchPostMetrics(tokens, _account, externalPostId): Promise<PostMetrics> {
    const res = await socialFetch(
      "facebook",
      `${GRAPH}/${externalPostId}?fields=likes.summary(true),comments.summary(true),shares&access_token=${encodeURIComponent(
        tokens.accessToken
      )}`
    );
    const data = (await res.json()) as {
      likes?: { summary?: { total_count?: number } };
      comments?: { summary?: { total_count?: number } };
      shares?: { count?: number };
    };
    return {
      likes: data.likes?.summary?.total_count,
      comments: data.comments?.summary?.total_count,
      shares: data.shares?.count,
      raw: data,
    };
  },

  async fetchMentions(tokens, account, since): Promise<FetchedMention[]> {
    const res = await socialFetch(
      "facebook",
      `${GRAPH}/${account.external_id}/feed?fields=id,message,from,created_time,permalink_url&since=${Math.floor(
        since.getTime() / 1000
      )}&access_token=${encodeURIComponent(tokens.accessToken)}`
    );
    const data = (await res.json()) as {
      data?: {
        id: string;
        message?: string;
        from?: { id: string; name?: string };
        created_time?: string;
        permalink_url?: string;
      }[];
    };
    return (data.data ?? [])
      .filter((p) => p.from && p.from.id !== account.external_id)
      .map((p) => ({
        externalId: p.id,
        kind: "mention" as const,
        authorName: p.from?.name,
        content: p.message,
        externalUrl: p.permalink_url,
        occurredAt: p.created_time ? new Date(p.created_time) : undefined,
        raw: p,
      }));
  },

  async fetchPublicProfile(handleOrId, tokens) {
    if (!tokens) {
      throw new SocialApiError(
        "facebook",
        "token_required",
        "Facebook public page lookup requires a connected account token"
      );
    }
    const res = await socialFetch(
      "facebook",
      `${GRAPH}/${encodeURIComponent(handleOrId)}?fields=id,name,followers_count,fan_count&access_token=${encodeURIComponent(
        tokens.accessToken
      )}`
    );
    const data = z
      .object({
        id: z.string(),
        name: z.string(),
        followers_count: z.number().optional(),
        fan_count: z.number().optional(),
      })
      .parse(await res.json());
    return {
      externalId: data.id,
      handle: data.name,
      displayName: data.name,
      followers: data.followers_count ?? data.fan_count,
      raw: data,
    };
  },
};
