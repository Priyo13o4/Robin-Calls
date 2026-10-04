-- Migration 0106: social links on the sale leaderboards (docs/prds/REFERRALS.md).
-- Additive. Stored as [{"provider":"x","url":"https://x.com/..."}], at most 3,
-- cleaned by lib/referrals/socials.ts before it gets here. The check is the
-- backstop for a writer that skips the cleaner.

alter table sale_participants
  add column if not exists socials jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sale_participants_socials_shape') then
    alter table sale_participants
      add constraint sale_participants_socials_shape
      check (jsonb_typeof(socials) = 'array' and jsonb_array_length(socials) <= 3);
  end if;
end $$;
