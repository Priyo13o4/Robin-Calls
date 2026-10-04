-- Per-page latency.
--
-- The nginx JSON log carries `uri` and `request_time` on the SAME line, and
-- `parseLogLine` already returns both, but the ingest only ever pushed latency
-- into the hourly bucket. So the two facts existed in different tables and
-- could not be joined: analytics_rollups_hourly knew how slow the box was and
-- analytics_pages_daily knew which page was busy, and nothing knew which page
-- was slow.
--
-- `latency_samples` is not redundant with `pageviews`. Pageviews EXCLUDE bots
-- (audience metric) while latency counts every request the box actually served
-- (operational metric), so weighting the running average by pageviews would
-- drift whenever a batch's bot share changed, and divide by zero on an
-- all-bot batch. The merge in upsertPageDaily weights by this instead.
--
-- p95 merges with greatest(), which is an upper bound across batches rather
-- than a true percentile — the same approximation analytics_rollups_hourly
-- already makes, kept identical so the two columns mean the same thing.
alter table public.analytics_pages_daily
  add column if not exists avg_latency_ms numeric(8,2) not null default 0,
  add column if not exists p95_latency_ms numeric(8,2) not null default 0,
  add column if not exists latency_samples integer not null default 0;
