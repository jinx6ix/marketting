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

/**
 * TikTok OAuth token response.
 */
const tokenResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
  scope: z.string().optional(),
  open_id: z.string().optional(),
});

/**
 * TikTok user profile response.
 */
const profileResponse = z.object({
  data: z.object({
    user: z.object({
      open_id: z.string(),
      union_id: z.string().optional(),
      avatar_url: z.string().optional(),
      display_name: z.string().optional(),
      username: z.string().optional(),
    }),
  }),
});

/**
 * TikTok account metrics response.
 */
const accountMetricsResponse = z.object({
  data: z.object({
    user: z.object({
      follower_count: z.number().optional(),
      following_count: z.number().optional(),
      likes_count: z.number().optional(),
      video_count: z.number().optional(),
    }),
  }),
});

/**
 * TikTok video metrics response.
 */
const videoMetricsResponse = z.object({
  data: z.object({
    videos: z
      .array(
        z.object({
          id: z.string().optional(),
          like_count: z.number().optional(),
          comment_count: z.number().optional(),
          share_count: z.number().optional(),
          view_count: z.number().optional(),
        })
      )
      .optional(),
  }),
});

/**
 * Whether the TikTok app has passed TikTok's audit/review.
 *
 * Before audit, TikTok restricts publishing behavior.
 */
function isAudited(): boolean {
  return process.env.TIKTOK_AUDITED === "true";
}

/**
 * TikTok OAuth scopes currently configured for this application.
 *
 * IMPORTANT:
 * Do not add user.info.stats or video.list unless those products/scopes
 * have actually been enabled/approved for the TikTok application.
 */
const TIKTOK_SCOPES = [
  "user.info.basic",
  "video.publish",
  "video.upload",
].join(",");

export const tiktokAdapter: SocialProviderAdapter = {
  platform: "tiktok",

  capabilities: {
    publishText: false,

    // TikTok photo posts.
    publishImage: true,

    publishVideo: true,

    nativeScheduling: false,

    // These are available through TikTok APIs, assuming the required
    // products/scopes are approved.
    postMetrics: true,
    accountMetrics: true,

    mentions: false,
    keywordSearch: false,

    competitorData: false,

    maxTextLength: 2200,

    notes: [
      isAudited()
        ? "App is audited — posts can publish publicly."
        : "App not yet audited: posts are restricted to SELF_ONLY. Submit the app for TikTok review before publishing publicly.",

      "Competitor tracking has no official TikTok API — use manual snapshots.",
    ],
  },

  /**
   * Generate TikTok Web Login Kit authorization URL.
   *
   * IMPORTANT:
   * This application is configured as a WEB application.
   *
   * TikTok's Web OAuth flow does not require PKCE.
   *
   * Therefore we intentionally do NOT send:
   * - code_challenge
   * - code_challenge_method
   */
  getAuthUrl(state) {
    const clientKey = process.env.TIKTOK_CLIENT_KEY;

    if (!clientKey) {
      throw new Error("TIKTOK_CLIENT_KEY is missing");
    }

    const callback = redirectUri("tiktok");

    if (!callback) {
      throw new Error("TikTok redirect URI is missing");
    }

    const params = new URLSearchParams({
      client_key: clientKey,
      response_type: "code",
      scope: TIKTOK_SCOPES,
      redirect_uri: callback,
      state,
    });

    return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
  },

  /**
   * Exchange TikTok authorization code for access/refresh tokens.
   *
   * IMPORTANT:
   * This is the Web OAuth flow, so code_verifier is intentionally omitted.
   */
  async exchangeCode(code) {
    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;

    if (!clientKey) {
      throw new Error("TIKTOK_CLIENT_KEY is missing");
    }

    if (!clientSecret) {
      throw new Error("TIKTOK_CLIENT_SECRET is missing");
    }

    const callback = redirectUri("tiktok");

    const res = await socialFetch(
      "tiktok",
      `${API}/oauth/token/`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },

        body: formBody({
          client_key: clientKey,
          client_secret: clientSecret,
          code,
          grant_type: "authorization_code",
          redirect_uri: callback,
        }),
      }
    );

    const raw = await res.json();

    const data = tokenResponse.parse(raw);

    return {
      accessToken: data.access_token,

      refreshToken: data.refresh_token,

      expiresAt: data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : undefined,

      scopes: data.scope
        ? data.scope
            .split(",")
            .map((scope) => scope.trim())
            .filter(Boolean)
        : [],
    };
  },

  /**
   * Refresh an existing TikTok access token.
   */
  async refreshToken(tokens) {
    if (!tokens.refreshToken) {
      throw new SocialApiError(
        "tiktok",
        "no_refresh_token",
        "Missing TikTok refresh token"
      );
    }

    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;

    if (!clientKey) {
      throw new Error("TIKTOK_CLIENT_KEY is missing");
    }

    if (!clientSecret) {
      throw new Error("TIKTOK_CLIENT_SECRET is missing");
    }

    const res = await socialFetch(
      "tiktok",
      `${API}/oauth/token/`,
      {
        method: "POST",

        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },

        body: formBody({
          client_key: clientKey,
          client_secret: clientSecret,
          grant_type: "refresh_token",
          refresh_token: tokens.refreshToken,
        }),
      }
    );

    const raw = await res.json();

    const data = tokenResponse.parse(raw);

    return {
      accessToken: data.access_token,

      refreshToken:
        data.refresh_token ?? tokens.refreshToken,

      expiresAt: data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : undefined,
    };
  },

  /**
   * Fetch the connected TikTok user's basic profile.
   *
   * Requires:
   * user.info.basic
   */
  async fetchProfile(tokens) {
    const res = await socialFetch(
      "tiktok",
      `${API}/user/info/?fields=open_id,union_id,avatar_url,display_name,username`,
      {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      }
    );

    const raw = await res.json();

    const data = profileResponse.parse(raw);

    const user = data.data.user;

    return [
      {
        externalId: user.open_id,

        handle:
          user.username ??
          user.display_name ??
          user.open_id,

        displayName:
          user.display_name,

        avatarUrl:
          user.avatar_url,
      },
    ];
  },

  /**
   * Publish TikTok content.
   *
   * Supports:
   * - Video
   * - Photo posts
   *
   * Before TikTok audit:
   * SELF_ONLY is used.
   *
   * After audit:
   * PUBLIC_TO_EVERYONE is used.
   */
  async publish(
    tokens,
    _account,
    post: PublishPayload
  ): Promise<PublishResult> {
    if (!post.mediaUrls || post.mediaUrls.length === 0) {
      throw new SocialApiError(
        "tiktok",
        "media_required",
        "TikTok requires a video or photos"
      );
    }

    const privacy = isAudited()
      ? "PUBLIC_TO_EVERYONE"
      : "SELF_ONLY";

    /**
     * VIDEO POST
     */
    if (post.mediaType === "video") {
      const videoUrl = post.mediaUrls[0];

      if (!videoUrl) {
        throw new SocialApiError(
          "tiktok",
          "media_required",
          "TikTok video URL is missing"
        );
      }

      const res = await socialFetch(
        "tiktok",
        `${API}/post/publish/video/init/`,
        {
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

              video_url: videoUrl,
            },
          }),
        }
      );

      const raw = await res.json();

      const data = z
        .object({
          data: z.object({
            publish_id: z.string(),
          }),
        })
        .parse(raw);

      return {
        externalPostId: data.data.publish_id,
      };
    }

    /**
     * PHOTO POST
     */
    const photoUrls = post.mediaUrls
      .filter(Boolean)
      .slice(0, 35);

    if (photoUrls.length === 0) {
      throw new SocialApiError(
        "tiktok",
        "media_required",
        "TikTok photo URLs are missing"
      );
    }

    const res = await socialFetch(
      "tiktok",
      `${API}/post/publish/content/init/`,
      {
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

            photo_images: photoUrls,

            photo_cover_index: 0,
          },

          post_mode: "DIRECT_POST",

          media_type: "PHOTO",
        }),
      }
    );

    const raw = await res.json();

    const data = z
      .object({
        data: z.object({
          publish_id: z.string(),
        }),
      })
      .parse(raw);

    return {
      externalPostId: data.data.publish_id,
    };
  },

  /**
   * Fetch TikTok account metrics.
   *
   * NOTE:
   * This requires the appropriate TikTok user-info fields/scopes.
   *
   * If the connected token does not have access to these fields,
   * TikTok will return scope_not_authorized.
   */
  async fetchAccountMetrics(
    tokens
  ): Promise<AccountMetrics> {
    const res = await socialFetch(
      "tiktok",
      `${API}/user/info/?fields=follower_count,following_count,likes_count,video_count`,
      {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
        },
      }
    );

    const raw = await res.json();

    const data = accountMetricsResponse.parse(raw);

    const user = data.data.user;

    return {
      followers: user.follower_count,

      following: user.following_count,

      postsCount: user.video_count,

      engagementTotal: user.likes_count,

      raw: data,
    };
  },

  /**
   * Fetch metrics for a TikTok video.
   *
   * Uses the Video Query API.
   */
  async fetchPostMetrics(
    tokens,
    _account,
    externalPostId
  ): Promise<PostMetrics> {
    if (!externalPostId) {
      throw new SocialApiError(
        "tiktok",
        "post_id_required",
        "TikTok video ID is required"
      );
    }

    const res = await socialFetch(
      "tiktok",
      `${API}/video/query/?fields=id,like_count,comment_count,share_count,view_count`,
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          filters: {
            video_ids: [externalPostId],
          },
        }),
      }
    );

    const raw = await res.json();

    const data = videoMetricsResponse.parse(raw);

    const video = data.data.videos?.[0];

    return {
      likes: video?.like_count,

      comments: video?.comment_count,

      shares: video?.share_count,

      videoViews: video?.view_count,

      raw: data,
    };
  },
};