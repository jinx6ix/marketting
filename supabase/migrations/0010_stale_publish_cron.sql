-- 0010: Schedules the stale-publish reaper via pg_cron.
--
-- Mirrors 0008_cron.sql: the SQL in this migration is generated and run with
-- placeholders replaced (use scripts/print-cron.ts OR replace the literals
-- in your migration runner). Skip for local/dev — use `npm run worker`.
--
-- Threshold is 15 minutes (chosen to cover slow YouTube/TikTok uploads).

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

  perform cron.schedule('stale-publish', '*/5 * * * *', format(
    $sql$ select net.http_post(url := %L, headers := jsonb_build_object('Authorization', %L, 'Content-Type','application/json'), body := '{}'::jsonb) $sql$,
    base_url || '/api/cron/stale-publish', 'Bearer ' || secret));
end $$;
