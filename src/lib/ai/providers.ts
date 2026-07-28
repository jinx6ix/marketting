import "server-only";

export type AiProviderName = "nim" | "groq" | "openrouter";

export interface AiProviderConfig {
  name: AiProviderName;
  baseURL: string;
  apiKeyEnv: string;
  defaultModel: string;
}

export const AI_PROVIDERS: Record<AiProviderName, AiProviderConfig> = {
  nim: {
    name: "nim",
    baseURL: "https://integrate.api.nvidia.com/v1",
    apiKeyEnv: "NIM_API_KEY",
    defaultModel: "meta/llama-3.3-70b-instruct",
  },
  groq: {
    name: "groq",
    baseURL: "https://api.groq.com/openai/v1",
    apiKeyEnv: "GROQ_API_KEY",
    defaultModel: "llama-3.3-70b-versatile",
  },
  openrouter: {
    name: "openrouter",
    baseURL: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
    defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
  },
};

export function resolveModel(provider: AiProviderName): string {
  if (provider === (process.env.AI_PROVIDER ?? "nim")) {
    return process.env.AI_MODEL ?? AI_PROVIDERS[provider].defaultModel;
  }
  const perProvider = {
    nim: process.env.NIM_MODEL,
    groq: process.env.GROQ_MODEL,
    openrouter: process.env.OPENROUTER_MODEL,
  }[provider];
  return perProvider ?? AI_PROVIDERS[provider].defaultModel;
}

/**
 * Vision (multimodal) models. NIM is primary; OpenRouter free vision model
 * is the fallback. Groq has no stable free vision model, so it is skipped.
 * Override via NIM_VISION_MODEL / NIM_VIDEO_MODEL / OPENROUTER_VISION_MODEL.
 */
export function visionModel(provider: AiProviderName, kind: "image" | "video"): string | null {
  if (provider === "nim") {
    return kind === "video"
      ? process.env.NIM_VIDEO_MODEL ?? "nvidia/vila"
      : process.env.NIM_VISION_MODEL ?? "meta/llama-3.2-90b-vision-instruct";
  }
  if (provider === "openrouter") {
    // OpenRouter free VL models handle both images and video-as-URL poorly;
    // use for images only.
    return kind === "image"
      ? process.env.OPENROUTER_VISION_MODEL ?? "qwen/qwen2.5-vl-72b-instruct:free"
      : null;
  }
  return null;
}

/** Ordered chain: primary provider then fallbacks, keeping only configured ones. */
export function providerChain(): AiProviderConfig[] {
  const primary = (process.env.AI_PROVIDER ?? "nim") as AiProviderName;
  const fallbacks = (process.env.AI_FALLBACK_PROVIDERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is AiProviderName => s in AI_PROVIDERS && s !== primary);

  return [primary, ...fallbacks]
    .map((name) => AI_PROVIDERS[name])
    .filter((cfg) => !!process.env[cfg.apiKeyEnv]);
}
