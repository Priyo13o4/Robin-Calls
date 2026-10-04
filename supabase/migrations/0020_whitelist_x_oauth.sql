-- ─────────────────────────────────────────────────────────────
-- 0020 — Whitelist X OAuth 2.0: verified social tasks.
--
-- V1 (migration 0012) linked a self-reported X handle and took the social
-- tasks on trust. This upgrades step 2 to VERIFIED actions performed through
-- the user's own OAuth 2.0 authorization (follow @RobinCalls, like the pinned
-- post, post the onboarding tweet). The reserved columns twitter_user_id /
-- twitter_connected_at / twitter_oauth_provider (already in 0012) now get
-- populated; these booleans record which actions were confirmed by the X API.
--
-- Tokens are deliberately NOT stored here — they live only in the encrypted,
-- short-lived onboarding cookie (lib/x/session.ts) and expire with it.
-- ─────────────────────────────────────────────────────────────

alter table public.whitelist_members
  add column if not exists x_followed        boolean not null default false,
  add column if not exists x_liked           boolean not null default false,
  add column if not exists x_posted          boolean not null default false,
  add column if not exists x_posted_tweet_id text;

-- New rows default to the OAuth policy; existing rows keep their recorded
-- version so an old '1.0' receipt stays re-derivable against the rules that
-- produced it.
alter table public.whitelist_members
  alter column social_steps_policy_version set default '2.0-oauth';
