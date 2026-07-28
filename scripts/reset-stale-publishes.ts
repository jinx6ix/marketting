/**
 * One-shot recovery script: flips post_targets stuck on `publishing` for
 * too long back to `failed` so the normal publish/escalation flow can take
 * over (and so the user-facing Retry button becomes actionable for those
 * rows). Mirrors the in-process reaper in src/lib/jobs/stale-publish.ts.
 *
 * Usage:
 *   DRY_RUN=1 npm run reset:stale-publishes   # preview only
 *   npm run reset:stale-publishes            # apply
 *   STALE_MINUTES=30 npm run reset:stale-publishes   # use a custom window
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL in .env.local.
 */
import { config } from "dotenv";

config({ path: ".env.local" });

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SERVICE_KEY) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required"
  );
  process.exit(1);
}

const STALE_MINUTES = Number(process.env.STALE_MINUTES ?? "15");
const DRY_RUN = process.env.DRY_RUN === "1";

const STALE_MS = STALE_MINUTES * 60_000;
const STALE_MESSAGE = `Reaped by reset-stale-publishes (no completion within ${STALE_MINUTES} minutes).`;

async function main(): Promise<void> {
const { createClient } = await import("@supabase/supabase-js");
const admin = createClient(URL!, SERVICE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const cutoff = new Date(Date.now() - STALE_MS).toISOString();

const { data: stuck, error: readErr } = await admin
  .from("post_targets")
  .select("id, item_id, updated_at, status")
  .eq("status", "publishing")
  .lt("updated_at", cutoff);

if (readErr) {
  console.error(readErr.message);
  process.exit(1);
}

const list = stuck ?? [];
if (list.length === 0) {
  console.log(
    `[reset] no post_targets stuck in 'publishing' longer than ${STALE_MINUTES} minutes.`
  );
  process.exit(0);
}

console.log(
  `[reset] found ${list.length} stale target(s) older than ${STALE_MINUTES} minutes`
);

if (DRY_RUN) {
  console.log("[reset] DRY_RUN=1 — no writes performed.");
  for (const t of list) {
    console.log(
      `  - ${t.id}  item=${t.item_id}  last_update=${t.updated_at}`
    );
  }
  process.exit(0);
}

const ids = list.map((t) => t.id);
const { error: updateErr } = await admin
  .from("post_targets")
  .update({ status: "failed", error: STALE_MESSAGE, next_retry_at: null })
  .in("id", ids)
  .eq("status", "publishing");

if (updateErr) {
  console.error(updateErr.message);
  process.exit(1);
}

const itemIds = Array.from(new Set(list.map((t) => t.item_id)));
console.log(
  `[reset] flipped ${ids.length} target(s) to 'failed' across ${itemIds.length} item(s)`
);

for (const itemId of itemIds) {
  const { data: targets, error: tErr } = await admin
    .from("post_targets")
    .select("status")
    .eq("item_id", itemId);
  if (tErr) continue;
  if (!targets || targets.length === 0) continue;
  const anyPending = targets.some((t) =>
    ["pending", "queued", "publishing"].includes(t.status)
  );
  if (anyPending) continue;
  const published = targets.filter((t) => t.status === "published").length;
  const failed = targets.filter((t) => t.status === "failed").length;
  let status: "published" | "partially_published" | "failed";
  if (published > 0 && failed === 0) status = "published";
  else if (published > 0) status = "partially_published";
  else status = "failed";
  await admin.from("marketing_items").update({ status }).eq("id", itemId);
  console.log(`[reset] rolled up item ${itemId} -> ${status}`);
}

console.log("[reset] done.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
