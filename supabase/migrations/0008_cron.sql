-- 0008: Production cron via pg_cron + pg_net
--
-- IMPORTANT: before applying, replace __APP_URL__ and __CRON_SECRET__ with
-- your deployed URL and CRON_SECRET value (or run scripts/print-cron.ts to
-- generate the filled-in SQL). Skip this migration for local/dev — use
-- `npm run worker` instead.

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

  perform cron.schedule('publish-due', '* * * * *', format(
    $sql$ select net.http_post(url := %L, headers := jsonb_build_object('Authorization', %L, 'Content-Type','application/json'), body := '{}'::jsonb) $sql$,
    base_url || '/api/cron/publish', 'Bearer ' || secret));

  perform cron.schedule('fetch-mentions', '*/10 * * * *', format(
    $sql$ select net.http_post(url := %L, headers := jsonb_build_object('Authorization', %L, 'Content-Type','application/json'), body := '{}'::jsonb) $sql$,
    base_url || '/api/cron/mentions', 'Bearer ' || secret));

  perform cron.schedule('fetch-metrics', '*/30 * * * *', format(
    $sql$ select net.http_post(url := %L, headers := jsonb_build_object('Authorization', %L, 'Content-Type','application/json'), body := '{}'::jsonb) $sql$,
    base_url || '/api/cron/metrics', 'Bearer ' || secret));

  perform cron.schedule('poll-competitors', '0 */6 * * *', format(
    $sql$ select net.http_post(url := %L, headers := jsonb_build_object('Authorization', %L, 'Content-Type','application/json'), body := '{}'::jsonb) $sql$,
    base_url || '/api/cron/competitors', 'Bearer ' || secret));

  perform cron.schedule('token-refresh', '0 3 * * *', format(
    $sql$ select net.http_post(url := %L, headers := jsonb_build_object('Authorization', %L, 'Content-Type','application/json'), body := '{}'::jsonb) $sql$,
    base_url || '/api/cron/token-refresh', 'Bearer ' || secret));
end $$;
