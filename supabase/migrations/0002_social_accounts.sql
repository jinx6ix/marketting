-- 0002: Connected social accounts (encrypted tokens) + OAuth state

create table public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  platform text not null check (platform in
    ('facebook','instagram','x','tiktok','youtube','linkedin','pinterest')),
  external_id text not null,          -- page id / IG business id / channel id / etc.
  handle text,
  display_name text,
  avatar_url text,
  access_token_enc text,              -- AES-256-GCM: base64(iv|ciphertext|tag)
  refresh_token_enc text,
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  status text not null default 'active'
    check (status in ('active','expired','revoked','error')),
  connected_by uuid references auth.users(id),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, platform, external_id)
);

create index social_accounts_org_idx on public.social_accounts(org_id);

create table public.oauth_states (
  state text primary key,
  org_id uuid not null,
  user_id uuid not null,
  platform text not null,
  code_verifier text,                 -- PKCE (x, tiktok, pinterest)
  redirect_to text,
  expires_at timestamptz not null
);

-- ── RLS ──────────────────────────────────────────────────────────────
alter table public.social_accounts enable row level security;
alter table public.oauth_states enable row level security;
-- oauth_states: service-role only (no policies for authenticated)

create policy sa_select on public.social_accounts
  for select using (is_org_member(org_id));
create policy sa_insert on public.social_accounts
  for insert with check (has_org_role(org_id, array['owner','admin','editor']));
create policy sa_update on public.social_accounts
  for update using (has_org_role(org_id, array['owner','admin','editor']));
create policy sa_delete on public.social_accounts
  for delete using (has_org_role(org_id, array['owner','admin']));

-- Token custody: browser/authenticated role can NEVER read token columns.
revoke select (access_token_enc, refresh_token_enc)
  on public.social_accounts from authenticated, anon;
