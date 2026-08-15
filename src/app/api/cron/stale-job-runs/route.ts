import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/jobs/auth";
import { reapStaleJobRuns } from "@/lib/jobs/stale-job-runs";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const denied = checkCronAuth(request);
  if (denied) return denied;
  const result = await reapStaleJobRuns();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}