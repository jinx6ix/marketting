import "server-only";
import { z } from "zod";
import {
  SocialProviderAdapter,
  PublishPayload,
  PublishResult,
  AccountMetrics,
  PostMetrics,
  SocialApiError,
  socialFetch,
} from "../types";
import { redirectUri, formBody } from "../oauth";

const API = "https://open.tiktokapis.com/v2";

const tokenResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
  scope: z.string().optional(),
  open_id: z.string().optional(),
});

function isAudited(): boolean {
  return process.env.TIKTOK_AUDITED === "true";
}

/**
 * TikTok adapter (Login Kit + Content Posting API + Display API).
 * Unaudited apps can only post as SELF_ONLY (private) — we surface this
 * in Settings and flip to PUBLIC_TO_EVERYONE once TIKTOK_AUDITED=true.
 */
export const tiktokAdapter: SocialProviderAdapter = {
  platform: "tiktok",
  capabilities: {
    publishText: false,
    publishImage: true, // photo posts
    publishVideo: true,
    nativeScheduling: false,
    postMetrics: true, // own videos via Display API
    accountMetrics: true,
    mentions: false,
    keywordSearch: false,
    competitorData: false, // no official public API → manual entry
    maxTextLength: 2200,
    notes: [
      isAudited()
        ? "App is audited — posts publish publicly."
        : "App not yet audited: posts are private (self-view only). Submit for TikTok audit to publish publicly.",
      "Competitor tracking has no official API — use manual snapshots.",
    ],
  },

  getAuthUrl(state, codeChallenge) {
    const clientKey = process.env.TIKTOK_CLIENT_KEY;
  
    if (!clientKey) {
      throw new Error("TIKTOK_CLIENT_KEY is missing");
    }
  
    const params = new URLSearchParams({
      client_key: clientKey,
      response_type: "code",
      scope: "user.info.basic",
      redirect_uri: redirectUri("tiktok"),
      state,
      code_challenge: codeChallenge!,
      code_challenge_method: "S256",
    });
  
    return `https://www.tiktok.com/v2/auth/authorize?${params.toString()}`;
  },
  async exchangeCode(code, codeVerifier) {
    const res = await socialFetch(
      "tiktok",
      `${API}/oauth/token/`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formBody({
          client_key: process.env.TIKTOK_CLIENT_KEY!,
          client_secret: process.env.TIKTOK_CLIENT_SECRET!,
          code,
          grant_type: "authorization_code",
          redirect_uri: redirectUri("tiktok"),
          code_verifier: codeVerifier!,
        }),
      }
    );
  
    const data = tokenResponse.parse(await res.json());
  
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : undefined,
      scopes: data.scope?.split(","),
    };
  },

  async refreshToken(tokens) {
    if (!tokens.refreshToken) {
      throw new SocialApiError("tiktok", "no_refresh_token", "Missing refresh token");
    }
    const res = await socialFetch("tiktok", `${API}/oauth/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({
        client_key: process.env.TIKTOK_CLIENT_KEY!,
        client_secret: process.env.TIKTOK_CLIENT_SECRET!,
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
    const res = await socialFetch(
      "tiktok",
      `${API}/user/info/?fields=open_id,union_id,avatar_url,display_name,username`,
      { headers: { Authorization: `Bearer ${tokens.accessToken}` } }
    );
    const data = z
      .object({
        data: z.object({
          user: z.object({
            open_id: z.string(),
            username: z.string().optional(),
            display_name: z.string().optional(),
            avatar_url: z.string().optional(),
          }),
        }),
      })
      .parse(await res.json());
    const u = data.data.user;
    return [
      {
        externalId: u.open_id,
        handle: u.username ?? u.display_name,
        displayName: u.display_name,
        avatarUrl: u.avatar_url,
      },
    ];
  },

  async publish(tokens, _account, post: PublishPayload): Promise<PublishResult> {
    if (post.mediaUrls.length === 0) {
      throw new SocialApiError(
        "tiktok",
        "media_required",
        "TikTok requires a video or photos"
      );
    }
    const privacy = isAudited() ? "PUBLIC_TO_EVERYONE" : "SELF_ONLY";

    if (post.mediaType === "video") {
      const res = await socialFetch("tiktok", `${API}/post/publish/video/init/`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          post_info: {
            title: post.text.slice(0, 2200),
            privacy_level: privacy,
            disable_comment: false,
            disable_duet: false,
            disable_stitch: false,
          },
          source_info: {
            source: "PULL_FROM_URL",
            video_url: post.mediaUrls[0],
          },
        }),
      });
      const data = z
        .object({ data: z.object({ publish_id: z.string() }) })
        .parse(await res.json());
      return { externalPostId: data.data.publish_id };
    }

    // photo post
    const res = await socialFetch("tiktok", `${API}/post/publish/content/init/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        post_info: {
          title: post.text.slice(0, 90),
          description: post.text.slice(0, 2200),
          privacy_level: privacy,
        },
        source_info: {
          source: "PULL_FROM_URL",
          photo_images: post.mediaUrls.slice(0, 35),
          photo_cover_index: 0,
        },
        post_mode: "DIRECT_POST",
        media_type: "PHOTO",
      }),
    });
    const data = z
      .object({ data: z.object({ publish_id: z.string() }) })
      .parse(await res.json());
    return { externalPostId: data.data.publish_id };
  },

  async fetchAccountMetrics(tokens): Promise<AccountMetrics> {
    const res = await socialFetch(
      "tiktok",
      `${API}/user/info/?fields=follower_count,following_count,likes_count,video_count`,
      { headers: { Authorization: `Bearer ${tokens.accessToken}` } }
    );
    const data = z
      .object({
        data: z.object({
          user: z.object({
            follower_count: z.number().optional(),
            following_count: z.number().optional(),
            likes_count: z.number().optional(),
            video_count: z.number().optional(),
          }),
        }),
      })
      .parse(await res.json());
    const u = data.data.user;
    return {
      followers: u.follower_count,
      following: u.following_count,
      postsCount: u.video_count,
      engagementTotal: u.likes_count,
      raw: data,
    };
  },

  async fetchPostMetrics(tokens, _account, externalPostId): Promise<PostMetrics> {
    const res = await socialFetch("tiktok", `${API}/video/query/?fields=id,like_count,comment_count,share_count,view_count`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ filters: { video_ids: [externalPostId] } }),
    });
    const data = (await res.json()) as {
      data?: {
        videos?: {
          like_count?: number;
          comment_count?: number;
          share_count?: number;
          view_count?: number;
        }[];
      };
    };
    const v = data.data?.videos?.[0];
    return {
      likes: v?.like_count,
      comments: v?.comment_count,
      shares: v?.share_count,
      videoViews: v?.view_count,
      raw: data,
    };
  },
};
