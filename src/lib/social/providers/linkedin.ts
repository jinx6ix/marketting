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

const API = "https://api.linkedin.com/v2";
const REST = "https://api.linkedin.com/rest";

const tokenResponse = z.object({
  access_token: z.string(),
  expires_in: z.number().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
});

/**
 * LinkedIn adapter — member posting via w_member_social (self-serve).
 * Organization pages + analytics require Community Management API
 * partner approval; account metrics are limited until then.
 */
export const linkedinAdapter: SocialProviderAdapter = {
  platform: "linkedin",
  capabilities: {
    publishText: true,
    publishImage: true,
    publishVideo: true,
    nativeScheduling: false,
    postMetrics: false, // needs Community Management approval
    accountMetrics: false,
    mentions: false,
    keywordSearch: false,
    competitorData: false,
    maxTextLength: 3000,
    notes: [
      "Member posting works day one; organization pages & analytics need LinkedIn partner approval.",
      "Tokens last ~60 days and cannot be silently refreshed — reconnect when prompted.",
    ],
  },

  getAuthUrl(state) {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: process.env.LINKEDIN_CLIENT_ID!,
      redirect_uri: redirectUri("linkedin"),
      state,
      scope: "openid profile w_member_social",
    });
    return `https://www.linkedin.com/oauth/v2/authorization?${params}`;
  },

  async exchangeCode(code) {
    const res = await socialFetch(
      "linkedin",
      "https://www.linkedin.com/oauth/v2/accessToken",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody({
          grant_type: "authorization_code",
          code,
          client_id: process.env.LINKEDIN_CLIENT_ID!,
          client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
          redirect_uri: redirectUri("linkedin"),
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
    // Programmatic refresh requires Marketing Developer Platform approval.
    // Standard apps: token simply expires (~60d) → surface reconnect banner.
    if (!tokens.refreshToken) {
      throw new SocialApiError(
        "linkedin",
        "reconnect_required",
        "LinkedIn tokens cannot be refreshed without partner approval — reconnect the account"
      );
    }
    const res = await socialFetch(
      "linkedin",
      "https://www.linkedin.com/oauth/v2/accessToken",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody({
          grant_type: "refresh_token",
          refresh_token: tokens.refreshToken,
          client_id: process.env.LINKEDIN_CLIENT_ID!,
          client_secret: process.env.LINKEDIN_CLIENT_SECRET!,
        }),
      }
    );
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
    const res = await socialFetch("linkedin", `${API}/userinfo`, {
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
    const data = z
      .object({
        sub: z.string(),
        name: z.string().optional(),
        picture: z.string().optional(),
      })
      .parse(await res.json());
    return [
      {
        externalId: data.sub,
        handle: data.name ?? data.sub,
        displayName: data.name,
        avatarUrl: data.picture,
        metadata: { author_urn: `urn:li:person:${data.sub}` },
      },
    ];
  },

  async publish(tokens, account, post: PublishPayload): Promise<PublishResult> {
    const meta = (account.metadata ?? {}) as { author_urn?: string };
    const author = meta.author_urn ?? `urn:li:person:${account.external_id}`;

    let content: Record<string, unknown> | undefined;

    if (post.mediaType === "image" && post.mediaUrls.length > 0) {
      // initialize image upload
      const initRes = await socialFetch(
        "linkedin",
        `${REST}/images?action=initializeUpload`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tokens.accessToken}`,
            "Content-Type": "application/json",
            "LinkedIn-Version": "202405",
            "X-Restli-Protocol-Version": "2.0.0",
          },
          body: JSON.stringify({ initializeUploadRequest: { owner: author } }),
        }
      );
      const init = z
        .object({
          value: z.object({
            uploadUrl: z.string(),
            image: z.string(),
          }),
        })
        .parse(await initRes.json());

      const imgRes = await fetch(post.mediaUrls[0]);
      if (!imgRes.ok) {
        throw new SocialApiError("linkedin", "media_fetch", "Cannot fetch media");
      }
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const putRes = await fetch(init.value.uploadUrl, {
        method: "PUT",
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
        body: new Uint8Array(buf),
      });
      if (!putRes.ok) {
        throw new SocialApiError("linkedin", "media_upload", "Image upload failed");
      }
      content = { media: { id: init.value.image } };
    }

    const postRes = await socialFetch("linkedin", `${REST}/posts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        "Content-Type": "application/json",
        "LinkedIn-Version": "202405",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify({
        author,
        commentary: post.text.slice(0, 3000),
        visibility: "PUBLIC",
        distribution: {
          feedDistribution: "MAIN_FEED",
          targetEntities: [],
          thirdPartyDistributionChannels: [],
        },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
        ...(content ? { content } : {}),
      }),
    });

    const postId =
      postRes.headers.get("x-restli-id") ??
      postRes.headers.get("x-linkedin-id") ??
      "";
    if (!postId) {
      throw new SocialApiError("linkedin", "no_post_id", "LinkedIn did not return a post id");
    }
    return {
      externalPostId: postId,
      externalUrl: `https://www.linkedin.com/feed/update/${postId}`,
    };
  },

  async fetchAccountMetrics(): Promise<AccountMetrics> {
    // Follower stats need Community Management approval — return empty.
    return { raw: { note: "linkedin account metrics require partner approval" } };
  },

  async fetchPostMetrics(): Promise<PostMetrics> {
    throw new SocialApiError(
      "linkedin",
      "not_available",
      "LinkedIn post metrics require Community Management API approval"
    );
  },
};
