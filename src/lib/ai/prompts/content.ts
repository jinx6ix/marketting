import type { Platform } from "@/types/database";

const PLATFORM_STYLE: Record<Platform, string> = {
  facebook:
    "Conversational, community-oriented. Up to ~500 chars. Emojis OK. End with a question or CTA.",
  instagram:
    "Visual-first caption, max 2200 chars but front-load the hook in the first 125. 5-15 relevant hashtags at the end. Emojis encouraged.",
  x: "Max 280 characters TOTAL. Punchy hook, 1-2 hashtags max, no fluff.",
  tiktok:
    "Casual, trend-aware, hook in first line. Max 2200 chars. 3-6 hashtags including niche travel tags.",
  youtube:
    "First line = video title (max 100 chars). Following lines = description with keywords, timestamps placeholder, and links CTA.",
  linkedin:
    "Professional but warm. Up to 3000 chars. Focus on business travel value, group bookings, industry insight. Minimal emojis, no hashtag spam (3 max).",
  pinterest:
    "First line = pin title (max 100 chars). Following lines = description max 500 chars, keyword-rich for Pinterest SEO.",
};

export function contentSystemPrompt(orgNiches: string[]): string {
  return `You are an expert social media copywriter for a travel & tours company${
    orgNiches.length ? ` specializing in: ${orgNiches.join(", ")}` : ""
  }.
You write compelling, booking-driving content. You know travel marketing: sell the feeling and the experience, use sensory language, create urgency with scarcity (limited spots, seasonal windows), and always include a clear call to action.
Never invent specific prices, dates, or availability unless provided. Never use clichés like "hidden gem" or "paradise on earth" more than once.`;
}

export function generatePostPrompt(params: {
  brief: string;
  platform?: Platform;
  destination?: string;
  tone?: string;
  promo?: { discount_pct?: number; promo_code?: string; package_name?: string };
}): string {
  const { brief, platform, destination, tone, promo } = params;
  const parts = [
    `Write a social media post based on this brief: ${brief}`,
    destination ? `Destination: ${destination}` : null,
    tone ? `Tone: ${tone}` : null,
    promo?.package_name ? `Package: ${promo.package_name}` : null,
    promo?.discount_pct ? `Discount: ${promo.discount_pct}% off` : null,
    promo?.promo_code ? `Promo code to include: ${promo.promo_code}` : null,
    platform
      ? `Platform: ${platform}. Style rules: ${PLATFORM_STYLE[platform]}`
      : "Write a platform-neutral master version (300-500 chars) that can be adapted per platform.",
    "Return ONLY the post text, no explanations or quotes around it.",
  ];
  return parts.filter(Boolean).join("\n");
}

export function adaptForPlatformPrompt(masterCopy: string, platform: Platform): string {
  return `Adapt this master post for ${platform}:\n\n${masterCopy}\n\nStyle rules: ${PLATFORM_STYLE[platform]}\nReturn ONLY the adapted post text.`;
}

export function hashtagsPrompt(text: string, destination?: string): string {
  return `Suggest 10 high-performing hashtags for this travel post${
    destination ? ` about ${destination}` : ""
  }:\n\n${text}\n\nMix: 3 high-volume generic travel tags, 4 niche/destination tags, 3 branded or community tags. Return as a JSON object: {"hashtags": ["tag1", ...]} with no # symbols.`;
}

export function sentimentPrompt(mentions: { id: string; content: string }[]): string {
  return `Classify the sentiment of each social media comment/mention about a travel company.
Return JSON: {"results": [{"id": "...", "sentiment": "positive"|"neutral"|"negative"}]}

Mentions:
${JSON.stringify(mentions)}`;
}

export function tagCompetitorPostsPrompt(
  posts: { id: string; content: string }[]
): string {
  return `For each competitor social post from a travel company, extract mentioned destinations (city/region/country names, normalized in English) and hashtags.
Return JSON: {"results": [{"id": "...", "destinations": ["Bali"], "hashtags": ["bali","travel"]}]}

Posts:
${JSON.stringify(posts)}`;
}
