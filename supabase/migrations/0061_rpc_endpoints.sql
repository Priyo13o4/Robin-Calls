-- Move the RPC provider pool out of `RPC_ENDPOINTS_JSON` and into a table the
-- operator can edit at /admin/rpc, with a per-endpoint enable switch.
--
-- WHY. KNOWN-PROBLEMS L19: an exhausted Alchemy key 429'd every call for 12h.
-- The circuit breaker's job is "this provider is sick, skip it for 60s" — it
-- has no tier for "this provider is out of quota until the 1st of next month",
-- so it re-probes a dead endpoint every minute for the rest of the billing
-- period. That is not a breaker bug; a breaker cannot know a billing cycle.
-- The missing control is an OPERATOR one, and it lived in a gitignored file on
-- the VM behind a container restart. `enabled = false` is that control.
--
-- THE EMPTY TABLE IS NOT AN EMPTY POOL (CLAUDE.md §4). This migration creates
-- the table with NO rows, and `lib/config/rpc-endpoints.ts` reads zero rows as
-- "the operator has not configured this yet" and falls through to the env
-- seed — never as "there are no providers". The seed is a one-time import
-- (admin action, or `seedRpcEndpointsFromEnv`), after which RPC_ENDPOINTS_JSON
-- can be deleted from .env.production.
--
-- SECRETS. `url` holds an Alchemy key in its path and a Goldsky `?secret=`.
-- That is a real change of blast radius: those strings now appear in DB
-- backups and in an admin form. It is the direct cost of making the pool
-- operator-editable without a deploy, and the addresses are already on the
-- same host in .env.production. Nothing outside `lib/data/rpc-endpoints.ts`
-- may select `url` — the readiness/observability surfaces take `id` only, and
-- `rpc_endpoints_public` below exists so they cannot accidentally take more.

create table if not exists rpc_endpoints (
  id                       text primary key,
  url                      text not null,
  enabled                  boolean not null default true,
  -- Ties in the pool's ranking break on config order; this is that order.
  sort_order               integer not null default 100,

  max_cu_per_second        integer,
  max_requests_per_second  integer,
  max_concurrent_requests  integer,

  -- Soft ordering hint (jump the queue for these methods).
  prefer_methods           text[] not null default '{}',
  -- Hard routing constraints. NULL max_log_span = unbounded, which is a real
  -- and different claim from 0 — do not default it.
  max_log_span             integer,
  deny_methods             text[] not null default '{}',
  allow_methods            text[] not null default '{}',

  -- Why this endpoint is off, shown in /admin/rpc. An operator disabling a
  -- provider six weeks ago must be able to tell "quota resets Sep 1" from
  -- "this thing lies about maxLogSpan".
  note                     text,
  disabled_at              timestamptz,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  updated_by               text,

  -- Guard what parseEndpointConfig would otherwise throw on at runtime, and a
  -- throw there takes down every scan in the process. Inline rather than a
  -- later ALTER: `create table if not exists` is re-runnable, `add constraint`
  -- is not, and the deploy applies migrations without a trustworthy ledger
  -- (docs/KNOWN-PROBLEMS — schema_migrations has lied before).
  constraint rpc_endpoints_url_http check (url ~ '^https?://'),
  constraint rpc_endpoints_positive_limits check (
    (max_cu_per_second       is null or max_cu_per_second       > 0) and
    (max_requests_per_second is null or max_requests_per_second > 0) and
    (max_concurrent_requests is null or max_concurrent_requests > 0) and
    (max_log_span            is null or max_log_span            > 0)
  )
);

create index if not exists rpc_endpoints_enabled_order_idx
  on rpc_endpoints (enabled, sort_order);

-- Everything that is NOT the secret. Readiness endpoints, observability and
-- any future non-admin surface read this, so "I only needed the id" cannot
-- turn into a leaked key by way of a `select *`.
create or replace view rpc_endpoints_public as
  select id, enabled, sort_order, max_cu_per_second, max_requests_per_second,
         max_concurrent_requests, prefer_methods, max_log_span,
         deny_methods, allow_methods, note, disabled_at, updated_at, updated_by
  from rpc_endpoints;
