/**
 * Dev-mode scheduler: runs the same cron jobs against a local `next dev`
 * server. Production uses pg_cron (supabase/migrations/0008_cron.sql).
 *
 * Usage: npm run worker   (requires the app running on NEXT_PUBLIC_APP_URL)
 */
import cron from "node-cron";
import { config } from "dotenv";

config({ path: ".env.local" });

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const SECRET = process.env.CRON_SECRET;

if (!SECRET) {
  console.error("CRON_SECRET is not set in .env.local");
  process.exit(1);
}

async function trigger(job: string): Promise<void> {
  const started = Date.now();
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
    const ms = Date.now() - started;
    if (res.ok) {
      console.log(
        `[worker] ${job}: ok, ${body.itemsProcessed ?? 0} items (${ms}ms)`
      );
    } else {
      console.error(`[worker] ${job}: HTTP ${res.status} ${body.error ?? ""}`);
    }
  } catch (e) {
    console.error(
      `[worker] ${job}: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

console.log(`[worker] scheduling jobs against ${BASE}`);

cron.schedule("* * * * *", () => trigger("publish"));
cron.schedule("*/5 * * * *", () => trigger("stale-publish"));
cron.schedule("*/5 * * * *", () => trigger("retry-partial"));
cron.schedule("*/5 * * * *", () => trigger("stale-strategy"));
cron.schedule("*/10 * * * *", () => trigger("mentions"));
cron.schedule("*/30 * * * *", () => trigger("metrics"));
cron.schedule("0 */6 * * *", () => trigger("competitors"));
cron.schedule("0 3 * * *", () => trigger("token-refresh"));

// fire a first round immediately so devs see activity
void trigger("publish");
void trigger("stale-publish");
void trigger("retry-partial");
void trigger("stale-strategy");
void trigger("mentions");
void trigger("metrics");
