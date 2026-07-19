/**
 * AI smoke test: verifies the configured provider chain end-to-end with one
 * tiny JSON completion per configured provider.
 *
 * Usage: npm run smoke:ai
 *
 * Self-contained copy of the provider table in src/lib/ai/providers.ts
 * (that module is "server-only" and can't be imported from a script).
 */
import OpenAI from "openai";
import { config } from "dotenv";

config({ path: ".env.local" });

const PROVIDERS = {
  nim: {
    baseURL: "https://integrate.api.nvidia.com/v1",
    apiKeyEnv: "NIM_API_KEY",
    defaultModel: "meta/llama-3.3-70b-instruct",
    modelEnv: "NIM_MODEL",
  },
  groq: {
    baseURL: "https://api.groq.com/openai/v1",
    apiKeyEnv: "GROQ_API_KEY",
    defaultModel: "llama-3.3-70b-versatile",
    modelEnv: "GROQ_MODEL",
  },
  openrouter: {
    baseURL: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
    defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
    modelEnv: "OPENROUTER_MODEL",
  },
} as const;

type ProviderName = keyof typeof PROVIDERS;

function resolveModel(name: ProviderName): string {
  if (name === (process.env.AI_PROVIDER ?? "nim")) {
    return process.env.AI_MODEL ?? PROVIDERS[name].defaultModel;
  }
  return process.env[PROVIDERS[name].modelEnv] ?? PROVIDERS[name].defaultModel;
}

async function probe(name: ProviderName): Promise<boolean> {
  const cfg = PROVIDERS[name];
  const apiKey = process.env[cfg.apiKeyEnv];
  if (!apiKey) {
    console.log(`  - ${name}: skipped (${cfg.apiKeyEnv} not set)`);
    return false;
  }
  const model = resolveModel(name);
  const client = new OpenAI({ baseURL: cfg.baseURL, apiKey });
  const started = Date.now();
  try {
    const res = await client.chat.completions.create({
      model,
      temperature: 0,
      max_tokens: 50,
      messages: [
        {
          role: "system",
          content: 'Respond ONLY with the JSON object {"ok": true}.',
        },
        { role: "user", content: "Health check." },
      ],
    });
    const ms = Date.now() - started;
    const text = res.choices[0]?.message?.content ?? "";
    const ok = /"ok"\s*:\s*true/.test(text);
    console.log(
      `  ${ok ? "✔" : "✘"} ${name} (${model}): ${ms}ms — ${text.slice(0, 60).replace(/\n/g, " ")}`
    );
    return ok;
  } catch (e) {
    const ms = Date.now() - started;
    console.error(
      `  ✘ ${name} (${model}): ${ms}ms — ${e instanceof Error ? e.message : String(e)}`
    );
    return false;
  }
}

async function main() {
  const primary = (process.env.AI_PROVIDER ?? "nim") as ProviderName;
  const fallbacks = (process.env.AI_FALLBACK_PROVIDERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is ProviderName => s in PROVIDERS && s !== primary);

  console.log(`AI smoke test — chain: ${[primary, ...fallbacks].join(" → ")}\n`);

  let anyOk = false;
  for (const name of [primary, ...fallbacks]) {
    anyOk = (await probe(name)) || anyOk;
  }

  console.log(
    anyOk
      ? "\nAt least one provider is healthy — AI generation will work."
      : "\nNo provider responded correctly — content/strategy generation will fail."
  );
  process.exit(anyOk ? 0 : 1);
}

main().catch((e) => {
  console.error("smoke-ai failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
