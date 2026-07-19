import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/jobs/auth";
import { publishDue } from "@/lib/jobs/publish";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const denied = checkCronAuth(request);
  if (denied) return denied;
  const result = await publishDue();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
