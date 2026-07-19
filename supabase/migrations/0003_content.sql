-- 0003: Marketing content — campaigns, items, per-platform targets, media

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  objective text check (objective in ('awareness','engagement','bookings','seasonal')),
  destination text,
  tour_package text,
  start_date date,
  end_date date,
  budget numeric,
  status text not null default 'draft'
    check (status in ('draft','active','paused','completed','archived')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index campaigns_org_idx on public.campaigns(org_id);

create table public.marketing_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  type text not null default 'social_post'
    check (type in ('social_post','promotion','announcement','email')),
  title text not null,
  body text not null default '',
  media jsonb not null default '[]',   -- [{storage_path,type,width,height,duration}]
  promo jsonb,                         -- {discount_pct,promo_code,valid_from,valid_until,package_name}
  hashtags text[] not null default '{}',
  destination text,
  status text not null default 'draft'
    check (status in ('draft','scheduled','publishing','published',
                      'partially_published','failed','archived')),
  scheduled_at timestamptz,
  timezone text,
  ai_generated boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index items_org_idx on public.marketing_items(org_id);
create index items_sched_idx on public.marketing_items(scheduled_at)
  where status = 'scheduled';

create table public.post_targets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  item_id uuid not null references public.marketing_items(id) on delete cascade,
  social_account_id uuid not null references public.social_accounts(id) on delete cascade,
  platform text not null,
  variant_body text,
  variant_media jsonb,
  status text not null default 'pending'
    check (status in ('pending','queued','publishing','published','failed','skipped')),
  external_post_id text,
  external_url text,
  published_at timestamptz,
  error text,
  retry_count int not null default 0,
  next_retry_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_id, social_account_id)
);

create index targets_item_idx on public.post_targets(item_id);
create index targets_due_idx on public.post_targets(status, next_retry_at);

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  storage_path text not null,          -- Supabase Storage bucket 'media'
  mime_type text not null,
  size_bytes bigint,
  width int,
  height int,
  duration_seconds numeric,
  alt_text text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index media_org_idx on public.media_assets(org_id);

-- ── RLS ──────────────────────────────────────────────────────────────
alter table public.campaigns enable row level security;
alter table public.marketing_items enable row level security;
alter table public.post_targets enable row level security;
alter table public.media_assets enable row level security;

do $$
declare t text;
begin
  foreach t in array array['campaigns','marketing_items','post_targets','media_assets'] loop
    execute format('create policy %I_select on public.%I for select using (is_org_member(org_id))', t, t);
    execute format('create policy %I_insert on public.%I for insert with check (has_org_role(org_id, array[''owner'',''admin'',''editor'']))', t, t);
    execute format('create policy %I_update on public.%I for update using (has_org_role(org_id, array[''owner'',''admin'',''editor'']))', t, t);
    execute format('create policy %I_delete on public.%I for delete using (has_org_role(org_id, array[''owner'',''admin'',''editor'']))', t, t);
  end loop;
end $$;

-- updated_at maintenance
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger campaigns_touch before update on public.campaigns
  for each row execute function public.touch_updated_at();
create trigger items_touch before update on public.marketing_items
  for each row execute function public.touch_updated_at();
create trigger targets_touch before update on public.post_targets
  for each row execute function public.touch_updated_at();
create trigger social_accounts_touch before update on public.social_accounts
  for each row execute function public.touch_updated_at();
