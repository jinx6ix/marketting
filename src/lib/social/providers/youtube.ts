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
  PublicPost,
  SocialApiError,
  socialFetch,
} from "../types";
import { redirectUri, formBody } from "../oauth";

const API = "https://www.googleapis.com/youtube/v3";
const UPLOAD = "https://www.googleapis.com/upload/youtube/v3";

const tokenResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
  scope: z.string().optional(),
});

/**
 * YouTube adapter (Google OAuth + Data API v3).
 * Publishing = video upload only (1600 quota units of the 10k/day default).
 * Competitor data is fully public via API key (no OAuth needed).
 */
export const youtubeAdapter: SocialProviderAdapter = {
  platform: "youtube",
  capabilities: {
    publishText: false,
    publishImage: false,
    publishVideo: true,
    nativeScheduling: true, // upload private with publishAt
    postMetrics: true,
    accountMetrics: true,
    mentions: true, // comments on own videos
    keywordSearch: true, // search.list (100 units/call)
    competitorData: true, // fully public
    maxTextLength: 5000,
    notes: [
      "Publishing is video-only (uploads cost 1600 of 10,000 daily quota units).",
      "OAuth consent screen must be verified for external users.",
    ],
  },

  getAuthUrl(state) {
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      redirect_uri: redirectUri("youtube"),
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      state,
      scope: [
        "https://www.googleapis.com/auth/youtube.upload",
        "https://www.googleapis.com/auth/youtube.readonly",
        "https://www.googleapis.com/auth/youtube.force-ssl",
      ].join(" "),
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  },

  async exchangeCode(code) {
    const res = await socialFetch("youtube", "https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: redirectUri("youtube"),
        grant_type: "authorization_code",
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
      throw new SocialApiError("youtube", "no_refresh_token", "Missing refresh token");
    }
    const res = await socialFetch("youtube", "https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formBody({
        refresh_token: tokens.refreshToken,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        grant_type: "refresh_token",
      }),
    });
    const data = tokenResponse.parse(await res.json());
    return {
      accessToken: data.access_token,
      refreshToken: tokens.refreshToken,
      expiresAt: data.expires_in
        ? new Date(Date.now() + data.expires_in * 1000)
        : undefined,
    };
  },

  async fetchProfile(tokens) {
    const res = await socialFetch(
      "youtube",
      `${API}/channels?part=snippet,statistics&mine=true`,
      { headers: { Authorization: `Bearer ${tokens.accessToken}` } }
    );
    const data = z
      .object({
        items: z
          .array(
            z.object({
              id: z.string(),
              snippet: z.object({
                title: z.string(),
                customUrl: z.string().optional(),
                thumbnails: z
                  .object({
                    default: z.object({ url: z.string() }).optional(),
                  })
                  .optional(),
              }),
            })
          )
          .default([]),
      })
      .parse(await res.json());

    if (data.items.length === 0) {
      throw new SocialApiError(
        "youtube",
        "no_channel",
        "No YouTube channel found for this Google account"
      );
    }
    return data.items.map((c) => ({
      externalId: c.id,
      handle: c.snippet.customUrl ?? c.snippet.title,
      displayName: c.snippet.title,
      avatarUrl: c.snippet.thumbnails?.default?.url,
    }));
  },

  async publish(tokens, _account, post: PublishPayload): Promise<PublishResult> {
    if (post.mediaType !== "video" || post.mediaUrls.length === 0) {
      throw new SocialApiError(
        "youtube",
        "video_required",
        "YouTube publishing requires a video"
      );
    }
    // Fetch the video from Storage, then resumable-upload it.
    const videoRes = await fetch(post.mediaUrls[0]);
    if (!videoRes.ok) {
      throw new SocialApiError("youtube", "media_fetch", "Cannot fetch video from storage");
    }
    const videoBuf = Buffer.from(await videoRes.arrayBuffer());

    const [title, ...rest] = post.text.split("\n");
    const metadata = {
      snippet: {
        title: (title || "Untitled").slice(0, 100),
        description: rest.join("\n").slice(0, 5000) || post.text.slice(0, 5000),
        categoryId: "19", // Travel & Events
      },
      status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
    };

    // start resumable session
    const initRes = await socialFetch(
      "youtube",
      `${UPLOAD}/videos?uploadType=resumable&part=snippet,status`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          "Content-Type": "application/json",
          "X-Upload-Content-Type": "video/*",
          "X-Upload-Content-Length": String(videoBuf.length),
        },
        body: JSON.stringify(metadata),
      }
    );
    const uploadUrl = initRes.headers.get("location");
    if (!uploadUrl) {
      throw new SocialApiError("youtube", "upload_init", "No resumable upload URL returned");
    }

    const uploadRes = await socialFetch("youtube", uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "video/*",
        "Content-Length": String(videoBuf.length),
      },
      body: new Uint8Array(videoBuf),
    });
    const video = z.object({ id: z.string() }).parse(await uploadRes.json());

    return {
      externalPostId: video.id,
      externalUrl: `https://www.youtube.com/watch?v=${video.id}`,
    };
  },

  async fetchAccountMetrics(tokens, account): Promise<AccountMetrics> {
    const res = await socialFetch(
      "youtube",
      `${API}/channels?part=statistics&id=${account.external_id}`,
      { headers: { Authorization: `Bearer ${tokens.accessToken}` } }
    );
    const data = z
      .object({
        items: z
          .array(
            z.object({
              statistics: z.object({
                subscriberCount: z.string().optional(),
                videoCount: z.string().optional(),
                viewCount: z.string().optional(),
              }),
            })
          )
          .default([]),
      })
      .parse(await res.json());
    const s = data.items[0]?.statistics;
    return {
      followers: s?.subscriberCount ? Number(s.subscriberCount) : undefined,
      postsCount: s?.videoCount ? Number(s.videoCount) : undefined,
      impressions: s?.viewCount ? Number(s.viewCount) : undefined,
      raw: data,
    };
  },

  async fetchPostMetrics(tokens, _account, externalPostId): Promise<PostMetrics> {
    const res = await socialFetch(
      "youtube",
      `${API}/videos?part=statistics&id=${externalPostId}`,
      { headers: { Authorization: `Bearer ${tokens.accessToken}` } }
    );
    const data = z
      .object({
        items: z
          .array(
            z.object({
              statistics: z.object({
                viewCount: z.string().optional(),
                likeCount: z.string().optional(),
                commentCount: z.string().optional(),
              }),
            })
          )
          .default([]),
      })
      .parse(await res.json());
    const s = data.items[0]?.statistics;
    return {
      videoViews: s?.viewCount ? Number(s.viewCount) : undefined,
      likes: s?.likeCount ? Number(s.likeCount) : undefined,
      comments: s?.commentCount ? Number(s.commentCount) : undefined,
      raw: data,
    };
  },

  async fetchMentions(tokens, account, since): Promise<FetchedMention[]> {
    const res = await socialFetch(
      "youtube",
      `${API}/commentThreads?part=snippet&allThreadsRelatedToChannelId=${account.external_id}&maxResults=50&order=time`,
      { headers: { Authorization: `Bearer ${tokens.accessToken}` } }
    );
    const data = (await res.json()) as {
      items?: {
        id: string;
        snippet?: {
          videoId?: string;
          topLevelComment?: {
            snippet?: {
              textDisplay?: string;
              authorDisplayName?: string;
              authorProfileImageUrl?: string;
              publishedAt?: string;
            };
          };
        };
      }[];
    };
    return (data.items ?? [])
      .map((t) => {
        const c = t.snippet?.topLevelComment?.snippet;
        const at = c?.publishedAt ? new Date(c.publishedAt) : undefined;
        return {
          externalId: t.id,
          kind: "comment" as const,
          authorName: c?.authorDisplayName,
          authorAvatarUrl: c?.authorProfileImageUrl,
          content: c?.textDisplay,
          externalUrl: t.snippet?.videoId
            ? `https://www.youtube.com/watch?v=${t.snippet.videoId}&lc=${t.id}`
            : undefined,
          occurredAt: at,
          raw: t,
        };
      })
      .filter((m) => !m.occurredAt || m.occurredAt >= since);
  },

  // Public data via API key — no OAuth needed for competitors.
  async fetchPublicProfile(handleOrId): Promise<PublicProfileData> {
    const key = process.env.YOUTUBE_API_KEY;
    if (!key) {
      throw new SocialApiError("youtube", "api_key_required", "YOUTUBE_API_KEY not set");
    }
    const isChannelId = /^UC[\w-]{22}$/.test(handleOrId);
    const param = isChannelId
      ? `id=${handleOrId}`
      : `forHandle=${encodeURIComponent(handleOrId.replace(/^@/, ""))}`;
    const res = await socialFetch(
      "youtube",
      `${API}/channels?part=snippet,statistics&${param}&key=${key}`
    );
    const data = z
      .object({
        items: z
          .array(
            z.object({
              id: z.string(),
              snippet: z.object({
                title: z.string(),
                customUrl: z.string().optional(),
              }),
              statistics: z.object({
                subscriberCount: z.string().optional(),
                videoCount: z.string().optional(),
              }),
            })
          )
          .default([]),
      })
      .parse(await res.json());
    const c = data.items[0];
    if (!c) {
      throw new SocialApiError("youtube", "not_found", `Channel not found: ${handleOrId}`);
    }
    return {
      externalId: c.id,
      handle: c.snippet.customUrl ?? c.snippet.title,
      displayName: c.snippet.title,
      followers: c.statistics.subscriberCount
        ? Number(c.statistics.subscriberCount)
        : undefined,
      postsCount: c.statistics.videoCount
        ? Number(c.statistics.videoCount)
        : undefined,
      raw: c,
    };
  },

  async fetchPublicPosts(handleOrId, limit): Promise<PublicPost[]> {
    const key = process.env.YOUTUBE_API_KEY;
    if (!key) {
      throw new SocialApiError("youtube", "api_key_required", "YOUTUBE_API_KEY not set");
    }
    const profile = await this.fetchPublicProfile!(handleOrId);
    const searchRes = await socialFetch(
      "youtube",
      `${API}/search?part=id&channelId=${profile.externalId}&order=date&type=video&maxResults=${Math.min(limit, 25)}&key=${key}`
    );
    const search = (await searchRes.json()) as {
      items?: { id?: { videoId?: string } }[];
    };
    const ids = (search.items ?? [])
      .map((i) => i.id?.videoId)
      .filter((v): v is string => !!v);
    if (ids.length === 0) return [];

    const videosRes = await socialFetch(
      "youtube",
      `${API}/videos?part=snippet,statistics,contentDetails&id=${ids.join(",")}&key=${key}`
    );
    const videos = (await videosRes.json()) as {
      items?: {
        id: string;
        snippet?: { title?: string; description?: string; publishedAt?: string; tags?: string[] };
        statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
        contentDetails?: { duration?: string };
      }[];
    };
    return (videos.items ?? []).map((v) => {
      const isShort = parseDurationSeconds(v.contentDetails?.duration) <= 65;
      return {
        externalId: v.id,
        postedAt: v.snippet?.publishedAt ? new Date(v.snippet.publishedAt) : undefined,
        content: [v.snippet?.title, v.snippet?.description].filter(Boolean).join("\n"),
        mediaType: isShort ? ("short" as const) : ("video" as const),
        likes: v.statistics?.likeCount ? Number(v.statistics.likeCount) : undefined,
        comments: v.statistics?.commentCount ? Number(v.statistics.commentCount) : undefined,
        views: v.statistics?.viewCount ? Number(v.statistics.viewCount) : undefined,
        hashtags: v.snippet?.tags?.map((t) => t.toLowerCase()) ?? [],
        raw: v,
      };
    });
  },
};

function parseDurationSeconds(iso?: string): number {
  if (!iso) return 0;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}
