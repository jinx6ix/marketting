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
