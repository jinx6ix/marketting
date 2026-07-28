import { z } from "zod";
import { NICHE_DIRECTIVE } from "./niche";

export const strategyOutputSchema = z.object({
  summary: z.string(),
  recommendations: z
    .array(
      z.object({
        category: z.enum([
          "gap_destination",
          "gap_content_type",
          "gap_timing",
          "gap_audience",
          "gap_hashtag",
          "action",
        ]),
        title: z.string(),
        rationale: z.string(),
        priority: z.number().int().min(1).max(5),
        suggested_action: z
          .object({
            create_item: z
              .object({
                type: z.enum(["social_post", "promotion", "announcement"]),
                platforms: z.array(z.string()),
                title: z.string(),
                body_draft: z.string(),
                hashtags: z.array(z.string()),
                best_time: z.string().optional(),
                destination: z.string().optional(),
              })
              .optional(),
          })
          .nullish(),
      })
    )
    .min(1)
    .max(12),
});

export type StrategyOutput = z.infer<typeof strategyOutputSchema>;

export function strategySystemPrompt(orgNiches: string[], orgName: string): string {
  return `You are a senior marketing strategist for travel & tours businesses. You are advising "${orgName}"${
    orgNiches.length ? ` (niches: ${orgNiches.join(", ")})` : ""
  }.
You receive a computed gap-analysis snapshot comparing the business against its competitors: destination coverage, content-type performance, posting timing, frequency, follower growth, and hashtag usage.
Your job: identify where competitors are WEAK or ABSENT (the gaps the business can exploit) and where competitors are beating the business (the gaps to close). Be specific and actionable — every recommendation must reference concrete numbers from the snapshot.
The snapshot may include AI vision insights about the business's recent photos/videos — use them to recommend what visual content to produce more or less of.
${NICHE_DIRECTIVE}
Respond ONLY with valid JSON matching the requested structure.`;
}

export function strategyUserPrompt(snapshot: unknown & { org?: { recentMediaInsights?: unknown[] } }): string {
  const insights = (snapshot as { org?: { recentMediaInsights?: unknown[] } })?.org?.recentMediaInsights ?? [];
  const insightsSection = insights.length
    ? `\n\nVISION INSIGHTS — AI analysis of our recent post media:\n${JSON.stringify(insights, null, 2)}`
    : "";
  return `Gap-analysis snapshot (computed from real data):
${JSON.stringify(snapshot, null, 2)}${insightsSection}

Produce a strategy with 4-8 prioritized recommendations. For content-oriented recommendations, include a suggested_action.create_item with a ready-to-edit draft post.

Return JSON:
{
  "summary": "2-3 sentence executive summary of the biggest opportunities",
  "recommendations": [
    {
      "category": "gap_destination" | "gap_content_type" | "gap_timing" | "gap_audience" | "gap_hashtag" | "action",
      "title": "short imperative title",
      "rationale": "why, citing snapshot numbers",
      "priority": 1-5 (1 = highest),
      "suggested_action": { "create_item": { "type": "social_post", "platforms": ["instagram"], "title": "...", "body_draft": "...", "hashtags": ["..."], "best_time": "sat 09:00", "destination": "..." } } | null
    }
  ]
}`;
}
