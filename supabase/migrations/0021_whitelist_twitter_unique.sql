-- ─────────────────────────────────────────────────────────────
-- 0021 — one X account, one whitelist spot
--
-- wallet_address was already UNIQUE (0012), so one wallet = one row. But
-- twitter_user_id had only a lookup index, so the same X account could be
-- bound to two different wallets — duplicate Twitters on the list. This adds
-- the missing hard guarantee: a PARTIAL unique index on the OAuth-verified
-- twitter_user_id (partial so the many rows that never finish OAuth — NULL
-- id — don't collide with each other).
--
-- We intentionally do NOT make twitter_username unique: handles are mutable
-- and self-reported in the V1 flow, while twitter_user_id is the stable,
-- OAuth-verified identity. The app also checks this before writing (nicer
-- error), but the index is the race-proof backstop.
-- ─────────────────────────────────────────────────────────────

create unique index if not exists whitelist_members_twitter_user_id_key
  on public.whitelist_members (twitter_user_id)
  where twitter_user_id is not null;
