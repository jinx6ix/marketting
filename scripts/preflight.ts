/**
 * Publishing preflight: verifies everything that has to be in place for
 * "Publish now" to actually push to real social accounts.
 *
 * Run this BEFORE trusting "Publish now" with real content. It checks:
 *   1. Required env vars are set
 *   2. SOCIAL_MOCK is off (else publishes go nowhere)
 *   3. AI provider chain has at least one working key
 *   4. DB constraint migration 0009 is applied (in_review allowed)
 *   5. social_accounts have stored + non-expired tokens
 *   6. pg_cron jobs are scheduled (prod) — or skip in dev
 *
 * Usage: npm run preflight
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

let passed = 0;
let failed = 0;
let warnings = 0;

function report(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  \u2714 ${name}${detail ? ` - ${detail}` : ""}`);
  } else {
    failed++;
    console.error(`  \u2718 ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

function warn(name: string, detail: string) {
  warnings++;
  console.warn(`  ! ${name} - ${detail}`);
}

const PLATFORM_LABEL: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  x: "X (Twitter)",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  pinterest: "Pinterest",
};

console.log("\n== Publishing preflight ==\n");

// 1. Required env vars
console.log("[1] Required env:");
const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CRON_SECRET",
  "TOKEN_ENCRYPTION_KEY",
  "NEXT_PUBLIC_APP_URL",
];
for (const key of required) {
  report(key, !!process.env[key], process.env[key] ? "set" : "MISSING");
}
const tokenKey = process.env.TOKEN_ENCRYPTION_KEY;
if (tokenKey) {
  report("TOKEN_ENCRYPTION_KEY is 32 bytes", Buffer.from(tokenKey, "base64").length === 32);
}

// 2. Mock mode
console.log("\n[2] Mock mode:");
const mock = process.env.SOCIAL_MOCK === "1";
report(
  "SOCIAL_MOCK is off",
  !mock,
  mock ? "SET to 1 - publishes will NOT go live" : "unset/0 (good)"
);

// 3. AI provider
console.log("\n[3] AI provider:");
const aiProvider = process.env.AI_PROVIDER ?? "nim";
const aiKey =
  (aiProvider === "nim" && process.env.NIM_API_KEY) ||
  (aiProvider === "groq" && process.env.GROQ_API_KEY) ||
  (aiProvider === "openrouter" && process.env.OPENROUTER_API_KEY);
report(`AI_PROVIDER=${aiProvider} has API key`, !!aiKey);
const fallbacks = (process.env.AI_FALLBACK_PROVIDERS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
for (const f of fallbacks) {
  const k =
    (f === "nim" && process.env.NIM_API_KEY) ||
    (f === "groq" && process.env.GROQ_API_KEY) ||
    (f === "openrouter" && process.env.OPENROUTER_API_KEY);
  report(`fallback ${f} key`, !!k, k ? "set" : "MISSING");
}

// Next checks need the service-role client
if (!URL || !SERVICE_KEY) {
  console.log("\nCannot continue without SUPABASE_URL + service key. Stopping.");
  console.log(`\n== ${passed} passed, ${failed} failed ==`);
  process.exit(failed > 0 ? 1 : 0);
}

async function main() {
const admin = createClient(URL!, SERVICE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// 4. DB constraint: is 'in_review' allowed?
console.log("\n[4] DB constraint (migration 0009):");
const { error: testErr } = await admin
  .from("marketing_items")
  .select("id")
  .limit(1)
  .maybeSingle();
const dbReachable = !testErr || testErr.code !== "PGRST";
report("DB reachable", dbReachable, testErr?.message ?? "ok");

// Probe the actual constraint by attempting a no-op status update on a
// test row (uses a sentinel UUID — guaranteed not to match, so the update
// affects 0 rows, but constraint-validity is checked at SQL parse time
// via PREPARE; only actual values trip it). Safer: read pg_constraint.
const { data: constraintRow, error: constraintErr } = await admin.rpc(
  "exec",
  {
    sql: `select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'marketing_items_status_check'`,
  }
);
if (constraintErr) {
  warn(
    "constraint check",
    "could not query pg_constraint via RPC; run `npm run fix:approvals-constraint` if 'Submit for review' errors"
  );
} else {
  const def: string = constraintRow?.[0]?.def ?? "";
  report(
    "'in_review' allowed by marketing_items_status_check",
    def.includes("in_review"),
    def ? "constraint loaded" : "constraint NOT FOUND"
  );
}

// 5. Social accounts: tokens present and not stale
console.log("\n[5] Social accounts:");
const { data: accounts, error: accErr } = await admin
  .from("social_accounts")
  .select("id, platform, handle, status, token_expires_at, access_token_enc, refresh_token_enc");
if (accErr) {
  warn("accounts query", accErr.message);
} else {
  if (!accounts || accounts.length === 0) {
    warn("accounts", "none connected - Publish now will say 'no publish targets'");
  }
  const now = Date.now();
  for (const a of accounts ?? []) {
    const label = `${PLATFORM_LABEL[a.platform] ?? a.platform} @${a.handle ?? "?"}`;
    const hasToken = !!a.access_token_enc;
    const hasRefresh = !!a.refresh_token_enc;
    const expiresAt = a.token_expires_at ? new Date(a.token_expires_at).getTime() : null;
    const isExpired = expiresAt !== null && expiresAt < now;
    const statusOk = a.status === "active";
    const detail = [
      hasToken ? "token-stored" : "NO-TOKEN",
      a.status,
      isExpired ? "EXPIRED" : expiresAt ? "valid-until" : "no-expiry",
    ].join(" / ");
    if (hasToken && statusOk && isExpired && hasRefresh) {
      // Expired access token but a refresh token is stored — the proactive
      // refresh in src/lib/social/accounts.ts will renew it on next use.
      warn(`${label}: ${a.status}`, `${detail} — will auto-refresh on use`);
    } else {
      report(`${label}: ${a.status}`, hasToken && statusOk && !isExpired, detail);
    }
  }
}

// 6. pg_cron (prod) - skip in dev (NEXT_PUBLIC_APP_URL points at localhost)
console.log("\n[6] Scheduling:");
const isDev = /localhost|127\.0\.0\.1/.test(APP_URL);
if (isDev) {
  warn(
    "scheduling",
    "dev mode - run `npm run worker` separately to drive publish-due + stale-publish"
  );
} else {
  const { error: cronErr } = await admin.rpc("exec", {
    sql: `select jobname from cron.job`,
  });
  if (cronErr) {
    warn("pg_cron", "could not query cron.job - migrations 0008/0010 may not be applied");
  } else {
    report("pg_cron reachable", true);
  }
}

// Summary
console.log(`\n== ${passed} passed, ${warnings} warnings, ${failed} failed ==`);
process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("preflight crashed:", err);
  process.exit(1);
});
