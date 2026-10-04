-- ─────────────────────────────────────────────────────────────
-- Directory form upgrade (docs/directory-form-research.md):
--  1. category_details jsonb — per-category optional facts collected by the
--     submission form (launch model/fees, custody model, MCP endpoint, …),
--     validated server-side against lib/config/directory.ts.
--  2. Category taxonomy widened 4 → 13. Legacy values are remapped
--     (AGENT → AI, INFRA → INFRASTRUCTURE) before the new check lands.
-- ─────────────────────────────────────────────────────────────

alter table public.directory_platforms
  add column if not exists category_details jsonb not null default '{}'::jsonb;

-- The old check (category in LAUNCHPAD/AGENT/ANALYTICS/INFRA) would reject the
-- remap, so drop first, remap, then install the 13-value check.
alter table public.directory_platforms
  drop constraint if exists directory_platforms_category_check;

update public.directory_platforms set category = 'AI'             where category = 'AGENT';
update public.directory_platforms set category = 'INFRASTRUCTURE' where category = 'INFRA';

alter table public.directory_platforms
  add constraint directory_platforms_category_check check (category in (
    'LAUNCHPAD', 'TRADING', 'WALLET', 'DEFI', 'AI', 'NFT', 'GAMING',
    'ANALYTICS', 'DEVTOOLS', 'INFRASTRUCTURE', 'PAYMENTS', 'SECURITY', 'SOCIAL'
  ));
