import "server-only";
import OpenAI from "openai";
import { z } from "zod";
import {
  providerChain,
  resolveModel,
  visionModel,
  type AiProviderConfig,
} from "./providers";

export interface AiCallResult {
  text: string;
  provider: string;
  model: string;
}

/**
 * Per-request timeout for provider calls. The OpenAI SDK's own default is
 * 10 minutes — far too long here: a single hung/slow provider would block
 * the whole chain (chat + repair retry + up to 5 sequential vision calls)
 * well past the stale-strategy reaper's 10-minute window, which is exactly
 * why generation runs were getting silently reaped instead of failing over
 * to the next provider. Keep this short so a bad provider fails fast and
 * the chain actually falls over to the next one.
 */
const REQUEST_TIMEOUT_MS = Number(process.env.AI_REQUEST_TIMEOUT_MS ?? 20_000);

function clientFor(cfg: AiProviderConfig): OpenAI {
  return new OpenAI({
    baseURL: cfg.baseURL,
    apiKey: process.env[cfg.apiKeyEnv]!,
    timeout: REQUEST_TIMEOUT_MS,
    // We already walk our own provider chain on failure; let the SDK fail
    // fast once instead of silently retrying internally on top of that.
    maxRetries: 1,
  });
}

export interface ChatOptions {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
}

/**
 * Call the configured provider chain; walk fallbacks on 429/5xx.
 * Free-tier models are flaky — this is the single retry/failover point.
 */
export async function aiChat(opts: ChatOptions): Promise<AiCallResult> {
  const chain = providerChain();
  if (chain.length === 0) {
    throw new Error(
      "No AI provider configured. Set NIM_API_KEY (and/or GROQ_API_KEY, OPENROUTER_API_KEY)."
    );
  }

  let lastError: unknown;
  for (const cfg of chain) {
    const model = resolveModel(cfg.name);
    try {
      const client = clientFor(cfg);
      const res = await client.chat.completions.create({
        model,
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 2048,
        ...(opts.json ? { response_format: { type: "json_object" as const } } : {}),
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      });
      const text = res.choices[0]?.message?.content ?? "";
      if (!text) throw new Error("Empty completion");
      return { text, provider: cfg.name, model };
    } catch (e) {
      lastError = e;
      const status = (e as { status?: number }).status;
      // Only fail over on rate limits / server errors / network issues.
      if (status && status < 429 && status !== 408) throw e;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("All AI providers failed");
}

/** Streaming variant for the composer UX. Yields text deltas. */
export async function* aiChatStream(
  opts: ChatOptions
): AsyncGenerator<string, void, unknown> {
  const chain = providerChain();
  if (chain.length === 0) throw new Error("No AI provider configured");

  let lastError: unknown;
  for (const cfg of chain) {
    try {
      const client = clientFor(cfg);
      const stream = await client.chat.completions.create({
        model: resolveModel(cfg.name),
        temperature: opts.temperature ?? 0.7,
        max_tokens: opts.maxTokens ?? 2048,
        stream: true,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
      });
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) yield delta;
      }
      return;
    } catch (e) {
      lastError = e;
      const status = (e as { status?: number }).status;
      if (status && status < 429 && status !== 408) throw e;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("All AI providers failed");
}

/**
 * Structured output: request JSON, zod-parse, one repair retry.
 * Never trust raw model output.
 */
export async function aiJson<T>(
  schema: z.ZodType<T>,
  opts: ChatOptions
): Promise<{ data: T; provider: string; model: string }> {
  const first = await aiChat({ ...opts, json: true, temperature: opts.temperature ?? 0.4 });
  const parsed = tryParse(schema, first.text);
  if (parsed.success) {
    return { data: parsed.data, provider: first.provider, model: first.model };
  }

  // one repair attempt
  const repair = await aiChat({
    system:
      "You fix malformed JSON. Return ONLY valid JSON matching the requested structure — no prose, no markdown fences.",
    user: `The following output failed validation with: ${parsed.error}\n\nOriginal output:\n${first.text}\n\nReturn corrected JSON only.`,
    json: true,
    temperature: 0,
    maxTokens: opts.maxTokens ?? 2048,
  });
  const reparsed = tryParse(schema, repair.text);
  if (reparsed.success) {
    return { data: reparsed.data, provider: repair.provider, model: repair.model };
  }
  throw new Error(`AI JSON validation failed after repair: ${reparsed.error}`);
}

export interface VisionOptions {
  system: string;
  user: string;
  /** Publicly fetchable URL (signed Supabase URL is fine). */
  mediaUrl: string;
  mediaType: "image" | "video";
  maxTokens?: number;
}

/**
 * Multimodal call: image/video + prompt → JSON, zod-validated.
 * Walks the provider chain like aiChat, skipping providers with no
 * suitable vision model. NIM inlines small images as base64 (its
 * image_url support prefers data URLs); larger media is passed by URL.
 */
export async function aiVisionJson<T>(
  schema: z.ZodType<T>,
  opts: VisionOptions
): Promise<{ data: T; provider: string; model: string }> {
  const chain = providerChain();
  let lastError: unknown = new Error(
    `No provider with a ${opts.mediaType} vision model configured`
  );

  for (const cfg of chain) {
    const model = visionModel(cfg.name, opts.mediaType);
    if (!model) continue;
    try {
      const url =
        cfg.name === "nim" && opts.mediaType === "image"
          ? await toDataUrlIfSmall(opts.mediaUrl)
          : opts.mediaUrl;
      const client = clientFor(cfg);
      const res = await client.chat.completions.create({
        model,
        temperature: 0.3,
        max_tokens: opts.maxTokens ?? 1024,
        messages: [
          { role: "system", content: opts.system },
          {
            role: "user",
            content: [
              { type: "text", text: opts.user },
              { type: "image_url", image_url: { url } },
            ],
          },
        ],
      });
      const text = res.choices[0]?.message?.content ?? "";
      if (!text) throw new Error("Empty completion");
      const parsed = tryParse(schema, text);
      if (!parsed.success) {
        throw new Error(`vision JSON validation failed: ${parsed.error}`);
      }
      return { data: parsed.data, provider: cfg.name, model };
    } catch (e) {
      lastError = e;
      const status = (e as { status?: number }).status;
      // 400/404 here usually means the model doesn't exist or rejects the
      // media type — fall through to the next provider rather than aborting.
      if (status && status < 429 && status !== 408 && status !== 400 && status !== 404) {
        throw e;
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("All vision providers failed");
}

const INLINE_LIMIT_BYTES = 170_000; // NIM inline base64 limit is ~180KB

async function toDataUrlIfSmall(url: string): Promise<string> {
  try {
    const res = await fetch(url);
    if (!res.ok) return url;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > INLINE_LIMIT_BYTES) return url;
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    return `data:${contentType};base64,${buf.toString("base64")}`;
  } catch {
    return url;
  }
}

function tryParse<T>(
  schema: z.ZodType<T>,
  text: string
): { success: true; data: T } | { success: false; error: string } {
  // strip accidental markdown fences
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  try {
    const json = JSON.parse(cleaned);
    const result = schema.safeParse(json);
    if (result.success) return { success: true, data: result.data };
    return { success: false, error: result.error.message.slice(0, 500) };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message.slice(0, 200) : "invalid JSON",
    };
  }
}