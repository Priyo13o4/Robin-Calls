-- ─────────────────────────────────────────────────────────────
-- 0023 — eligibility is now X-only. Telegram no longer grants
--        allocation eligibility (team decision, 2026-07-18).
--
-- Telegram stays a FULLY functional path: identity is still verified
-- via the Login Widget, group membership is still confirmed with
-- getChatMember, the one-account-one-spot dedupe index is untouched,
-- and telegram_chat_member keeps being recorded. Telegram now serves
-- community reach + wallet social-recovery — it just does not flip
-- `eligible`. This may be reverted if the team re-enables TG eligibility.
--
--   Membership  = has a wallet row (unchanged).
--   Eligibility = twitter_user_id present (verified via the X path).
--
-- `eligible` is a GENERATED column, so its expression can't be altered
-- in place — drop and re-add (values are recomputed, no data loss), then
-- recreate the dependent index that the drop removes with it.
-- ─────────────────────────────────────────────────────────────

drop index if exists public.whitelist_members_eligible_idx;

alter table public.whitelist_members
  drop column if exists eligible;

alter table public.whitelist_members
  add column eligible boolean
    generated always as (
      -- X-only. Previous formula (0022), kept for the future revert:
      --   twitter_user_id is not null or telegram_chat_member
      twitter_user_id is not null
    ) stored;

create index if not exists whitelist_members_eligible_idx
  on public.whitelist_members (eligible);
