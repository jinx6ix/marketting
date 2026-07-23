-- 0009: Content approval workflow + AI usage metering

-- Add 'in_review' to the marketing item lifecycle:
--   draft → in_review → (approve: scheduled/draft) | (request changes: draft)
alter table public.marketing_items
  drop constraint marketing_items_status_check;
alter table public.marketing_items
  add constraint marketing_items_status_check
  check (status in ('draft','in_review','scheduled','publishing','published',
                    'partially_published','failed','archived'));

-- Per-org daily AI call counter (service-role managed; enforced in API routes)
create table public.ai_usage (
  org_id uuid not null references public.organizations(id) on delete cascade,
  day date not null default current_date,
  calls int not null default 0,
  primary key (org_id, day)
);

alter table public.ai_usage enable row level security;
create policy ai_usage_select on public.ai_usage
  for select using (is_org_member(org_id));
-- writes are service-role only (no insert/update policies)

create or replace function public.increment_ai_usage(p_org uuid)
returns int language sql security definer set search_path = public as $$
  insert into ai_usage (org_id, day, calls)
  values (p_org, current_date, 1)
  on conflict (org_id, day)
  do update set calls = ai_usage.calls + 1
  returning calls;
$$;

-- callable only with the service role
revoke execute on function public.increment_ai_usage(uuid) from public, anon, authenticated;
