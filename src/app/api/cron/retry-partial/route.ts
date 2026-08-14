import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/jobs/auth";
import { retryPartiallyPublished } from "@/lib/jobs/retry-partial";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const denied = checkCronAuth(request);
  if (denied) return denied;
  const result = await retryPartiallyPublished();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
