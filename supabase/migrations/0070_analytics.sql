-- First-party traffic analytics (PRD: docs/ways-of-work/plan/first-party-analytics/PRD.md)
--
-- Six tables for edge-driven analytics. Raw IPs never reach these tables;
-- unique-visitor counting uses daily-salted HMAC hashes computed at ingest time.
-- Queries hit pre-aggregated rollups, so the dashboard is sub-10ms.

-- 1. Ingest state & log cursor tracker (single-row table)
-- The ingest job reads the nginx analytics log from a byte offset. On log
-- rotation (inode change), it drains the old file and resets the cursor.
create table if not exists public.analytics_ingest_state (
  id integer primary key default 1,
  file_inode bigint not null,
  byte_offset bigint not null default 0,
  last_ingested_at timestamptz not null default now(),
  constraint single_row check (id = 1)
);

-- 2. Hourly timeseries rollups
-- Primary dashboard query target. One row per UTC hour with views, UVs,
-- latency percentiles, bytes, and status-code buckets.
create table if not exists public.analytics_rollups_hourly (
  bucket_hour timestamptz primary key,
  pageviews integer not null default 0,
  unique_visitors integer not null default 0,
  bytes_transferred bigint not null default 0,
  avg_latency_ms numeric(8, 2) not null default 0,
  p95_latency_ms numeric(8, 2) not null default 0,
  status_2xx integer not null default 0,
  status_3xx integer not null default 0,
  status_4xx integer not null default 0,
  status_5xx integer not null default 0
);
create index if not exists idx_analytics_rollups_hour
  on public.analytics_rollups_hourly (bucket_hour desc);

-- 3. Daily top pages / endpoints
-- Composite PK on (date, normalized_path). Route normalization collapses
-- /scan/0x... to /scan/[address] to prevent high-cardinality explosion.
create table if not exists public.analytics_pages_daily (
  bucket_date date not null,
  normalized_path text not null,
  pageviews integer not null default 0,
  unique_visitors integer not null default 0,
  primary key (bucket_date, normalized_path)
);
create index if not exists idx_analytics_pages_date
  on public.analytics_pages_daily (bucket_date desc, pageviews desc);

-- 4. Daily referrers
create table if not exists public.analytics_referrers_daily (
  bucket_date date not null,
  referrer_domain text not null,
  hits integer not null default 0,
  primary key (bucket_date, referrer_domain)
);

-- 5. Daily geographic distribution
create table if not exists public.analytics_countries_daily (
  bucket_date date not null,
  country_code varchar(4) not null,
  pageviews integer not null default 0,
  unique_visitors integer not null default 0,
  primary key (bucket_date, country_code)
);

-- 6. Daily device & browser breakdown
create table if not exists public.analytics_devices_daily (
  bucket_date date not null,
  device_type varchar(16) not null,  -- desktop, mobile, tablet, bot
  browser varchar(32) not null,      -- Chrome, Safari, Firefox, Edge, etc.
  os varchar(32) not null,           -- macOS, iOS, Windows, Android, Linux
  hits integer not null default 0,
  primary key (bucket_date, device_type, browser, os)
);

-- 7. Analytics ingest cron schedule (1-minute cadence)
-- Near-realtime dashboard metrics with small batch sizes (~100–500 lines/min).
-- Uses rc_schedule_job (0010) if present in the database.
do $$
begin
  if exists (select 1 from pg_proc where proname = 'rc_schedule_job') then
    perform public.rc_schedule_job(
      'robincalls-analytics-ingest',
      '* * * * *',
      '/api/jobs/analytics-ingest'
    );
  end if;
end $$;

