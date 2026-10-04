-- 0081 — Better Auth 1.7 account table issuer column
--
-- Better Auth 1.7 introduced an `issuer` column on the `account` table
-- to scope account identity by issuer (e.g. 'local:credential' for password auth).
-- See: https://better-auth.com/docs/guides/1-7-upgrade-guide#account-identity-is-scoped-by-issuer

alter table "account" add column if not exists "issuer" text;
update "account" set "issuer" = 'local:credential' where "issuer" is null;
alter table "account" alter column "issuer" set not null;

create unique index if not exists "account_issuer_accountId_uidx"
  on "account" ("issuer", "accountId");
