-- 0007: Storage bucket, Realtime publications, analytics views

-- Media bucket (public read; writes via authenticated policies)
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;

create policy "media_org_read" on storage.objects
  for select using (bucket_id = 'media');
create policy "media_org_insert" on storage.objects
  for insert with check (
    bucket_id = 'media' and auth.role() = 'authenticated'
  );
create policy "media_org_delete" on storage.objects
  for delete using (
    bucket_id = 'media' and auth.role() = 'authenticated'
  );

-- Realtime: live inbox + calendar status updates
alter publication supabase_realtime add table public.mentions;
alter publication supabase_realtime add table public.post_targets;

-- ── Views ────────────────────────────────────────────────────────────

-- Daily follower series per account (latest snapshot per day)
create or replace view public.v_follower_growth
with (security_invoker = true) as
select distinct on (social_account_id, date_trunc('day', captured_at))
  org_id,
  social_account_id,
  date_trunc('day', captured_at)::date as day,
  followers,
  engagement_total
from public.account_metric_snapshots
order by social_account_id, date_trunc('day', captured_at), captured_at desc;

-- Engagement by weekday/hour for own published posts → best-posting-times heatmap
create or replace view public.v_engagement_by_hour
with (security_invoker = true) as
select
  pt.org_id,
  pt.platform,
  extract(dow from pt.published_at)::int as dow,
  extract(hour from pt.published_at)::int as hour,
  count(distinct pt.id) as posts,
  avg(pms.engagement_rate) as avg_engagement_rate,
  sum(coalesce(pms.likes,0) + coalesce(pms.comments,0) + coalesce(pms.shares,0)) as total_engagement
from public.post_targets pt
join lateral (
  select * from public.post_metric_snapshots s
  where s.post_target_id = pt.id
  order by s.captured_at desc limit 1
) pms on true
where pt.status = 'published' and pt.published_at is not null
group by 1, 2, 3, 4;

-- Latest metric snapshot per connected account (KPI tiles)
create or replace view public.v_account_latest_metrics
with (security_invoker = true) as
select distinct on (social_account_id)
  org_id, social_account_id, captured_at,
  followers, following, posts_count, impressions, reach, engagement_total
from public.account_metric_snapshots
order by social_account_id, captured_at desc;

-- Latest snapshot per competitor account
create or replace view public.v_competitor_latest
with (security_invoker = true) as
select distinct on (competitor_account_id)
  org_id, competitor_account_id, captured_at,
  followers, posts_count, avg_engagement, posting_frequency
from public.competitor_snapshots
order by competitor_account_id, captured_at desc;
