-- 0005: Competitor tracking

create table public.competitors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  notes text,
  niche text[] not null default '{}',
  destinations text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index competitors_org_idx on public.competitors(org_id);

create table public.competitor_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  competitor_id uuid not null references public.competitors(id) on delete cascade,
  platform text not null check (platform in
    ('facebook','instagram','x','tiktok','youtube','linkedin','pinterest')),
  handle text not null,
  external_id text,
  profile_url text,
  last_polled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (competitor_id, platform, handle)
);

create table public.competitor_snapshots (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  competitor_account_id uuid not null references public.competitor_accounts(id) on delete cascade,
  captured_at timestamptz not null default now(),
  followers int,
  following int,
  posts_count int,
  avg_engagement numeric,
  posting_frequency numeric,          -- posts/week (computed at poll time)
  source text not null default 'api' check (source in ('api','manual')),
  raw jsonb
);

create index cs_account_time_idx
  on public.competitor_snapshots(competitor_account_id, captured_at desc);

create table public.competitor_posts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  competitor_account_id uuid not null references public.competitor_accounts(id) on delete cascade,
  external_id text not null,
  posted_at timestamptz,
  content text,
  media_type text check (media_type in
    ('image','video','carousel','reel','short','text','link')),
  likes int, comments int, shares int, views bigint,
  hashtags text[] not null default '{}',
  destinations text[] not null default '{}',   -- AI-extracted
  raw jsonb,
  fetched_at timestamptz not null default now(),
  unique (competitor_account_id, external_id)
);

create index cp_account_time_idx
  on public.competitor_posts(competitor_account_id, posted_at desc);

-- ── RLS ──────────────────────────────────────────────────────────────
alter table public.competitors enable row level security;
alter table public.competitor_accounts enable row level security;
alter table public.competitor_snapshots enable row level security;
alter table public.competitor_posts enable row level security;

do $$
declare t text;
begin
  foreach t in array array['competitors','competitor_accounts'] loop
    execute format('create policy %I_select on public.%I for select using (is_org_member(org_id))', t, t);
    execute format('create policy %I_insert on public.%I for insert with check (has_org_role(org_id, array[''owner'',''admin'',''editor'']))', t, t);
    execute format('create policy %I_update on public.%I for update using (has_org_role(org_id, array[''owner'',''admin'',''editor'']))', t, t);
    execute format('create policy %I_delete on public.%I for delete using (has_org_role(org_id, array[''owner'',''admin'',''editor'']))', t, t);
  end loop;
end $$;

create policy csnap_select on public.competitor_snapshots
  for select using (is_org_member(org_id));
-- manual snapshot entry from the UI:
create policy csnap_insert_manual on public.competitor_snapshots
  for insert with check (
    source = 'manual' and has_org_role(org_id, array['owner','admin','editor'])
  );

create policy cposts_select on public.competitor_posts
  for select using (is_org_member(org_id));
