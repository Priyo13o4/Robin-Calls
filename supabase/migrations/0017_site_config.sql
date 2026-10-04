-- ─────────────────────────────────────────────────────────────
-- RobinCalls — site_config: small key/value store for values an admin
-- needs to change without a code deploy (e.g. the X pinned-post link the
-- whitelist flow points at).
--
-- Written/read only by the server through the private application DB
-- connection. The public /api/site-config route exposes only the whitelisted,
-- non-sensitive keys.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.site_config (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now(),
  updated_by text
);

-- Seed the X links the whitelist modal uses. on conflict do nothing so a
-- re-run never clobbers an admin-edited value.
insert into public.site_config (key, value) values
  ('x_profile_url',     'https://x.com/RobinCalls'),
  ('x_pinned_post_url', 'https://x.com/RobinCalls')
on conflict (key) do nothing;
