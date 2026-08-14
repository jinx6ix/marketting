import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiJson } from "@/lib/ai/client";
import {
  strategyOutputSchema,
  strategySystemPrompt,
  strategyUserPrompt,
} from "@/lib/ai/prompts/strategy";
import { isEastAfricanDestination } from "@/lib/ai/prompts/niche";
import {
  analyzeItemMedia,
  type ItemMediaInsights,
} from "@/lib/ai/media-insights";
import type { Json } from "@/types/database";

/**
 * Gap analysis: deterministic SQL/TS first, LLM second.
 * Builds an input_snapshot comparing the org against tracked competitors,
 * then asks the strategist model for prioritized recommendations.
 *
 * Perf note: every sub-section below fans its DB/AI calls out with
 * Promise.all instead of awaiting one-at-a-time in a for-loop. With
 * sequential awaits, an org with a few hundred published posts / several
 * competitor accounts / a handful of unanalyzed images could take minutes
 * of pure round-trip latency even when every individual call is fast —
 * which is what was making "Generate strategy" look stuck on `running`.
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
    /** AI vision insights on recent post media (what our photos/videos show). */
    recentMediaInsights: { title: string; insights: ItemMediaInsights }[];
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

  // Own follower growth (30d) per platform — one query per account, run
  // concurrently instead of sequentially.
  const growthPerAccount = await Promise.all(
    (accounts ?? []).map(async (acc) => {
      const { data: snaps } = await admin
        .from("account_metric_snapshots")
        .select("followers, captured_at")
        .eq("social_account_id", acc.id)
        .gte("captured_at", new Date(Date.now() - 30 * 86400_000).toISOString())
        .order("captured_at", { ascending: true });
      if (snaps && snaps.length >= 2) {
        const first = snaps[0].followers ?? 0;
        const last = snaps[snaps.length - 1].followers ?? 0;
        return { platform: acc.platform, delta: last - first };
      }
      return null;
    })
  );
  const followerGrowth30d: Record<string, number> = {};
  for (const g of growthPerAccount) {
    if (!g) continue;
    followerGrowth30d[g.platform] = (followerGrowth30d[g.platform] ?? 0) + g.delta;
  }

  // Own engagement by media type (from published targets + latest snapshots).
  // Bounded to the 200 most recently published targets, and batch-fetches
  // snapshots + item media in two queries total instead of two round trips
  // PER target (previously up to ~400 sequential queries for a busy org).
  const { data: targets } = await admin
    .from("post_targets")
    .select("id, item_id, published_at")
    .eq("org_id", orgId)
    .eq("status", "published")
    .gte("published_at", new Date(Date.now() - 90 * 86400_000).toISOString())
    .order("published_at", { ascending: false })
    .limit(200);

  const avgEngagementByMediaType: Record<string, { total: number; n: number }> = {};
  if (targets && targets.length > 0) {
    const targetIds = targets.map((t) => t.id);
    const itemIds = [...new Set(targets.map((t) => t.item_id))];

    const [{ data: snaps }, { data: mediaItems }] = await Promise.all([
      admin
        .from("post_metric_snapshots")
        .select("post_target_id, likes, comments, shares, captured_at")
        .in("post_target_id", targetIds)
        .order("captured_at", { ascending: false }),
      admin.from("marketing_items").select("id, media").in("id", itemIds),
    ]);

    // Keep only the latest snapshot per target (rows arrive newest-first).
    const latestSnapByTarget = new Map<
      string,
      { likes: number | null; comments: number | null; shares: number | null }
    >();
    for (const s of snaps ?? []) {
      if (!latestSnapByTarget.has(s.post_target_id)) {
        latestSnapByTarget.set(s.post_target_id, s);
      }
    }
    const mediaByItem = new Map(
      (mediaItems ?? []).map((mi) => [mi.id, (mi.media ?? []) as { type?: string }[]])
    );

    for (const t of targets) {
      const snap = latestSnapByTarget.get(t.id);
      if (!snap) continue;
      const media = mediaByItem.get(t.item_id) ?? [];
      const type =
        media.length === 0 ? "text" : media.some((m) => m.type === "video") ? "video" : "image";
      const eng = (snap.likes ?? 0) + (snap.comments ?? 0) + (snap.shares ?? 0);
      avgEngagementByMediaType[type] ??= { total: 0, n: 0 };
      avgEngagementByMediaType[type].total += eng;
      avgEngagementByMediaType[type].n += 1;
    }
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

  const competitorPairs = (comps ?? []).flatMap((comp) =>
    ((comp.competitor_accounts ?? []) as { id: string; platform: string; handle: string }[]).map(
      (ca) => ({ comp, ca })
    )
  );

  const allCompDestinations = new Map<string, { posts: number; totalEng: number }>();
  const allCompHashtags = new Set<string>();

  // One (comp, account) pair per competitor social account — run all of
  // them concurrently instead of one account at a time.
  const competitorResults = await Promise.all(
    competitorPairs.map(async ({ comp, ca }) => {
      const [{ data: snaps }, { data: posts }] = await Promise.all([
        admin
          .from("competitor_snapshots")
          .select("followers, avg_engagement, posting_frequency, captured_at")
          .eq("competitor_account_id", ca.id)
          .order("captured_at", { ascending: false })
          .limit(60),
        admin
          .from("competitor_posts")
          .select("posted_at, media_type, likes, comments, shares, hashtags, destinations")
          .eq("competitor_account_id", ca.id)
          .order("posted_at", { ascending: false })
          .limit(50),
      ]);

      const latest = snaps?.[0];
      const monthAgo = snaps?.find(
        (s) => new Date(s.captured_at) <= new Date(Date.now() - 28 * 86400_000)
      );

      const engagementByMediaType: Record<string, { total: number; n: number }> = {};
      const hourHistogram: Record<string, number> = {};
      const destStats = new Map<string, { posts: number; totalEng: number }>();
      const hashtags = new Set<string>();

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
        }
        for (const h of p.hashtags ?? []) hashtags.add(h);
      }

      return {
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
          .filter(([destination]) => isEastAfricanDestination(destination))
          .map(([destination, s]) => ({
            destination,
            posts: s.posts,
            avgEngagement: Math.round(s.totalEng / s.posts),
          }))
          .sort((a, b) => b.avgEngagement - a.avgEngagement)
          .slice(0, 5),
        postingHourHistogram: hourHistogram,
        destStats,
        hashtags,
      };
    })
  );

  // Merge per-account destination/hashtag stats into the global maps now
  // that every account has finished (sequential merge, but purely in-memory
  // so it's effectively instant regardless of how many accounts there are).
  for (const r of competitorResults) {
    for (const [d, s] of r.destStats) {
      const g = allCompDestinations.get(d) ?? { posts: 0, totalEng: 0 };
      g.posts += s.posts;
      g.totalEng += s.totalEng;
      allCompDestinations.set(d, g);
    }
    for (const h of r.hashtags) allCompHashtags.add(h);
  }

  const topHashtagsOverall = [...allCompHashtags].slice(0, 15);
  const competitorSummaries: GapSnapshot["competitors"] = competitorResults.map(
    ({ destStats: _destStats, hashtags: _hashtags, ...summary }) => ({
      ...summary,
      topHashtags: topHashtagsOverall,
    })
  );

  // ── Computed gaps (deterministic) ──────────────────────────────────
  const ownDestSet = new Set(ownDestinations.map((d) => d.toLowerCase()));
  const destinationsCompetitorsWinOn = [...allCompDestinations.entries()]
    .filter(([d]) => isEastAfricanDestination(d))
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

  // ── Vision insights on our own recent media ────────────────────────
  // Up to 5 images need a fresh (real, network-bound) vision-model call;
  // run those 5 concurrently instead of one after another.
  const { data: mediaItemsForVision } = await admin
    .from("marketing_items")
    .select("id, title, media, media_insights")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(15);

  const withMedia = (mediaItemsForVision ?? []).filter(
    (mi) => ((mi.media ?? []) as unknown[]).length > 0
  );
  const alreadyInsighted = withMedia.filter((mi) => mi.media_insights);
  const needsAnalysis = withMedia.filter((mi) => !mi.media_insights).slice(0, 5);

  const freshlyAnalyzed = await Promise.all(
    needsAnalysis.map(async (mi) => {
      try {
        const insights = await analyzeItemMedia(mi.id);
        return { title: mi.title, insights };
      } catch {
        // vision failures must not block strategy generation
        return null;
      }
    })
  );

  const recentMediaInsights: GapSnapshot["org"]["recentMediaInsights"] = [
    ...alreadyInsighted.map((mi) => ({
      title: mi.title,
      insights: mi.media_insights as unknown as ItemMediaInsights,
    })),
    ...freshlyAnalyzed.filter(
      (r): r is { title: string; insights: ItemMediaInsights } => r !== null
    ),
  ];

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
      recentMediaInsights,
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