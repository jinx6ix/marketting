import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/supabase/server";
import { checkAiQuota } from "@/lib/ai/quota";
import { analyzeItemMedia } from "@/lib/ai/media-insights";

const bodySchema = z.object({ itemId: z.string().uuid() });

export async function POST(request: NextRequest) {
  const { user, orgId, supabase } = await getSessionContext();
  if (!user || !orgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "itemId required" }, { status: 400 });
  }

  // Verify item belongs to this org
  const { data: item } = await supabase
    .from("marketing_items")
    .select("id, media")
    .eq("id", parsed.data.itemId)
    .eq("org_id", orgId)
    .single();
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const media = (item.media ?? []) as unknown[];
  if (media.length === 0) {
    return NextResponse.json({ error: "This item has no media to analyze" }, { status: 400 });
  }

  const quota = await checkAiQuota(orgId);
  if (!quota.ok) {
    return NextResponse.json(
      { error: `Daily AI limit reached (${quota.limit} calls). Try again tomorrow.` },
      { status: 429 }
    );
  }

  try {
    const insights = await analyzeItemMedia(parsed.data.itemId);
    return NextResponse.json({ insights });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Vision analysis failed" },
      { status: 500 }
    );
  }
}
