import "server-only";
import { createHash } from "crypto";
import {
  SocialProviderAdapter,
  PublishPayload,
  PublishResult,
  AccountMetrics,
  PostMetrics,
  FetchedMention,
  PublicProfileData,
  PublicPost,
  Platform,
} from "../types";
import { appUrl } from "../oauth";

/**
 * Mock adapter — full interface with deterministic fake data + simulated
 * latency. Enabled via SOCIAL_MOCK=1. Lets the composer, publishing
 * pipeline, monitoring jobs, and dashboards run end-to-end before real
 * platform credentials/app reviews are in place.
 */

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Deterministic pseudo-random from a seed string (stable across runs). */
function seeded(seed: string, min: number, max: number): number {
  const h = createHash("sha256").update(seed).digest();
  const n = h.readUInt32BE(0) / 0xffffffff;
  return Math.floor(min + n * (max - min));
}

const TRAVEL_COMMENTS = [
  "This place is on my bucket list! 😍",
  "How much for a family of 4?",
  "We booked with you last year — amazing experience!",
  "Is this tour available in December?",
  "The sunset views here are unreal",
  "Do you offer airport pickup?",
  "Tagging my travel buddy — we NEED this",
  "What's included in the package?",
];

const AUTHORS = ["wanderlust_jane", "nomad.mike", "travelbug_amy", "globetrotter_sam", "islandhopper_dee"];

export function createMockAdapter(platform: Platform): SocialProviderAdapter {
  return {
    platform,
    capabilities: {
      publishText: true,
      publishImage: true,
      publishVideo: true,
      nativeScheduling: false,
      postMetrics: true,
      accountMetrics: true,
      mentions: true,
      keywordSearch: true,
      competitorData: true,
      maxTextLength: 2200,
      notes: ["MOCK MODE — no real API calls are made."],
    },

    getAuthUrl(state) {
      // Loop straight back to our callback with a fake code.
      return appUrl(
        `/api/social/${platform}/callback?code=mock_code&state=${state}`
      );
    },

    async exchangeCode() {
      await delay(200);
      return {
        accessToken: `mock_access_${platform}`,
        refreshToken: `mock_refresh_${platform}`,
        expiresAt: new Date(Date.now() + 60 * 86400_000),
      };
    },

    async refreshToken(tokens) {
      await delay(100);
      return { ...tokens, expiresAt: new Date(Date.now() + 60 * 86400_000) };
    },

    async fetchProfile() {
      await delay(200);
      return [
        {
          externalId: `mock_${platform}_account`,
          handle: `wandertours_${platform}`,
          displayName: `Wander Tours (${platform})`,
          avatarUrl: undefined,
        },
      ];
    },

    async publish(_t, _a, post: PublishPayload): Promise<PublishResult> {
      await delay(500);
      const id = `mock_post_${Date.now()}_${seeded(post.text, 100, 999)}`;
      return { externalPostId: id, externalUrl: `https://example.com/${platform}/${id}` };
    },

    async fetchAccountMetrics(_t, account): Promise<AccountMetrics> {
      await delay(150);
      // Followers drift upward over time — deterministic per day+account.
      const day = Math.floor(Date.now() / 86400_000);
      const base = seeded(`${account.id}-base`, 2000, 20000);
      const growth = (day % 1000) * seeded(`${account.id}-rate`, 2, 15);
      return {
        followers: base + growth,
        following: seeded(`${account.id}-following`, 100, 900),
        postsCount: 50 + (day % 200),
        impressions: seeded(`${account.id}-${day}-imp`, 5000, 60000),
        reach: seeded(`${account.id}-${day}-reach`, 3000, 40000),
        engagementTotal: seeded(`${account.id}-${day}-eng`, 200, 4000),
      };
    },

    async fetchPostMetrics(_t, _a, externalPostId): Promise<PostMetrics> {
      await delay(150);
      const ageHours = 1 + ((Date.now() / 3600_000) % 72);
      const viral = seeded(externalPostId, 1, 10);
      return {
        likes: Math.floor(seeded(externalPostId + "l", 10, 500) * viral * (ageHours / 24)),
        comments: Math.floor(seeded(externalPostId + "c", 2, 60) * (ageHours / 24)),
        shares: Math.floor(seeded(externalPostId + "s", 1, 40) * (ageHours / 24)),
        saves: Math.floor(seeded(externalPostId + "sv", 1, 30) * (ageHours / 24)),
        impressions: Math.floor(seeded(externalPostId + "i", 500, 20000) * viral),
        engagementRate: seeded(externalPostId + "er", 15, 95) / 10,
        videoViews: seeded(externalPostId + "v", 100, 50000),
      };
    },

    async fetchMentions(_t, account, since): Promise<FetchedMention[]> {
      await delay(200);
      const hour = Math.floor(Date.now() / 3600_000);
      // 0–2 new mentions per hour, deterministic
      const count = seeded(`${account.id}-${hour}-mcount`, 0, 3);
      return Array.from({ length: count }, (_, i) => {
        const at = new Date(Date.now() - seeded(`${hour}-${i}-ago`, 1, 50) * 60_000);
        if (at < since) return null;
        return {
          externalId: `mock_mention_${hour}_${i}_${account.id.slice(0, 6)}`,
          kind: (i % 3 === 0 ? "mention" : "comment") as "mention" | "comment",
          authorHandle: AUTHORS[seeded(`${hour}-${i}-a`, 0, AUTHORS.length)],
          content: TRAVEL_COMMENTS[seeded(`${hour}-${i}-c`, 0, TRAVEL_COMMENTS.length)],
          externalUrl: `https://example.com/${platform}/mention`,
          occurredAt: at,
        };
      }).filter((m): m is NonNullable<typeof m> => m !== null);
    },

    async fetchPublicProfile(handle): Promise<PublicProfileData> {
      await delay(200);
      const day = Math.floor(Date.now() / 86400_000);
      const base = seeded(`${handle}-base`, 5000, 80000);
      return {
        externalId: `mock_comp_${handle}`,
        handle,
        displayName: handle,
        followers: base + (day % 1000) * seeded(`${handle}-rate`, 5, 30),
        following: seeded(`${handle}-fol`, 50, 800),
        postsCount: 100 + (day % 300),
      };
    },

    async fetchPublicPosts(handle, limit): Promise<PublicPost[]> {
      await delay(300);
      const DESTS = ["Bali", "Santorini", "Kyoto", "Maldives", "Patagonia", "Zanzibar", "Iceland"];
      const TYPES = ["image", "video", "reel", "carousel"] as const;
      const day = Math.floor(Date.now() / 86400_000);
      return Array.from({ length: Math.min(limit, 25) }, (_, i) => {
        const dest = DESTS[seeded(`${handle}-${i}-d`, 0, DESTS.length)];
        const type = TYPES[seeded(`${handle}-${i}-t`, 0, TYPES.length)];
        const boost = type === "reel" || type === "video" ? 3 : 1;
        return {
          externalId: `mock_cpost_${handle}_${day - i}`,
          postedAt: new Date(Date.now() - i * seeded(`${handle}-${i}-gap`, 12, 60) * 3600_000),
          content: `Discover ${dest} with us! Limited spots for our ${dest} adventure. #${dest.toLowerCase()} #travel #wanderlust`,
          mediaType: type,
          likes: seeded(`${handle}-${i}-l`, 100, 3000) * boost,
          comments: seeded(`${handle}-${i}-c`, 5, 200),
          shares: seeded(`${handle}-${i}-s`, 2, 150),
          views: type !== "image" ? seeded(`${handle}-${i}-v`, 1000, 90000) : undefined,
          hashtags: [dest.toLowerCase(), "travel", "wanderlust"],
        };
      });
    },
  };
}
