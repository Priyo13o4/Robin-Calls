-- 0089 — persist each pons-v2 token's bonding-curve contract address
--
-- NOT a cost optimisation. Traced on prod 2026-09-06, three live CURVING
-- ponsv2 tokens against their own curve contracts' CurveBuy/CurveSell logs:
--
--   PORT      850 trades on chain, 267 recorded  -> 31.4%
--   CYBERMOG 1023 trades on chain, 572 recorded  -> 55.9%
--   MDMA      867 trades on chain, 608 recorded  -> 70.1%
--
-- Mechanism: `TokenLaunched` emits the per-token curve address ONCE and we
-- never stored it, so the adapter had to re-learn it from a live
-- `getLaunchedToken` factory read — which is bounded to a 300-token rotation
-- per tick (CURVE_STATE_READ_SWEEP) against 51,655 CURVING rows. A token's
-- trade logs are therefore fetched only in the tick its slot comes up, while
-- `launchpads.last_processed_block` advances every tick regardless. Everything
-- in between is skipped and never revisited.
--
-- What that corrupts: `buys`, `sells`, `raised_wei` (accumulated from deltas),
-- `progress_bps` and `peak_progress_bps` — all published, and `peak` is an
-- input to the §5.8 rug test. Silent at every layer: no error, no failing
-- test, because the tests assert shape and only the chain knows the count.
--
-- With the address on the row, the adapter maps curve -> token from the DB and
-- reads EVERY curving token's logs each tick instead of 0.6% of them.
--
-- Nullable on purpose: 51,655 existing rows have no address yet, and the
-- adapter backfills them on the same rotation that used to be the whole
-- mechanism. NULL therefore means "not yet learned", never "no curve" — a
-- distinction the adapter has to keep, because dropping a log whose curve we
-- cannot name is a lost trade, not an absent one (§4).
alter table "curve_tokens" add column if not exists "curve_address" text;

alter table "curve_tokens" drop constraint if exists "curve_tokens_curve_address_check";
alter table "curve_tokens" add constraint "curve_tokens_curve_address_check"
  check (curve_address is null or curve_address = lower(curve_address));

-- The hot path is the REVERSE lookup: a tick collects the curve addresses that
-- emitted logs and asks which tokens they belong to. Without this that is a
-- seq scan of the whole table, once a minute.
create index if not exists "curve_tokens_curve_address_idx"
  on "curve_tokens" using btree ("curve_address")
  where curve_address is not null;

-- Drives the backfill rotation, which must drain to empty and then cost nothing.
create index if not exists "curve_tokens_curve_backfill_idx"
  on "curve_tokens" using btree ("launchpad_id")
  where curve_address is null and status = 'CURVING';

comment on column "curve_tokens"."curve_address" is
  'pons-v2 per-token bonding curve (TokenLaunched.curve), lowercased. NULL = not yet learned, never "no curve". Written by lib/tracker/curves/adapters/pons-v2.ts.';
