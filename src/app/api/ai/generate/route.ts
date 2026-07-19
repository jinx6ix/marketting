import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionContext } from "@/lib/supabase/server";
import { aiChatStream, aiJson } from "@/lib/ai/client";
import {
  contentSystemPrompt,
  generatePostPrompt,
  adaptForPlatformPrompt,
  hashtagsPrompt,
} from "@/lib/ai/prompts/content";
import type { Platform } from "@/types/database";

const requestSchema = z.object({
  action: z.enum(["generate", "adapt", "improve", "hashtags"]),
  brief: z.string().max(2000).optional(),
  text: z.string().max(10000).optional(),
  platform: z
    .enum(["facebook", "instagram", "x", "tiktok", "youtube", "linkedin", "pinterest"])
    .optional(),
  destination: z.string().max(200).optional(),
  tone: z.string().max(100).optional(),
  promo: z
    .object({
      discount_pct: z.number().optional(),
      promo_code: z.string().optional(),
      package_name: z.string().optional(),
    })
    .optional(),
});

export async function POST(request: NextRequest) {
  const { user, orgId, supabase } = await getSessionContext();
  if (!user || !orgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const body = parsed.data;

  const { data: org } = await supabase
    .from("organizations")
    .select("industry_niche")
    .eq("id", orgId)
    .single();
  const system = contentSystemPrompt(org?.industry_niche ?? []);

  // Hashtags: structured JSON response (not streamed)
  if (body.action === "hashtags") {
    if (!body.text) {
      return NextResponse.json({ error: "text required" }, { status: 400 });
    }
    const result = await aiJson(
      z.object({ hashtags: z.array(z.string()).min(1).max(20) }),
      { system, user: hashtagsPrompt(body.text, body.destination) }
    );
    return NextResponse.json({
      hashtags: result.data.hashtags.map((h) => h.replace(/^#/, "")),
    });
  }

  // Everything else streams plain text.
  let prompt: string;
  if (body.action === "generate") {
    if (!body.brief) {
      return NextResponse.json({ error: "brief required" }, { status: 400 });
    }
    prompt = generatePostPrompt({ ...body, brief: body.brief });
  } else if (body.action === "adapt") {
    if (!body.text || !body.platform) {
      return NextResponse.json(
        { error: "text and platform required" },
        { status: 400 }
      );
    }
    prompt = adaptForPlatformPrompt(body.text, body.platform as Platform);
  } else {
    if (!body.text) {
      return NextResponse.json({ error: "text required" }, { status: 400 });
    }
    prompt = `Improve this travel marketing post — stronger hook, clearer CTA, better flow. Keep roughly the same length${
      body.platform ? ` and follow ${body.platform} conventions` : ""
    }:\n\n${body.text}\n\nReturn ONLY the improved post text.`;
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const delta of aiChatStream({ system, user: prompt })) {
          controller.enqueue(encoder.encode(delta));
        }
        controller.close();
      } catch (e) {
        controller.enqueue(
          encoder.encode(
            `\n[AI error: ${e instanceof Error ? e.message : "unknown"}]`
          )
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
