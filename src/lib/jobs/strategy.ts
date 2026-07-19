import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiJson } from "@/lib/ai/client";
import {
  strategyOutputSchema,
  strategySystemPrompt,
  strategyUserPrompt,
} from "@/lib/ai/prompts/strategy";
import type { Json } from "@/types/database";

/**
 * Gap analysis: deterministic SQL/TS first, LLM second.
 * Builds an input_snapshot comparing the org against tracked competitors,
 * then asks the strategist model for prioritized recommendations.
 */

export interface GapSnapshot {
  org: {
    name: string;
    niches: string[];
    connectedPlatforms: string[];
    followerGrowth30d: Record<string, number>;
    postsLast30d: number;
    avgEngagementByMediaType: Record<string, number>;
    topDestinations: string[];
    bestPostingHours: { dow: number; hour: number; avgEngagementRate: number }[];
    topHashtags: string[];
  };
  competitors: {
    name: string;
    platform: string;
    followers: number | null;
    followerGrowth30d: number | null;
    postingFrequencyPerWeek: number | null;
    avgEngagement: number | null;
    engagementByMediaType: Record<string, number>;
    topDestinations: { destination: string; posts: number; avgEngagement: number }[];
    postingHourHistogram: Record<string, number>;
    topHashtags: string[];
  }[];
  computedGaps: {
    destinationsCompetitorsWinOn: string[];
    destinationsNobodyCovers: string[];
    mediaTypesUnderused: string[];
    hashtagsCompetitorsUseWeDont: string[];
  };
}

export async function buildGapSnapshot(orgId: string): Promise<GapSnapshot> {
  const admin = createAdminClient();

  const [{ data: org }, { data: accounts }, { data: items }] =
    await Promise.all([
      admin.from("organizations").select("name, industry_niche").eq("id", orgId).single(),
      admin.from("social_accounts").select("id, platform").eq("org_id", orgId).eq("status", "active"),
      admin
        .from("marketing_items")
        .select("id, destination, hashtags, status, created_at")
        .eq("org_id", orgId)
        .gte("created_at", new Date(Date.now() - 30 * 86400_000).toISOString()),
    ]);

  // Own follower growth (30d) per platform
  const followerGrowth30d: Record<string, number> = {};
  for (const acc of accounts ?? []) {
    const { data: snaps } = await admin
      .from("account_metric_snapshots")
      .select("followers, captured_at")
      .eq("social_account_id", acc.id)
      .gte("captured_at", new Date(Date.now() - 30 * 86400_000).toISOString())
      .order("captured_at", { ascending: true });
    if (snaps && snaps.length >= 2) {
      const first = snaps[0].followers ?? 0;
      const last = snaps[snaps.length - 1].followers ?? 0;
      followerGrowth30d[acc.platform] =
        (followerGrowth30d[acc.platform] ?? 0) + (last - first);
    }
  }

  // Own engagement by media type (from published targets + latest snapshots)
  const { data: targets } = await admin
    .from("post_targets")
    .select("id, item_id, published_at")
    .eq("org_id", orgId)
    .eq("status", "published")
    .gte("published_at", new Date(Date.now() - 90 * 86400_000).toISOString());

  const avgEngagementByMediaType: Record<string, { total: number; n: number }> = {};
  for (const t of targets ?? []) {
    const { data: snap } = await admin
      .from("post_metric_snapshots")
      .select("likes, comments, shares")
      .eq("post_target_id", t.id)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!snap) continue;
    const { data: item } = await admin
      .from("marketing_items")
      .select("media")
      .eq("id", t.item_id)
      .single();
    const media = (item?.media ?? []) as { type?: string }[];
    const type =
      media.length === 0 ? "text" : media.some((m) => m.type === "video") ? "video" : "image";
    const eng = (snap.likes ?? 0) + (snap.comments ?? 0) + (snap.shares ?? 0);
    avgEngagementByMediaType[type] ??= { total: 0, n: 0 };
    avgEngagementByMediaType[type].total += eng;
    avgEngagementByMediaType[type].n += 1;
  }

  // Best posting hours from the view
  const { data: hours } = await admin
    .from("v_engagement_by_hour")
    .select("dow, hour, avg_engagement_rate")
    .eq("org_id", orgId)
    .order("avg_engagement_rate", { ascending: false })
    .limit(5);

  const ownDestinations = [
    ...new Set(
      (items ?? []).map((i) => i.destination).filter((d): d is string => !!d)
    ),
  ];
  const ownHashtags = [
    ...new Set((items ?? []).flatMap((i) => i.hashtags ?? [])),
  ].slice(0, 30);

  // ── Competitors ────────────────────────────────────────────────────
  const { data: comps } = await admin
    .from("competitors")
    .select("id, name, competitor_accounts(id, platform, handle)")
    .eq("org_id", orgId)
    .eq("active", true);

  const competitorSummaries: GapSnapshot["competitors"] = [];
  const allCompDestinations = new Map<string, { posts: number; totalEng: number }>();
  const allCompHashtags = new Set<string>();

  for (const comp of comps ?? []) {
    for (const ca of (comp.competitor_accounts ?? []) as {
      id: string;
      platform: string;
      handle: string;
    }[]) {
      const { data: snaps } = await admin
        .from("competitor_snapshots")
        .select("followers, avg_engagement, posting_frequency, captured_at")
        .eq("competitor_account_id", ca.id)
        .order("captured_at", { ascending: false })
        .limit(60);

      const latest = snaps?.[0];
      const monthAgo = snaps?.find(
        (s) => new Date(s.captured_at) <= new Date(Date.now() - 28 * 86400_000)
      );

      const { data: posts } = await admin
        .from("competitor_posts")
        .select("posted_at, media_type, likes, comments, shares, hashtags, destinations")
        .eq("competitor_account_id", ca.id)
        .order("posted_at", { ascending: false })
        .limit(50);

      const engagementByMediaType: Record<string, { total: number; n: number }> = {};
      const hourHistogram: Record<string, number> = {};
      const destStats = new Map<string, { posts: number; totalEng: number }>();

      for (const p of posts ?? []) {
        const eng = (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0);
        if (p.media_type) {
          engagementByMediaType[p.media_type] ??= { total: 0, n: 0 };
          engagementByMediaType[p.media_type].total += eng;
          engagementByMediaType[p.media_type].n += 1;
        }
        if (p.posted_at) {
          const h = String(new Date(p.posted_at).getUTCHours());
          hourHistogram[h] = (hourHistogram[h] ?? 0) + 1;
        }
        for (const d of p.destinations ?? []) {
          if (d === "_none") continue;
          const s = destStats.get(d) ?? { posts: 0, totalEng: 0 };
          s.posts += 1;
          s.totalEng += eng;
          destStats.set(d, s);
          const g = allCompDestinations.get(d) ?? { posts: 0, totalEng: 0 };
          g.posts += 1;
          g.totalEng += eng;
          allCompDestinations.set(d, g);
        }
        for (const h of p.hashtags ?? []) allCompHashtags.add(h);
      }

      competitorSummaries.push({
        name: comp.name,
        platform: ca.platform,
        followers: latest?.followers ?? null,
        followerGrowth30d:
          latest?.followers != null && monthAgo?.followers != null
            ? latest.followers - monthAgo.followers
            : null,
        postingFrequencyPerWeek: latest?.posting_frequency ?? null,
        avgEngagement: latest?.avg_engagement ?? null,
        engagementByMediaType: avg(engagementByMediaType),
        topDestinations: [...destStats.entries()]
          .map(([destination, s]) => ({
            destination,
            posts: s.posts,
            avgEngagement: Math.round(s.totalEng / s.posts),
          }))
          .sort((a, b) => b.avgEngagement - a.avgEngagement)
          .slice(0, 5),
        postingHourHistogram: hourHistogram,
        topHashtags: [...allCompHashtags].slice(0, 15),
      });
    }
  }

  // ── Computed gaps (deterministic) ──────────────────────────────────
  const ownDestSet = new Set(ownDestinations.map((d) => d.toLowerCase()));
  const destinationsCompetitorsWinOn = [...allCompDestinations.entries()]
    .filter(([d]) => !ownDestSet.has(d.toLowerCase()))
    .sort((a, b) => b[1].totalEng / b[1].posts - a[1].totalEng / a[1].posts)
    .slice(0, 8)
    .map(([d]) => d);

  const ownMediaAvg = avg(avgEngagementByMediaType);
  const mediaTypesUnderused = ["video", "reel", "carousel"].filter((t) => {
    const compAvg = Math.max(
      ...competitorSummaries.map((c) => c.engagementByMediaType[t] ?? 0),
      0
    );
    return compAvg > 0 && (ownMediaAvg[t] ?? 0) < compAvg * 0.5;
  });

  const ownTagSet = new Set(ownHashtags.map((h) => h.toLowerCase()));
  const hashtagsCompetitorsUseWeDont = [...allCompHashtags]
    .filter((h) => !ownTagSet.has(h.toLowerCase()))
    .slice(0, 12);

  return {
    org: {
      name: org?.name ?? "Your company",
      niches: org?.industry_niche ?? [],
      connectedPlatforms: [...new Set((accounts ?? []).map((a) => a.platform))],
      followerGrowth30d,
      postsLast30d: (items ?? []).length,
      avgEngagementByMediaType: ownMediaAvg,
      topDestinations: ownDestinations.slice(0, 10),
      bestPostingHours: (hours ?? []).map((h) => ({
        dow: h.dow,
        hour: h.hour,
        avgEngagementRate: Number(h.avg_engagement_rate ?? 0),
      })),
      topHashtags: ownHashtags,
    },
    competitors: competitorSummaries,
    computedGaps: {
      destinationsCompetitorsWinOn,
      destinationsNobodyCovers: [],
      mediaTypesUnderused,
      hashtagsCompetitorsUseWeDont,
    },
  };
}

function avg(
  byType: Record<string, { total: number; n: number }>
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(byType).map(([k, v]) => [k, Math.round(v.total / Math.max(v.n, 1))])
  );
}

/** Full pipeline: snapshot → LLM → persist strategy + recommendations. */
export async function generateStrategy(
  orgId: string,
  userId: string | null
): Promise<string> {
  const admin = createAdminClient();

  const { data: strategy, error } = await admin
    .from("ai_strategies")
    .insert({
      org_id: orgId,
      kind: "gap_analysis",
      title: `Competitor gap analysis — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`,
      status: "running",
      created_by: userId,
    })
    .select("id")
    .single();
  if (error || !strategy) throw new Error(error?.message ?? "insert failed");

  try {
    const snapshot = await buildGapSnapshot(orgId);
    const { data: org } = await admin
      .from("organizations")
      .select("name, industry_niche")
      .eq("id", orgId)
      .single();

    const result = await aiJson(strategyOutputSchema, {
      system: strategySystemPrompt(org?.industry_niche ?? [], org?.name ?? ""),
      user: strategyUserPrompt(snapshot),
      maxTokens: 4000,
      temperature: 0.5,
    });

    await admin
      .from("ai_strategies")
      .update({
        status: "completed",
        summary: result.data.summary,
        input_snapshot: snapshot as unknown as Json,
        model: result.model,
        provider: result.provider,
        completed_at: new Date().toISOString(),
      })
      .eq("id", strategy.id);

    for (const rec of result.data.recommendations) {
      await admin.from("ai_recommendations").insert({
        org_id: orgId,
        strategy_id: strategy.id,
        category: rec.category,
        title: rec.title,
        rationale: rec.rationale,
        priority: rec.priority,
        suggested_action: (rec.suggested_action ?? null) as Json,
      });
    }

    return strategy.id;
  } catch (e) {
    await admin
      .from("ai_strategies")
      .update({
        status: "failed",
        error: e instanceof Error ? e.message.slice(0, 500) : "unknown",
      })
      .eq("id", strategy.id);
    throw e;
  }
}
