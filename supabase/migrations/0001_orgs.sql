-- 0001: Tenancy — organizations, members, profiles + RLS helpers

create extension if not exists pgcrypto;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  timezone text not null default 'UTC',
  industry_niche text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.org_members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'viewer'
    check (role in ('owner','admin','editor','viewer')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  default_org_id uuid references public.organizations(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ── RLS helpers ──────────────────────────────────────────────────────
create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from org_members
    where org_id = p_org and user_id = auth.uid()
  )
$$;

create or replace function public.has_org_role(p_org uuid, p_roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from org_members
    where org_id = p_org and user_id = auth.uid() and role = any(p_roles)
  )
$$;

-- ── RLS ──────────────────────────────────────────────────────────────
alter table public.organizations enable row level security;
alter table public.org_members enable row level security;
alter table public.profiles enable row level security;

create policy org_select on public.organizations
  for select using (is_org_member(id));
create policy org_insert on public.organizations
  for insert with check (auth.uid() is not null);
create policy org_update on public.organizations
  for update using (has_org_role(id, array['owner','admin']));
create policy org_delete on public.organizations
  for delete using (has_org_role(id, array['owner']));

create policy members_select on public.org_members
  for select using (is_org_member(org_id));
create policy members_insert on public.org_members
  for insert with check (
    has_org_role(org_id, array['owner','admin'])
    -- bootstrap: first member of a brand-new org may add themselves as owner
    or (user_id = auth.uid() and role = 'owner'
        and not exists (select 1 from org_members m where m.org_id = org_members.org_id))
  );
create policy members_update on public.org_members
  for update using (has_org_role(org_id, array['owner','admin']));
create policy members_delete on public.org_members
  for delete using (has_org_role(org_id, array['owner','admin']) or user_id = auth.uid());

create policy profiles_select on public.profiles
  for select using (true);
create policy profiles_upsert on public.profiles
  for insert with check (id = auth.uid());
create policy profiles_update on public.profiles
  for update using (id = auth.uid());

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
