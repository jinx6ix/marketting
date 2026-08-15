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
import { redirectUri, formBody, basicAuthHeader } from "../oauth";

const API = "https://api.pinterest.com/v5";

const tokenResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
  scope: z.string().optional(),
});

/**
 * Pinterest adapter (API v5). Trial access is instant but rate-limited;
 * Standard access requires review with a working demo.
 * Pins require an image or video and a board.
 */
export const pinterestAdapter: SocialProviderAdapter = {
  platform: "pinterest",
  capabilities: {
    publishText: false,
    publishImage: true,
    publishVideo: true,
    nativeScheduling: false,
    postMetrics: true,
    accountMetrics: true,
    mentions: false,
    keywordSearch: false,
    competitorData: false,
    maxTextLength: 500,
    notes: [
      "Pins require an image/video and a target board (first board is used by default).",
      "Trial access is rate-limited; Standard access needs Pinterest review.",
    ],
  },

  getAuthUrl(state) {
    const params = new URLSearchParams({
      client_id: process.env.PINTEREST_APP_ID!,
      redirect_uri: redirectUri("pinterest"),
      response_type: "code",
      scope: "boards:read,boards:write,pins:read,pins:write,user_accounts:read",
      state,
    });
    return `https://www.pinterest.com/oauth/?${params}`;
  },

  async exchangeCode(code) {
    const res = await socialFetch("pinterest", `${API}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: basicAuthHeader(
          process.env.PINTEREST_APP_ID!,
          process.env.PINTEREST_APP_SECRET!
        ),
      },
      body: formBody({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri("pinterest"),
      }),
    });
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
      throw new SocialApiError("pinterest", "no_refresh_token", "Missing refresh token");
    }
    const res = await socialFetch("pinterest", `${API}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: basicAuthHeader(
          process.env.PINTEREST_APP_ID!,
          process.env.PINTEREST_APP_SECRET!
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
    const res = await socialFetch("pinterest", `${API}/user_account`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    const data = z
      .object({
        username: z.string(),
        id: z.string().optional(),
        profile_image: z.string().optional(),
        account_type: z.string().optional(),
      })
      .parse(await res.json());
    return [
      {
        externalId: data.id ?? data.username,
        handle: data.username,
        displayName: data.username,
        avatarUrl: data.profile_image,
        metadata: { account_type: data.account_type },
      },
    ];
  },

  async publish(tokens, account, post: PublishPayload): Promise<PublishResult> {
    if (post.mediaUrls.length === 0) {
      throw new SocialApiError(
        "pinterest",
        "media_required",
        "Pinterest pins require an image or video"
      );
    }

    // Resolve target board: metadata.default_board_id, else first board.
    const meta = (account.metadata ?? {}) as { default_board_id?: string };
    let boardId = meta.default_board_id;
    if (!boardId) {
      const boardsRes = await socialFetch("pinterest", `${API}/boards?page_size=1`, {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      });
      const boards = z
        .object({ items: z.array(z.object({ id: z.string() })).default([]) })
        .parse(await boardsRes.json());
      boardId = boards.items[0]?.id;
      if (!boardId) {
        throw new SocialApiError(
          "pinterest",
          "no_board",
          "No Pinterest board found — create a board first"
        );
      }
    }

    const [fallbackTitle] = post.text.split("\n");
    const res = await socialFetch("pinterest", `${API}/pins`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        board_id: boardId,
        title: (post.title || fallbackTitle || "Pin").slice(0, 100),
        description: post.text.slice(0, 500),
        ...(post.link ? { link: post.link } : {}),
        media_source:
          post.mediaType === "video"
            ? { source_type: "video_url", url: post.mediaUrls[0] }
            : { source_type: "image_url", url: post.mediaUrls[0] },
      }),
    });
    const pin = z.object({ id: z.string() }).parse(await res.json());
    return {
      externalPostId: pin.id,
      externalUrl: `https://www.pinterest.com/pin/${pin.id}/`,
    };
  },

  async fetchAccountMetrics(tokens): Promise<AccountMetrics> {
    const res = await socialFetch("pinterest", `${API}/user_account`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    const data = z
      .object({
        follower_count: z.number().optional(),
        following_count: z.number().optional(),
        pin_count: z.number().optional(),
        monthly_views: z.number().optional(),
      })
      .parse(await res.json());
    return {
      followers: data.follower_count,
      following: data.following_count,
      postsCount: data.pin_count,
      impressions: data.monthly_views,
      raw: data,
    };
  },

  async fetchPostMetrics(tokens, _account, externalPostId): Promise<PostMetrics> {
    const res = await socialFetch(
      "pinterest",
      `${API}/pins/${externalPostId}/analytics?metric_types=IMPRESSION,SAVE,PIN_CLICK&start_date=${thirtyDaysAgo()}&end_date=${today()}`,
      { headers: { Authorization: `Bearer ${tokens.accessToken}` } }
    );
    const data = (await res.json()) as {
      all?: {
        lifetime_metrics?: {
          IMPRESSION?: number;
          SAVE?: number;
          PIN_CLICK?: number;
        };
      };
    };
    const m = data.all?.lifetime_metrics;
    return {
      impressions: m?.IMPRESSION,
      saves: m?.SAVE,
      likes: m?.PIN_CLICK,
      raw: data,
    };
  },
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function thirtyDaysAgo(): string {
  return new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
}