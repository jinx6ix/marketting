import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/supabase/server";
import { generateStrategy } from "@/lib/jobs/strategy";
import { checkAiQuota } from "@/lib/ai/quota";

export const maxDuration = 300;

export async function POST() {
  const { user, orgId } = await getSessionContext();
  if (!user || !orgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const quota = await checkAiQuota(orgId);
  if (!quota.ok) {
    return NextResponse.json(
      { error: `Daily AI limit reached (${quota.limit} calls). Try again tomorrow.` },
      { status: 429 }
    );
  }

  try {
    const strategyId = await generateStrategy(orgId, user.id);
    return NextResponse.json({ strategyId });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Strategy generation failed" },
      { status: 500 }
    );
  }
}
