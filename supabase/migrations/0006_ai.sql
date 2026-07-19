-- 0006: AI strategies, recommendations, job observability

create table public.ai_strategies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in
    ('gap_analysis','content_plan','posting_schedule','competitor_report')),
  title text not null,
  summary text,
  input_snapshot jsonb,               -- exact data fed to the model (reproducibility)
  model text,
  provider text,
  status text not null default 'pending'
    check (status in ('pending','running','completed','failed')),
  error text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index strategies_org_idx on public.ai_strategies(org_id, created_at desc);

create table public.ai_recommendations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  strategy_id uuid not null references public.ai_strategies(id) on delete cascade,
  category text not null check (category in
    ('gap_destination','gap_content_type','gap_timing','gap_audience','gap_hashtag','action')),
  title text not null,
  rationale text,
  priority int not null default 3,
  suggested_action jsonb,             -- {create_item:{type,platforms,body_draft,hashtags,best_time}}
  status text not null default 'proposed'
    check (status in ('proposed','accepted','dismissed','done')),
  created_item_id uuid references public.marketing_items(id) on delete set null,
  created_at timestamptz not null default now()
);

create index recs_strategy_idx on public.ai_recommendations(strategy_id);

create table public.job_runs (
  id bigint generated always as identity primary key,
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  items_processed int not null default 0,
  error text
);

create index job_runs_job_idx on public.job_runs(job, started_at desc);

-- ── RLS ──────────────────────────────────────────────────────────────
alter table public.ai_strategies enable row level security;
alter table public.ai_recommendations enable row level security;
alter table public.job_runs enable row level security;
-- job_runs: service-role only (no policies)

create policy strat_select on public.ai_strategies
  for select using (is_org_member(org_id));
create policy strat_insert on public.ai_strategies
  for insert with check (has_org_role(org_id, array['owner','admin','editor']));
create policy strat_update on public.ai_strategies
  for update using (has_org_role(org_id, array['owner','admin','editor']));
create policy strat_delete on public.ai_strategies
  for delete using (has_org_role(org_id, array['owner','admin','editor']));

create policy recs_select on public.ai_recommendations
  for select using (is_org_member(org_id));
create policy recs_update on public.ai_recommendations
  for update using (has_org_role(org_id, array['owner','admin','editor']));
