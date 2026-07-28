import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/jobs/auth";
import { reapStalePublishes } from "@/lib/jobs/stale-publish";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const denied = checkCronAuth(request);
  if (denied) return denied;
  const result = await reapStalePublishes();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
