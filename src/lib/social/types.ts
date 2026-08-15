import type { Platform, SocialAccount } from "@/types/database";

export type { Platform, SocialAccount };

/** Tokens as held in memory (decrypted). Never log these. */
export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scopes?: string[];
}

export interface ConnectedProfile {
  externalId: string;
  handle?: string;
  displayName?: string;
  avatarUrl?: string;
  /** Platform-specific extras (e.g. FB page access token, linked IG user id). */
  metadata?: Record<string, unknown>;
  /** Some platforms return account-specific tokens (FB page tokens). */
  tokenOverride?: TokenSet;
}

export interface PublishPayload {
  text: string;
  /** Distinct title, only used by platforms with a separate title field (YouTube, Pinterest). */
  title?: string;
  mediaUrls: string[];
  mediaType: "none" | "image" | "video";
  link?: string;
  firstComment?: string;
}

export interface PublishResult {
  externalPostId: string;
  externalUrl?: string;
}

export interface AccountMetrics {
  followers?: number;
  following?: number;
  postsCount?: number;
  impressions?: number;
  reach?: number;
  profileViews?: number;
  engagementTotal?: number;
  raw?: unknown;
}

export interface PostMetrics {
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  impressions?: number;
  reach?: number;
  videoViews?: number;
  engagementRate?: number;
  raw?: unknown;
}

export interface FetchedMention {
  externalId: string;
  kind: "mention" | "comment" | "keyword_match" | "review";
  authorHandle?: string;
  authorName?: string;
  authorAvatarUrl?: string;
  content?: string;
  externalUrl?: string;
  occurredAt?: Date;
  raw?: unknown;
}

export interface PublicProfileData {
  externalId: string;
  handle: string;
  displayName?: string;
  followers?: number;
  following?: number;
  postsCount?: number;
  raw?: unknown;
}

export interface PublicPost {
  externalId: string;
  postedAt?: Date;
  content?: string;
  mediaType?: "image" | "video" | "carousel" | "reel" | "short" | "text" | "link";
  likes?: number;
  comments?: number;
  shares?: number;
  views?: number;
  hashtags?: string[];
  raw?: unknown;
}

export interface PlatformCapabilities {
  publishText: boolean;
  publishImage: boolean;
  publishVideo: boolean;
  /** Platform supports scheduling natively (else we schedule via our worker). */
  nativeScheduling: boolean;
  postMetrics: boolean;
  accountMetrics: boolean;
  mentions: boolean;
  keywordSearch: boolean;
  competitorData: boolean;
  maxTextLength: number;
  /** Human-readable caveats shown in Settings (approval tiers, account types). */
  notes: string[];
}

export class SocialApiError extends Error {
  constructor(
    public platform: Platform,
    public code: string,
    message: string,
    public retryable = false,
    public retryAfterMs?: number
  ) {
    super(`[${platform}:${code}] ${message}`);
    this.name = "SocialApiError";
  }
}

export interface SocialProviderAdapter {
  platform: Platform;
  capabilities: PlatformCapabilities;

  getAuthUrl(state: string, codeChallenge?: string): string;
  exchangeCode(code: string, codeVerifier?: string): Promise<TokenSet>;
  refreshToken(tokens: TokenSet): Promise<TokenSet>;
  /** May return several profiles (e.g. multiple FB pages) for a picker UI. */
  fetchProfile(tokens: TokenSet): Promise<ConnectedProfile[]>;

  publish(
    tokens: TokenSet,
    account: SocialAccount,
    post: PublishPayload
  ): Promise<PublishResult>;

  fetchAccountMetrics(
    tokens: TokenSet,
    account: SocialAccount
  ): Promise<AccountMetrics>;

  fetchPostMetrics(
    tokens: TokenSet,
    account: SocialAccount,
    externalPostId: string
  ): Promise<PostMetrics>;

  fetchMentions?(
    tokens: TokenSet,
    account: SocialAccount,
    since: Date
  ): Promise<FetchedMention[]>;

  /** Public competitor data — token optional depending on platform. */
  fetchPublicProfile?(
    handleOrId: string,
    tokens?: TokenSet
  ): Promise<PublicProfileData>;

  fetchPublicPosts?(
    handleOrId: string,
    limit: number,
    tokens?: TokenSet
  ): Promise<PublicPost[]>;
}

/** Helper: uniform fetch wrapper that converts HTTP errors to SocialApiError. */
export async function socialFetch(
  platform: Platform,
  url: string,
  init?: RequestInit
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    throw new SocialApiError(
      platform,
      "network",
      e instanceof Error ? e.message : "fetch failed",
      true
    );
  }
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("retry-after") ?? "60");
    throw new SocialApiError(
      platform,
      "rate_limited",
      "Rate limited",
      true,
      retryAfter * 1000
    );
  }
  if (res.status >= 500) {
    throw new SocialApiError(platform, `http_${res.status}`, await safeText(res), true);
  }
  if (!res.ok) {
    throw new SocialApiError(platform, `http_${res.status}`, await safeText(res), false);
  }
  return res;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return res.statusText;
  }
}