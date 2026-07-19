import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/supabase/server";
import { generateStrategy } from "@/lib/jobs/strategy";

export const maxDuration = 300;

export async function POST() {
  const { user, orgId } = await getSessionContext();
  if (!user || !orgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
