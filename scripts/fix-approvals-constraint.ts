/**
 * One-shot: ensures the `marketing_items_status_check` constraint allows
 * the `in_review` value used by the approval workflow. Idempotent —
 * safe to run repeatedly.
 *
 * This codebase does not ship a SQL migration runner (see
 * supabase/migrations/). Apply this in your Supabase dashboard:
 *   1. Open SQL Editor → New query
 *   2. Paste the SQL printed below
 *   3. Run
 *
 * Alternatively, if you've installed `pg` (`npm i -D pg`), set DATABASE_URL
 * (Supabase → Settings → Database → Connection string / Transaction pooler)
 * and this script will execute the SQL itself.
 *
 * Usage: npm run fix:approvals-constraint
 */
import { config } from "dotenv";

config({ path: ".env.local" });

const STATEMENTS = [
  `alter table public.marketing_items drop constraint if exists marketing_items_status_check;`,
  `alter table public.marketing_items add constraint marketing_items_status_check check (status in ('draft','in_review','scheduled','publishing','published','partially_published','failed','archived'));`,
  `alter table public.ai_usage enable row level security;`,
  `create table if not exists public.ai_usage (org_id uuid not null references public.organizations(id) on delete cascade, day date not null default current_date, calls int not null default 0, primary key (org_id, day));`,
  `create or replace function public.increment_ai_usage(p_org uuid) returns int language sql security definer set search_path = public as $$ insert into ai_usage (org_id, day, calls) values (p_org, current_date, 1) on conflict (org_id, day) do update set calls = ai_usage.calls + 1 returning calls; $$;`,
  `drop policy if exists ai_usage_select on public.ai_usage;`,
  `create policy ai_usage_select on public.ai_usage for select using (is_org_member(org_id));`,
];

const DATABASE_URL = process.env.DATABASE_URL;

async function main() {
if (DATABASE_URL) {
  try {
    // Optional: if `pg` is installed in the project, run the SQL directly.
    // Skipping typecheck for this dynamic import — it's a best-effort path.
    // @ts-expect-error - pg may not be installed
    const pgMod: unknown = await import("pg").catch(() => null);
    const pg = (pgMod as { default?: unknown })?.default ?? pgMod;
    const Client = (pg as { Client?: unknown })?.Client;
    if (typeof Client === "function") {
      const client = new (Client as new (opts: { connectionString: string }) => {
        connect(): Promise<void>;
        query(sql: string): Promise<unknown>;
        end(): Promise<void>;
      })({ connectionString: DATABASE_URL });
      await client.connect();
      for (const sql of STATEMENTS) {
        await client.query(sql);
      }
      await client.end();
      console.log(
        "[fix] Applied via DATABASE_URL: marketing_items_status_check + ai_usage backfill."
      );
      process.exit(0);
    }
  } catch (e) {
    console.error(
      "[fix] pg execution failed:",
      e instanceof Error ? e.message : String(e)
    );
    console.error("[fix] Falling back to manual SQL below.");
  }
}

console.log(
  "[fix] No DATABASE_URL set (or pg execution failed). Apply this in the Supabase SQL Editor:\n"
);
console.log(STATEMENTS.join("\n"));
console.log(
  "\n[fix] After running, click 'Submit for review' again — the constraint allowlist now includes 'in_review'."
);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
