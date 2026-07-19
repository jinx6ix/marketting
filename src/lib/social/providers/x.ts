import "server-only";
import { z } from "zod";
import {
  SocialProviderAdapter,
  PublishPayload,
  PublishResult,
  AccountMetrics,
  PostMetrics,
  FetchedMention,
  PublicProfileData,
  SocialApiError,
  socialFetch,
} from "../types";
import { redirectUri, formBody, basicAuthHeader } from "../oauth";

const API = "https://api.x.com/2";
const UPLOAD = "https://upload.twitter.com/1.1";

const tokenResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
  scope: z.string().optional(),
});

function xTier(): "free" | "basic" {
  return process.env.X_TIER === "basic" ? "basic" : "free";
}

/**
 * X (Twitter) adapter — OAuth 2.0 with PKCE.
 * Free tier: publishing only (~500 posts/mo). Mentions/search/metrics
 * require Basic (paid) — feature-gated via X_TIER env.
 */
export const xAdapter: SocialProviderAdapter = {
  platform: "x",
  capabilities: {
    publishText: true,
    publishImage: true,
    publishVideo: true,
    nativeScheduling: false,
    postMetrics: xTier() === "basic",
    accountMetrics: true,
    mentions: xTier() === "basic",
    keywordSearch: xTier() === "basic",
    competitorData: xTier() === "basic",
    maxTextLength: 280,
    notes: [
      "Free tier is write-only (~500 posts/month).",
      "Mentions, keyword search and post metrics require the paid Basic tier (set X_TIER=basic).",
    ],
  },

  getAuthUrl(state, codeChallenge) {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: process.env.X_CLIENT_ID!,
      redirect_uri: redirectUri("x"),
      scope: "tweet.read tweet.write users.read offline.access",
      state,
      code_challenge: codeChallenge!,
      code_challenge_method: "S256",
    });
    return `https://x.com/i/oauth2/authorize?${params}`;
  },

  async exchangeCode(code, codeVerifier) {
    const res = await socialFetch("x", `${API}/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: basicAuthHeader(
          process.env.X_CLIENT_ID!,
          process.env.X_CLIENT_SECRET!
        ),
      },
      body: formBody({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri("x"),
        code_verifier: codeVerifier!,
      }),
    });
    const data = tokenResponse.parse(await res.json());
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : undefined,
      scopes: data.scope?.split(" "),
    };
  },

  async refreshToken(tokens) {
    if (!tokens.refreshToken) {
      throw new SocialApiError("x", "no_refresh_token", "Missing refresh token");
    }
    const res = await socialFetch("x", `${API}/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: basicAuthHeader(
          process.env.X_CLIENT_ID!,
          process.env.X_CLIENT_SECRET!
        ),
      },
      body: formBody({
        grant_type: "refresh_token",
        refresh_token: tokens.refreshToken,
      }),
    });
    const data = tokenResponse.parse(await res.json());
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? tokens.refreshToken,
      expiresAt: data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : undefined,
    };
  },

  async fetchProfile(tokens) {
    const res = await socialFetch("x", `${API}/users/me?user.fields=profile_image_url,public_metrics,username,name`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    const data = z
      .object({
        data: z.object({
          id: z.string(),
          username: z.string(),
          name: z.string(),
          profile_image_url: z.string().optional(),
        }),
      })
      .parse(await res.json());
    return [
      {
        externalId: data.data.id,
        handle: data.data.username,
        displayName: data.data.name,
        avatarUrl: data.data.profile_image_url,
      },
    ];
  },

  async publish(tokens, _account, post: PublishPayload): Promise<PublishResult> {
    const body: { text: string; media?: { media_ids: string[] } } = {
      text: post.text.slice(0, 280),
    };

    // Media upload uses v1.1 endpoint with OAuth2 user token
    if (post.mediaType !== "none" && post.mediaUrls.length > 0) {
      const mediaIds: string[] = [];
      for (const url of post.mediaUrls.slice(0, 4)) {
        const mediaRes = await fetch(url);
        if (!mediaRes.ok) {
          throw new SocialApiError("x", "media_fetch", `Cannot fetch media ${url}`);
        }
        const buf = Buffer.from(await mediaRes.arrayBuffer());
        const uploadRes = await socialFetch("x", `${UPLOAD}/media/upload.json`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: formBody({ media_data: buf.toString("base64") }),
        });
        const media = z
          .object({ media_id_string: z.string() })
          .parse(await uploadRes.json());
        mediaIds.push(media.media_id_string);
      }
      body.media = { media_ids: mediaIds };
    }

    const res = await socialFetch("x", `${API}/tweets`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = z
      .object({ data: z.object({ id: z.string() }) })
      .parse(await res.json());

    return {
      externalPostId: data.data.id,
      externalUrl: `https://x.com/i/status/${data.data.id}`,
    };
  },

  async fetchAccountMetrics(tokens): Promise<AccountMetrics> {
    const res = await socialFetch(
      "x",
      `${API}/users/me?user.fields=public_metrics`,
      { headers: { Authorization: `Bearer ${tokens.accessToken}` } }
    );
    const data = z
      .object({
        data: z.object({
          public_metrics: z.object({
            followers_count: z.number(),
            following_count: z.number(),
            tweet_count: z.number(),
          }),
        }),
      })
      .parse(await res.json());
    const m = data.data.public_metrics;
    return {
      followers: m.followers_count,
      following: m.following_count,
      postsCount: m.tweet_count,
      raw: data,
    };
  },

  async fetchPostMetrics(tokens, _account, externalPostId): Promise<PostMetrics> {
    if (xTier() !== "basic") {
      throw new SocialApiError(
        "x",
        "tier_gated",
        "Post metrics require X API Basic tier"
      );
    }
    const res = await socialFetch(
      "x",
      `${API}/tweets/${externalPostId}?tweet.fields=public_metrics`,
      { headers: { Authorization: `Bearer ${tokens.accessToken}` } }
    );
    const data = z
      .object({
        data: z.object({
          public_metrics: z.object({
            like_count: z.number(),
            reply_count: z.number(),
            retweet_count: z.number(),
            impression_count: z.number().optional(),
          }),
        }),
      })
      .parse(await res.json());
    const m = data.data.public_metrics;
    return {
      likes: m.like_count,
      comments: m.reply_count,
      shares: m.retweet_count,
      impressions: m.impression_count,
      raw: data,
    };
  },

  async fetchMentions(tokens, account, since): Promise<FetchedMention[]> {
    if (xTier() !== "basic") return []; // silently skip on free tier
    const res = await socialFetch(
      "x",
      `${API}/users/${account.external_id}/mentions?tweet.fields=created_at,author_id&expansions=author_id&user.fields=username,name,profile_image_url&start_time=${since.toISOString()}`,
      { headers: { Authorization: `Bearer ${tokens.accessToken}` } }
    );
    const data = (await res.json()) as {
      data?: { id: string; text?: string; created_at?: string; author_id?: string }[];
      includes?: { users?: { id: string; username?: string; name?: string; profile_image_url?: string }[] };
    };
    const users = new Map(
      (data.includes?.users ?? []).map((u) => [u.id, u])
    );
    return (data.data ?? []).map((t) => {
      const author = t.author_id ? users.get(t.author_id) : undefined;
      return {
        externalId: t.id,
        kind: "mention" as const,
        authorHandle: author?.username,
        authorName: author?.name,
        authorAvatarUrl: author?.profile_image_url,
        content: t.text,
        externalUrl: `https://x.com/i/status/${t.id}`,
        occurredAt: t.created_at ? new Date(t.created_at) : undefined,
        raw: t,
      };
    });
  },

  async fetchPublicProfile(handle, tokens): Promise<PublicProfileData> {
    if (!tokens) {
      throw new SocialApiError("x", "token_required", "Requires a connected X account");
    }
    const res = await socialFetch(
      "x",
      `${API}/users/by/username/${encodeURIComponent(handle.replace(/^@/, ""))}?user.fields=public_metrics`,
      { headers: { Authorization: `Bearer ${tokens.accessToken}` } }
    );
    const data = z
      .object({
        data: z.object({
          id: z.string(),
          username: z.string(),
          name: z.string(),
          public_metrics: z.object({
            followers_count: z.number(),
            following_count: z.number(),
            tweet_count: z.number(),
          }),
        }),
      })
      .parse(await res.json());
    return {
      externalId: data.data.id,
      handle: data.data.username,
      displayName: data.data.name,
      followers: data.data.public_metrics.followers_count,
      following: data.data.public_metrics.following_count,
      postsCount: data.data.public_metrics.tweet_count,
      raw: data,
    };
  },
};
