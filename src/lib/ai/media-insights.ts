import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiVisionJson } from "./client";
import { NICHE_DIRECTIVE } from "./prompts/niche";
import type { Json } from "@/types/database";

const mediaInsightSchema = z.object({
  description: z.string(),
  wildlife_or_landmarks: z.array(z.string()),
  visual_quality: z.string(),
  best_platform: z.string(),
  suggested_hook: z.string(),
});

export type MediaInsight = z.infer<typeof mediaInsightSchema>;

export interface ItemMediaInsights {
  analyzed_at: string;
  results: {
    media_index: number;
    type: "image" | "video";
    insight?: MediaInsight;
    model?: string;
    skipped?: string;
  }[];
}

interface MediaEntry {
  storage_path?: string;
  url?: string;
  type?: "image" | "video";
}

const VISION_SYSTEM = `You are a visual content analyst for an East African safari & tours marketing team.
Analyze the provided photo or video from the company's own content library.
${NICHE_DIRECTIVE}
Respond ONLY with valid JSON.`;

const VISION_USER = `Analyze this marketing media and return JSON:
{
  "description": "1-2 sentences: scene, subjects, mood",
  "wildlife_or_landmarks": ["specific animals, parks or landmarks you can identify, e.g. 'lion', 'Maasai Mara'"],
  "visual_quality": "short note: lighting, composition, resolution issues if any",
  "best_platform": "single best-fit platform (instagram/tiktok/facebook/youtube/pinterest/x/linkedin) and why in a few words",
  "suggested_hook": "one caption hook line that would sell this visual to safari travelers"
}`;

/**
 * Run vision analysis over a marketing_item's media and persist the result
 * to marketing_items.media_insights. Skips items with no media. Individual
 * media failures are recorded as skipped, never thrown.
 */
export async function analyzeItemMedia(
  itemId: string
): Promise<ItemMediaInsights | null> {
  const admin = createAdminClient();
  const { data: item, error } = await admin
    .from("marketing_items")
    .select("id, media")
    .eq("id", itemId)
    .single();
  if (error || !item) throw new Error(error?.message ?? "Item not found");

  const media = (item.media ?? []) as MediaEntry[];
  if (media.length === 0) return null;

  const results: ItemMediaInsights["results"] = [];
  for (const [i, m] of media.entries()) {
    const type: "image" | "video" = m.type === "video" ? "video" : "image";
    const url = await resolveUrl(m);
    if (!url) {
      results.push({ media_index: i, type, skipped: "no resolvable URL" });
      continue;
    }
    try {
      const res = await aiVisionJson(mediaInsightSchema, {
        system: VISION_SYSTEM,
        user: VISION_USER,
        mediaUrl: url,
        mediaType: type,
      });
      results.push({ media_index: i, type, insight: res.data, model: res.model });
    } catch (e) {
      results.push({
        media_index: i,
        type,
        skipped: (e instanceof Error ? e.message : "vision call failed").slice(0, 300),
      });
    }
  }

  const insights: ItemMediaInsights = {
    analyzed_at: new Date().toISOString(),
    results,
  };

  await admin
    .from("marketing_items")
    .update({ media_insights: insights as unknown as Json })
    .eq("id", itemId);

  return insights;
}

async function resolveUrl(m: MediaEntry): Promise<string | null> {
  if (m.url) return m.url;
  if (!m.storage_path) return null;
  const admin = createAdminClient();
  const { data } = await admin.storage
    .from("media")
    .createSignedUrl(m.storage_path, 60 * 60);
  return data?.signedUrl ?? null;
}
