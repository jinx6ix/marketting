-- 0004: Monitoring — metric snapshots (time-series), keywords, mentions

create table public.account_metric_snapshots (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  social_account_id uuid not null references public.social_accounts(id) on delete cascade,
  captured_at timestamptz not null default now(),
  followers int,
  following int,
  posts_count int,
  impressions bigint,
  reach bigint,
  profile_views int,
  engagement_total bigint,
  raw jsonb
);

create index ams_account_time_idx
  on public.account_metric_snapshots(social_account_id, captured_at desc);

create table public.post_metric_snapshots (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  post_target_id uuid not null references public.post_targets(id) on delete cascade,
  captured_at timestamptz not null default now(),
  likes int,
  comments int,
  shares int,
  saves int,
  impressions bigint,
  reach bigint,
  video_views bigint,
  engagement_rate numeric,
  raw jsonb
);

create index pms_target_time_idx
  on public.post_metric_snapshots(post_target_id, captured_at desc);

create table public.tracked_keywords (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  keyword text not null,
  kind text not null default 'keyword'
    check (kind in ('hashtag','keyword','destination','brand')),
  platforms text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (org_id, keyword, kind)
);

create table public.mentions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  social_account_id uuid references public.social_accounts(id) on delete set null,
  platform text not null,
  kind text not null default 'mention'
    check (kind in ('mention','comment','keyword_match','review')),
  keyword_id uuid references public.tracked_keywords(id) on delete set null,
  external_id text not null,
  author_handle text,
  author_name text,
  author_avatar_url text,
  content text,
  external_url text,
  sentiment text check (sentiment in ('positive','neutral','negative')),
  occurred_at timestamptz,
  fetched_at timestamptz not null default now(),
  is_read boolean not null default false,
  replied boolean not null default false,
  raw jsonb,
  unique (org_id, platform, external_id, kind)
);

create index mentions_org_time_idx on public.mentions(org_id, occurred_at desc);
create index mentions_unread_idx on public.mentions(org_id) where not is_read;

-- ── RLS ──────────────────────────────────────────────────────────────
alter table public.account_metric_snapshots enable row level security;
alter table public.post_metric_snapshots enable row level security;
alter table public.tracked_keywords enable row level security;
alter table public.mentions enable row level security;

create policy ams_select on public.account_metric_snapshots
  for select using (is_org_member(org_id));
create policy pms_select on public.post_metric_snapshots
  for select using (is_org_member(org_id));
-- snapshots are written by service-role jobs only (no insert policies)

create policy kw_all_select on public.tracked_keywords
  for select using (is_org_member(org_id));
create policy kw_write on public.tracked_keywords
  for insert with check (has_org_role(org_id, array['owner','admin','editor']));
create policy kw_update on public.tracked_keywords
  for update using (has_org_role(org_id, array['owner','admin','editor']));
create policy kw_delete on public.tracked_keywords
  for delete using (has_org_role(org_id, array['owner','admin','editor']));

create policy mentions_select on public.mentions
  for select using (is_org_member(org_id));
create policy mentions_update on public.mentions
  for update using (is_org_member(org_id));   -- mark read / replied
