-- 0014: Schedule retry-partial and stale-strategy via pg_cron.
--
-- These routes are wired into scripts/worker.ts (dev) but were never given a
-- production schedule, so partially_published items pile up and ai_strategies
-- stuck on 'running' never get reaped. Mirrors 0008_cron.sql / 0010 — apply
-- with __APP_URL__ and __CRON_SECRET__ replaced at apply time.
--
-- Frequency is */5 * * * * to match the dev worker.

-- Refuse to apply unconfigured in production. `current_setting(..., true)`
-- returns NULL when the GUC is unset, so dev/local pushes (which never set
-- app.environment) silently pass through. Operators on hosted Supabase
-- should `ALTER DATABASE postgres SET app.environment = 'production';`
-- once per project, which causes any future cron-bearing migration with
-- un-replaced placeholders to fail loudly instead of silently no-op'ing.

do $$
begin
  if current_setting('app.environment', true) = 'production'
     and '__APP_URL__' = '__APP_URL__' then
    raise exception 'pg_cron schedule not configured: replace __APP_URL__ and __CRON_SECRET__ before applying in production';
  end if;
end $$;

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  base_url text := '__APP_URL__';
  secret text := '__CRON_SECRET__';
begin
  if base_url = '__APP_URL__' then
    raise notice 'pg_cron schedule skipped: placeholders not replaced';
    return;
  end if;

  perform cron.schedule('retry-partial', '*/5 * * * *', format(
    $sql$ select net.http_post(url := %L, headers := jsonb_build_object('Authorization', %L, 'Content-Type','application/json'), body := '{}'::jsonb) $sql$,
    base_url || '/api/cron/retry-partial', 'Bearer ' || secret));

  perform cron.schedule('stale-strategy', '*/5 * * * *', format(
    $sql$ select net.http_post(url := %L, headers := jsonb_build_object('Authorization', %L, 'Content-Type','application/json'), body := '{}'::jsonb) $sql$,
    base_url || '/api/cron/stale-strategy', 'Bearer ' || secret));
end $$;
