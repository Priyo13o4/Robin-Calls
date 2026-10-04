-- Add covering performance indexes for daily analytics breakdowns
-- Accelerates date-range filtering and descending rank sorting for pages, referrers, countries, and devices.

create index if not exists idx_analytics_devices_date_hits
  on public.analytics_devices_daily (bucket_date desc, hits desc);

create index if not exists idx_analytics_countries_date_views
  on public.analytics_countries_daily (bucket_date desc, pageviews desc);

create index if not exists idx_analytics_referrers_date_hits
  on public.analytics_referrers_daily (bucket_date desc, hits desc);
