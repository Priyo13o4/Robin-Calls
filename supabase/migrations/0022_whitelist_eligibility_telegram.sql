-- ─────────────────────────────────────────────────────────────
-- 0022 — decouple ELIGIBILITY from membership; add Telegram as a
--        second verified social identity.
--
-- Requirement change: X is no longer compulsory (Chinese users, among
-- others, can't use X). Anyone with a wallet can join, but allocation
-- eligibility requires at least one VERIFIED social identity:
--   • X account (twitter_user_id set — bound only after the X path), OR
--   • Telegram account that is a confirmed member of our group.
--
-- Membership  = has a wallet row (unchanged).
-- Eligibility = twitter_user_id present OR telegram group-membership verified.
--               Stored as a GENERATED column so it can never drift from the
--               underlying identity columns.
-- ─────────────────────────────────────────────────────────────

alter table public.whitelist_members
  -- Telegram identity (Login Widget payload; HMAC-verified with the bot token).
  add column if not exists telegram_user_id      text,
  add column if not exists telegram_username     text,
  add column if not exists telegram_first_name   text,
  add column if not exists telegram_connected_at timestamptz,
  -- Verified-membership gate: true only after getChatMember confirms the user
  -- is actually in our Telegram group (status member/administrator/creator).
  add column if not exists telegram_chat_member  boolean not null default false,
  add column if not exists telegram_membership_checked_at timestamptz;

-- One Telegram account = one whitelist spot (mirrors the 0021 X dedupe).
create unique index if not exists whitelist_members_telegram_user_id_key
  on public.whitelist_members (telegram_user_id)
  where telegram_user_id is not null;

-- Allocation eligibility — computed, always consistent. X binding only ever
-- happens after the tasks complete, so twitter_user_id implies "verified via
-- X"; Telegram requires the confirmed group membership flag.
alter table public.whitelist_members
  add column if not exists eligible boolean
    generated always as (
      twitter_user_id is not null or telegram_chat_member
    ) stored;

-- Fast filters for the future allocation snapshot / admin views.
create index if not exists whitelist_members_eligible_idx
  on public.whitelist_members (eligible);
