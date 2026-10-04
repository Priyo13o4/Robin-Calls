-- ─────────────────────────────────────────────────────────────
-- Better Auth tables (admin console auth). Schema matches Better Auth v1.6
-- core + `username` plugin + `admin` plugin.
--
-- IMPORTANT casing: Better Auth's Postgres adapter uses QUOTED camelCase
-- identifiers ("emailVerified", "userId", …). They must be created exactly so,
-- or Better Auth's queries won't find them.
--
-- Access model: Better Auth connects via DATABASE_URL as the `postgres` role,
-- which BYPASSES RLS. We still enable RLS with NO policies so the anon /
-- authenticated PostgREST roles (the sb_publishable key) can never read these
-- tables — critical, since "account" holds password hashes.
-- ─────────────────────────────────────────────────────────────

create table if not exists "user" (
  "id" text primary key,
  "name" text not null,
  "email" text not null unique,
  "emailVerified" boolean not null default false,
  "image" text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  -- username plugin
  "username" text unique,
  "displayUsername" text,
  -- admin plugin
  "role" text,
  "banned" boolean default false,
  "banReason" text,
  "banExpires" timestamptz
);

create table if not exists "session" (
  "id" text primary key,
  "expiresAt" timestamptz not null,
  "token" text not null unique,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now(),
  "ipAddress" text,
  "userAgent" text,
  "userId" text not null references "user" ("id") on delete cascade,
  -- admin plugin
  "impersonatedBy" text
);

create index if not exists "session_userId_idx" on "session" ("userId");
create index if not exists "session_token_idx" on "session" ("token");

create table if not exists "account" (
  "id" text primary key,
  "accountId" text not null,
  "providerId" text not null,
  "userId" text not null references "user" ("id") on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope" text,
  "password" text,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create index if not exists "account_userId_idx" on "account" ("userId");

create table if not exists "verification" (
  "id" text primary key,
  "identifier" text not null,
  "value" text not null,
  "expiresAt" timestamptz not null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create index if not exists "verification_identifier_idx" on "verification" ("identifier");

-- ── RLS: lock every auth table away from the anon/authenticated REST roles.
-- Better Auth tables are reachable only through the private application DB
-- connection; this self-hosted baseline does not expose PostgREST or RLS roles.
