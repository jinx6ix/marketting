-- AI vision analysis of an item's media (see src/lib/ai/media-insights.ts).
-- Shape: { analyzed_at, results: [{ media_index, type, insight?, model?, skipped? }] }
alter table public.marketing_items
  add column if not exists media_insights jsonb;
