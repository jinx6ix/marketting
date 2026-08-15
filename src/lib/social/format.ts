import type { Platform } from "@/types/database";

/**
 * Every platform gets the same source material (item title, body,
 * hashtags) but formats it differently:
 *
 * - Facebook / Instagram / TikTok / LinkedIn: one caption field. Hashtags
 *   are appended inline at the end, whole caption capped at the platform's
 *   limit.
 * - X: hardest limit (280 chars) — body is prioritized over hashtags;
 *   hashtags are appended one at a time only while they still fit, instead
 *   of blindly slicing the combined string (which could cut a hashtag or
 *   the body itself in half).
 * - YouTube / Pinterest: these have a genuine separate title field. Title
 *   comes from the item's own `title`, not the first line of the caption —
 *   previously both adapters derived "title" by splitting the caption on
 *   its first newline, which meant the actual title field you type in the
 *   composer was silently ignored and whatever sentence happened to start
 *   the caption became the YouTube video title / Pinterest pin title.
 */

const LIMITS: Record<Platform, number> = {
  facebook: 63206,
  instagram: 2200,
  x: 280,
  tiktok: 2200,
  youtube: 5000, // description; title is capped separately at 100
  linkedin: 3000,
  pinterest: 500, // description; title is capped separately at 100
};

const TITLE_LIMIT = 100;

export interface FormattedPost {
  /** Caption / description / tweet body, already capped to the platform's limit. */
  text: string;
  /** Only meaningful for platforms with a distinct title field (YouTube, Pinterest). */
  title?: string;
}

export interface FormatInput {
  title: string;
  body: string;
  hashtags: string[];
}

function tag(h: string): string {
  return h.startsWith("#") ? h : `#${h}`;
}

/** Body first, then append whole hashtags one at a time only while they fit. */
function fitWithHashtags(body: string, hashtags: string[], limit: number): string {
  if (body.length >= limit) {
    return limit > 1 ? body.slice(0, limit - 1).trimEnd() + "…" : body.slice(0, limit);
  }
  let text = body;
  for (const h of hashtags) {
    const t = tag(h);
    const candidate = text ? `${text} ${t}` : t;
    if (candidate.length > limit) break;
    text = candidate;
  }
  return text;
}

export function formatForPlatform(
  platform: Platform,
  input: FormatInput
): FormattedPost {
  const hashtags = input.hashtags ?? [];
  const tagsLine = hashtags.map(tag).join(" ");

  switch (platform) {
    case "youtube": {
      const title = (input.title || "Untitled").slice(0, TITLE_LIMIT);
      const description = [input.body, tagsLine]
        .filter(Boolean)
        .join("\n\n")
        .slice(0, LIMITS.youtube);
      return { text: description, title };
    }

    case "pinterest": {
      const title = (input.title || "Pin").slice(0, TITLE_LIMIT);
      // Pinterest descriptions are short (500 chars) — prioritize the body,
      // fit as many hashtags as still have room.
      const description = fitWithHashtags(input.body, hashtags, LIMITS.pinterest);
      return { text: description, title };
    }

    case "x": {
      return { text: fitWithHashtags(input.body, hashtags, LIMITS.x) };
    }

    case "facebook":
    case "instagram":
    case "tiktok":
    case "linkedin":
    default: {
      const limit = LIMITS[platform];
      const full = [input.body, tagsLine].filter(Boolean).join("\n\n");
      return { text: full.slice(0, limit) };
    }
  }
}