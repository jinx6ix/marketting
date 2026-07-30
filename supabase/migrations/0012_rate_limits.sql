-- DB-backed per-platform rate limiting shared across serverless instances.
-- Replaces the in-memory buckets in src/lib/jobs/rate-limit.ts, which reset
-- on every cold start and let N instances multiply the real request rate.

create table if not exists public.platform_rate_limits (
  platform text primary key,
  blocked_until timestamptz,
  window_start timestamptz not null default now(),
  used integer not null default 0
);

-- Service-role only (no policies): RLS on, workers use the admin client.
alter table public.platform_rate_limits enable row level security;

-- Atomically take one request slot in a 1-minute fixed window.
-- Returns false when the platform is 429-blocked or the budget is spent.
create or replace function public.try_acquire_platform_slot(
  p_platform text,
  p_budget integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.platform_rate_limits;
begin
  insert into public.platform_rate_limits (platform)
  values (p_platform)
  on conflict (platform) do nothing;

  select * into r
  from public.platform_rate_limits
  where platform = p_platform
  for update;

  if r.blocked_until is not null and r.blocked_until > now() then
    return false;
  end if;

  if r.window_start < now() - interval '1 minute' then
    update public.platform_rate_limits
    set window_start = now(), used = 1, blocked_until = null
    where platform = p_platform;
    return true;
  end if;

  if r.used >= p_budget then
    return false;
  end if;

  update public.platform_rate_limits
  set used = used + 1
  where platform = p_platform;
  return true;
end;
$$;

-- Record a platform-issued 429 backoff so every instance honors it.
create or replace function public.mark_platform_rate_limited(
  p_platform text,
  p_until timestamptz
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.platform_rate_limits (platform, blocked_until)
  values (p_platform, p_until)
  on conflict (platform) do update set blocked_until = excluded.blocked_until;
$$;
