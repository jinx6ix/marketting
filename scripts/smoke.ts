/**
 * Smoke test: env sanity, public pages, and cron endpoints.
 *
 * Usage: npm run smoke   (requires the app running on NEXT_PUBLIC_APP_URL)
 */
import { config } from "dotenv";

config({ path: ".env.local" });

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const SECRET = process.env.CRON_SECRET;

let passed = 0;
let failed = 0;

function report(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✔ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failed++;
    console.error(`  ✘ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function checkEnv() {
  console.log("env:");
  const required = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "CRON_SECRET",
    "TOKEN_ENCRYPTION_KEY",
  ];
  for (const key of required) {
    report(key, !!process.env[key], process.env[key] ? "set" : "MISSING");
  }
  const tokenKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (tokenKey) {
    report(
      "TOKEN_ENCRYPTION_KEY is 32 bytes",
      Buffer.from(tokenKey, "base64").length === 32
    );
  }
}

async function checkPage(path: string, expectStatuses: number[]) {
  try {
    const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
    report(
      `GET ${path}`,
      expectStatuses.includes(res.status),
      `HTTP ${res.status}`
    );
  } catch (e) {
    report(`GET ${path}`, false, e instanceof Error ? e.message : String(e));
  }
}

async function checkCron(job: string) {
  try {
    const res = await fetch(`${BASE}/api/cron/${job}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SECRET}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    const body = (await res.json().catch(() => ({}))) as {
      itemsProcessed?: number;
      error?: string;
    };
    report(
      `POST /api/cron/${job}`,
      res.ok,
      res.ok
        ? `${body.itemsProcessed ?? 0} items`
        : `HTTP ${res.status} ${body.error ?? ""}`
    );
  } catch (e) {
    report(`POST /api/cron/${job}`, false, e instanceof Error ? e.message : String(e));
  }
}

async function checkCronAuth() {
  try {
    const res = await fetch(`${BASE}/api/cron/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    report(
      "cron rejects missing secret",
      res.status === 401 || res.status === 403,
      `HTTP ${res.status}`
    );
  } catch (e) {
    report("cron rejects missing secret", false, e instanceof Error ? e.message : String(e));
  }
}

async function main() {
  console.log(`smoke test against ${BASE}\n`);

  await checkEnv();

  console.log("\npages:");
  await checkPage("/", [200, 307, 308]); // redirects to /login or /dashboard
  await checkPage("/login", [200]);
  await checkPage("/signup", [200]);
  // unauthenticated dashboard pages should redirect to /login
  for (const path of ["/dashboard", "/items", "/calendar", "/analytics"]) {
    await checkPage(path, [200, 307, 308]);
  }

  console.log("\ncron endpoints:");
  if (!SECRET) {
    report("CRON_SECRET", false, "not set — skipping cron checks");
  } else {
    await checkCronAuth();
    for (const job of ["publish", "mentions", "metrics", "competitors", "token-refresh"]) {
      await checkCron(job);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("smoke failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
