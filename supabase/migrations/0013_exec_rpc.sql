-- 0013: read-only `exec` RPC for operational tooling (scripts/preflight.ts).
--
-- Lets the service-role key run a SELECT and get the rows back as JSON,
-- which preflight uses to inspect pg_constraint and cron.job. The function
-- is locked down to service_role only — service_role already has full DB
-- access, so this grants no new privileges to anyone else.
--
-- Apply in the Supabase SQL Editor (or via DATABASE_URL tooling).

create or replace function public.exec(sql text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  -- Reject anything that isn't a single SELECT statement.
  if sql !~* '^\s*select\b' or sql ~ ';' then
    raise exception 'exec() only accepts a single SELECT statement';
  end if;
  execute format(
    'select coalesce(jsonb_agg(t), ''[]''::jsonb) from (%s) t',
    sql
  ) into result;
  return result;
end;
$$;

revoke all on function public.exec(text) from public;
revoke all on function public.exec(text) from anon;
revoke all on function public.exec(text) from authenticated;
grant execute on function public.exec(text) to service_role;
