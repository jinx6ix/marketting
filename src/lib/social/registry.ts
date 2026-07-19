import "server-only";
import type { Platform } from "@/types/database";
import type { SocialProviderAdapter, PlatformCapabilities } from "./types";
import { metaAdapter } from "./providers/meta";
import { instagramAdapter } from "./providers/instagram";
import { xAdapter } from "./providers/x";
import { tiktokAdapter } from "./providers/tiktok";
import { youtubeAdapter } from "./providers/youtube";
import { linkedinAdapter } from "./providers/linkedin";
import { pinterestAdapter } from "./providers/pinterest";
import { createMockAdapter } from "./providers/mock";

export const PLATFORMS: Platform[] = [
  "facebook",
  "instagram",
  "x",
  "tiktok",
  "youtube",
  "linkedin",
  "pinterest",
];

const REAL_ADAPTERS: Record<Platform, SocialProviderAdapter> = {
  facebook: metaAdapter,
  instagram: instagramAdapter,
  x: xAdapter,
  tiktok: tiktokAdapter,
  youtube: youtubeAdapter,
  linkedin: linkedinAdapter,
  pinterest: pinterestAdapter,
};

function mockEnabled(): boolean {
  return process.env.SOCIAL_MOCK === "1";
}

export function getAdapter(platform: Platform): SocialProviderAdapter {
  if (mockEnabled()) return createMockAdapter(platform);
  const adapter = REAL_ADAPTERS[platform];
  if (!adapter) throw new Error(`Unknown platform: ${platform}`);
  return adapter;
}

export function isPlatform(value: string): value is Platform {
  return (PLATFORMS as string[]).includes(value);
}

export function getCapabilities(platform: Platform): PlatformCapabilities {
  return getAdapter(platform).capabilities;
}

/** Client-safe capability info (no adapter code) for UI feature-gating. */
export function capabilityMatrix(): Record<Platform, PlatformCapabilities> {
  return Object.fromEntries(
    PLATFORMS.map((p) => [p, getAdapter(p).capabilities])
  ) as Record<Platform, PlatformCapabilities>;
}
