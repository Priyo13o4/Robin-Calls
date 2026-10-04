-- 0090 — the referral plane, in one file.
--
-- Design: docs/prds/TOKEN-SALE-INTENT.md §10. Work list:
-- docs/prds/REFERRALS-OPEN-ISSUES.md issues 21, 29, 39, 40, 41, 44, 47.
--
-- ===================================================================
-- Why this is one file, and why 0087 is NOT in it
-- ===================================================================
-- This replaces six files written across three days (the census claim tables,
-- the ordering rework, the refund mirror, the snapshot completeness columns, a
-- board index, and the commission rework). None of them was ever committed, so
-- none has ever run anywhere except the local Docker stack, and collapsing them
-- costs nothing and removes five intermediate shapes nobody needs to read.
--
-- `0087_sale_referrals.sql` is a different case and stays exactly where it is.
-- It is committed and it is APPLIED IN PRODUCTION (verified 2026-09-11 by
-- information_schema: all six of its tables exist, all with zero rows). Folding
-- it in here would mean editing an applied migration, which is the one thing
-- CLAUDE.md §10 forbids and which issues 25 and 35 are both instances of. The
-- ledger would carry a checksum for text that database never ran.
--
-- So the division is: 0087 is the referral plane as first built, this file is
-- everything it became. Migrations are ordered, so 0087 always precedes this
-- one and every table it references is guaranteed to exist below.
--
-- Every statement here is idempotent, because the local stack has already run
-- the six files this replaces and will run this one afterwards under its new
-- name. Re-running against the finished shape must be a no-op, not an error.

-- ===================================================================
-- 1. The claim table: what a browser tells us, and what we found
-- ===================================================================
-- Companion to the census reads that replaced the log walker.
--
-- The browser supplies a POINTER (a transaction hash), never a claim. Every
-- fact that follows — receipt exists, status success, a Contributed log from
-- the sale address, the log's contributor matches the claiming wallet — is
-- read by the server, independently, from the chain.
--
-- THREE verdict states, never two (CLAUDE.md §4): a claim stays `pending` on
-- any outcome we could not measure. A refused claim is a definitive chain
-- answer (reverted / wrong contract / the log names a different contributor),
-- and only the chain can write it.
--
--   pending   recorded, not yet verified — retried by the reconciler
--   verified  the chain confirmed it; the contribution and any referral code
--             have been issued
--   refused   the chain answered definitively that this is not this wallet's
--             contribution
create table if not exists sale_contribution_claims (
  id            bigint generated always as identity primary key,

  -- What the browser submitted. The unique key: resubmitting the same hash is
  -- the ordinary case (page reload, double click, the reconciler's retry), and
  -- it must never double-credit.
  tx_hash       text not null,
  wallet_address text not null,

  -- THREE states. `pending` is the only state an RPC failure may produce; the
  -- reconciler retries pendings forever. No give-up cap exists by design.
  verdict       text not null default 'pending',

  verified_at   timestamptz,
  refused_because text,

  attempts      integer not null default 0,
  last_attempt_at timestamptz,
  created_at    timestamptz not null default now(),

  constraint sale_contribution_claims_wallet_lower
    check (wallet_address = lower(wallet_address)),
  constraint sale_contribution_claims_tx_shape
    check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  constraint sale_contribution_claims_verdict_values
    check (verdict in ('pending', 'verified', 'refused')),
  -- A verdict is dated or absent, never one without the other: a `refused`
  -- with no sentence is an accusation with no mechanism, and a `verified`
  -- with no timestamp cannot be ordered against anything.
  constraint sale_contribution_claims_verdict_paired
    check ((verdict = 'pending') = (verified_at is null)),
  constraint sale_contribution_claims_refusal_paired
    check ((verdict = 'refused') = (refused_because is not null))
);

-- One row per transaction hash. The browser posts the same hash on every retry
-- and the reconciler re-examines the same rows: idempotency is the database's
-- job, not the caller's memory.
create unique index if not exists sale_contribution_claims_tx_unique
  on sale_contribution_claims (tx_hash);

create index if not exists sale_contribution_claims_pending_idx
  on sale_contribution_claims (created_at)
  where verdict = 'pending';

-- ===================================================================
-- 2. The census mirror: one row per wallet the contract knows paid
-- ===================================================================
-- The contract's own `contributed(wallet)` total, refreshed by the reconciler
-- every cycle the sale moves. This is the AMOUNT source for the leaderboard,
-- wallet totals and the snapshot population — the census is the authority on
-- amounts, while `sale_contributions` (0087) keeps the per-transaction facts
-- (tx hash, block, log index) that verified claims provide.
--
-- A wallet is present here iff the contract's census has it, i.e. it paid.
-- That by-construction property replaces the `join sale_contributions` that
-- used to enforce "actually paid" in the referrer reads.
create table if not exists sale_wallet_totals (
  wallet_address       text primary key,
  -- The contract's CURRENT contributed(wallet) at the last reconciler pass.
  -- Top-ups change it; the reconciler re-reads known wallets whenever
  -- totalRaised moves. Never a value this table cached on its own.
  contributed_wei      numeric(78, 0) not null,
  -- The census array slot the wallet occupies. Push order == first-
  -- contribution order, and the index is how the reconciler knows which
  -- entries are new.
  census_index         bigint not null,
  -- The head block of the pass that FIRST saw this wallet in the census.
  -- NOT the wallet's real first-contribution block (the census cannot say
  -- which block that was) — but an honest, measured fact: the first block at
  -- which the contract's own state showed the contribution. It feeds the
  -- binding freeze and the referral-status settle, never an ordering
  -- comparison.
  first_observed_block bigint not null,

  -- `refunded(wallet)`, mirrored. An abandoned sale keeps publishing its raise:
  -- `claimRefund()` sets `refunded[w]` and touches NEITHER `totalRaised` nor
  -- `contributed[w]`, so nothing else stored here can tell that the money went
  -- back. The boards showed two wallets holding 0.005 ETH each on a contract
  -- with a zero balance (issue 21).
  --
  -- NULLABLE, and that is the whole design. `refunded(w)` is an RPC read like
  -- any other, so it has three answers: true, false, and "we did not get one".
  -- A `not null default false` would publish a failed read as "this wallet was
  -- not refunded" (CLAUDE.md §4), and the per-cycle refresh would overwrite a
  -- known true with it. The reconciler coalesces rather than assigns.
  --
  -- Declared here, but ADDED BY ALTER on the local stack, so its ordinal
  -- position differs between a fresh database and that one. Inert: every
  -- insert in lib/data names its columns and nothing selects `*`.
  refunded             boolean,

  observed_at          timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint sale_wallet_totals_wallet_lower
    check (wallet_address = lower(wallet_address)),
  constraint sale_wallet_totals_positive
    check (contributed_wei > 0)
);

-- Covers the create-was-skipped path: the local stack already holds this table
-- from the files this one replaces, in a shape that predates the column.
alter table sale_wallet_totals
  add column if not exists refunded boolean;

create index if not exists sale_wallet_totals_amount_idx
  on sale_wallet_totals (contributed_wei desc);

-- readContributionLeaderboard orders by contributed_wei desc, census_index asc.
-- Without the composite it sorts every contributor before the LIMIT.
create index if not exists sale_wallet_totals_board_idx
  on sale_wallet_totals (contributed_wei desc, census_index asc);

-- ===================================================================
-- 3. Retire the walker's cursor
-- ===================================================================
-- The indexer is gone: contributions are read from the contract's own census
-- (`contributorCount()`, `contributors(i)`, `contributed(w)`) plus the
-- browser-submitted tx hash, so there is no block range to remember and no
-- cursor to corrupt. The table stays (additive migrations only; 0087 remains
-- the historical record) but nothing writes it again, and this comment marks
-- the stale rows so no reader mistakes them for live state.
comment on table sale_indexer_cursor is
  'RETIRED 2026-09-09: the log-walking indexer is gone. Contributions are mirrored from the contract''s own census plus browser-submitted transaction hashes (sale_contribution_claims, sale_wallet_totals). This table is no longer written; rows are historical only.';

-- ===================================================================
-- 4. The block-ordering rule for referral bindings comes out
-- ===================================================================
-- 0087 decided eligibility by comparing two chain positions:
-- `referral_bound_block < first_contribution_block`. That comparison is gone.
-- Binding is now REFUSED after the first contribution instead of being scored
-- after it, so "the code came first" is a structural fact of the write path,
-- not a measurement the settle step re-derives.
--
-- 0087 is applied and must not be edited, so its three artefacts are dropped
-- here. Two of them are CHECK constraints, and a constraint the application no
-- longer satisfies is not dead weight — it throws:
--
--   sale_participants_binding_has_block
--     `bindReferralCode` no longer writes the block, so EVERY bind raises.
--   sale_participants_credited_needs_ordering
--     `settleFirstContributions` writes 'credited' from the binding alone, so
--     the whole settle statement raises and nothing is ever credited.
--
-- Verified against prod 2026-09-09: both constraints and the column were still
-- present, and `sale_participants` held 0 rows, so nothing is lost with the
-- column. Dropping it also keeps drizzle-kit from generating the same drop
-- later as unreviewed drift (lib/db/schema.ts no longer declares it).
--
-- `referral_bound_at` stays. It was never the decision — it is our clock, kept
-- for display and support questions — and it is the only record of WHEN a
-- binding was taken.
alter table sale_participants
  drop constraint if exists sale_participants_binding_has_block;

alter table sale_participants
  drop constraint if exists sale_participants_credited_needs_ordering;

alter table sale_participants
  drop column if exists referral_bound_block;

-- ===================================================================
-- 5. Two pools become three commissions
-- ===================================================================
-- A pool has a denominator and a share; a commission has neither, so the
-- pool-era columns are not stale values, they are quantities that no longer
-- exist. One of them actively blocks the new design:
-- `sale_airdrop_snapshot_rows_share_paired` requires a qualified referrer to
-- carry a nonzero `referral_share_bps`, and under a commission every correct
-- row has a zero share. That constraint refuses the entire result set.
--
-- Why this DROPS, when the standing rule is additive only: issues 25 and 35
-- were both an applied migration edited in place. This is a new file and does
-- not touch 0087, so that rule is intact. The separate reason to prefer
-- additive columns is that a drop destroys data — and these three tables have
-- never held a row, because the sale contract has never been deployed.
--
-- That is an assumption about production, so it is CHECKED rather than trusted:
-- the guard below raises if any of the three tables is non-empty, and the whole
-- migration rolls back. A wrong assumption stops the deploy instead of deleting
-- the only record of who was owed what.
do $$
declare
  n_snapshots bigint;
  n_rows      bigint;
  n_draws     bigint;
begin
  -- Exits this DO block only, NOT the file. Migrations are ordered and 0087
  -- always precedes this one, so a missing table here means something is very
  -- wrong and the ALTERs below should raise rather than be skipped.
  if to_regclass('public.sale_airdrop_snapshots') is null then
    return;
  end if;

  -- Scoped to the drop it protects. Once `draw_entrant` is gone this section
  -- has already run, and every row in the table was written under the NEW
  -- schema. Guarding on row count alone would then refuse forever, turning a
  -- one-time safety check into a permanent block on any redeploy.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sale_airdrop_snapshot_rows'
      and column_name = 'draw_entrant'
  ) then
    return;
  end if;

  select count(*) into n_snapshots from sale_airdrop_snapshots;
  select count(*) into n_rows      from sale_airdrop_snapshot_rows;
  if to_regclass('public.sale_draw_results') is null then
    n_draws := 0;
  else
    execute 'select count(*) from sale_draw_results' into n_draws;
  end if;

  if n_snapshots > 0 or n_rows > 0 or n_draws > 0 then
    raise exception
      'Refusing to drop pool-era snapshot columns: % snapshot(s), % row(s), % draw result(s) exist. Migrate the data first.',
      n_snapshots, n_rows, n_draws;
  end if;
end $$;

-- The dead draw (issue 41). Built to hold the lucky draw's results. The 2% draw
-- is replaced by a flat per-buyer bonus, so nothing will ever write this table
-- and no reader has ever read it.
drop table if exists sale_draw_results;

-- ---- 5a. Snapshot rows: pool shares out, commission amounts in ----
alter table sale_airdrop_snapshot_rows
  drop constraint if exists sale_airdrop_snapshot_rows_share_paired;

drop index if exists sale_airdrop_snapshot_rows_draw_idx;

-- `referrer_tokens` never reaches production: it was added and then dropped
-- inside the window this file collapses. The drop stays for the local stack,
-- which ran both halves.
alter table sale_airdrop_snapshot_rows
  drop column if exists referral_share_bps,
  drop column if exists referrer_tokens,
  drop column if exists draw_entrant;

-- The buyer's OWN allocation from the sale, in token base units, computed the
-- way the contract computes it: TOKENS_FOR_SALE * contributed / totalRaised,
-- multiply before divide, both inputs read from the chain.
--
-- Stored rather than derived on read. Every commission below is a percentage of
-- this number, so it is the one quantity a dispute turns on, and recomputing it
-- later needs a `totalRaised` that only existed at the close.
alter table sale_airdrop_snapshot_rows
  add column if not exists sale_allocation_tokens numeric(78, 0) not null default 0;

-- Did this wallet apply a code before it paid? The gate on the buyer bonus, and
-- the only thing the buyer controls.
--
-- DELIBERATELY independent of whether the referrer qualified (operator decision,
-- 2026-09-11). A buyer cannot see their referrer's other referrals and cannot
-- influence them, so paying on that fact would be a reward decided by a stranger.
alter table sale_airdrop_snapshot_rows
  add column if not exists buyer_bonus_eligible boolean not null default false;

-- 2% of this wallet's own allocation, in token base units. Zero is a fact here,
-- not a missing value: a buyer who used no code is owed exactly nothing.
alter table sale_airdrop_snapshot_rows
  add column if not exists buyer_bonus_tokens numeric(78, 0) not null default 0;

-- The summed sale allocations of the buyers this wallet brought in, in token
-- base units. The base of the referrer commission, and the number that makes the
-- commission auditable without re-deriving a price.
alter table sale_airdrop_snapshot_rows
  add column if not exists referred_allocation_tokens numeric(78, 0) not null default 0;

-- 4% of `referred_allocation_tokens`. Zero unless the wallet cleared both gates.
alter table sale_airdrop_snapshot_rows
  add column if not exists referrer_commission_tokens numeric(78, 0) not null default 0;

-- 4% of `referred_wei`, in wei. Paid out of the pot scooped in withdrawProceeds
-- (§10.5). Zero unless the wallet cleared both gates.
alter table sale_airdrop_snapshot_rows
  add column if not exists referrer_rebate_wei numeric(78, 0) not null default 0;

create index if not exists sale_airdrop_snapshot_rows_buyer_bonus_idx
  on sale_airdrop_snapshot_rows (snapshot_id, buyer_bonus_eligible)
  where buyer_bonus_eligible;

-- ---- 5b. Snapshot header ----
-- Every gate failure that reaches the HTTP response is also preserved in the
-- stored row, distinguishing blocked final runs from ordinary rehearsals. The
-- defaults are added for backfill safety and immediately dropped, so future
-- writers must explicitly supply both values.
alter table sale_airdrop_snapshots
  add column if not exists blockers jsonb not null default '[]'::jsonb;
alter table sale_airdrop_snapshots
  alter column blockers drop default;

alter table sale_airdrop_snapshots
  add column if not exists final_requested boolean not null default false;
alter table sale_airdrop_snapshots
  alter column final_requested drop default;

-- `qualified_referred_wei` (0087) survives and changes meaning slightly: it was
-- the DENOMINATOR of the pro-rata split, it is now simply the ETH the
-- qualifying referrers brought in. Still the right number to show, still the
-- right number to reconcile the ETH rebates against, so it keeps its name.
--
-- `draw_entrant_count` counted spins in a draw. Renamed rather than dropped:
-- it is the same predicate under a name that is now true.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'sale_airdrop_snapshots'
      and column_name = 'draw_entrant_count'
  ) then
    alter table sale_airdrop_snapshots rename column draw_entrant_count to buyer_bonus_count;
  end if;
end $$;

-- What the run says is owed, in total, across all three legs. Written by the
-- snapshot and never recomputed on read, so the reconciliation in §44d compares
-- two independently stored numbers rather than a number against itself (§8 #11).
alter table sale_airdrop_snapshots
  add column if not exists owed_buyer_tokens numeric(78, 0) not null default 0;
alter table sale_airdrop_snapshots
  add column if not exists owed_referrer_tokens numeric(78, 0) not null default 0;
alter table sale_airdrop_snapshots
  add column if not exists owed_referrer_wei numeric(78, 0) not null default 0;

-- Read from the chain at snapshot time, alongside total_raised_wei. Both inputs
-- to every allocation in the run, stored so the run stays checkable.
--
-- NULLABLE, and null means the read faulted (§4). Never substitute SALE_TOKENS
-- from lib/sale/projection.ts: that constant is published intent, not an input
-- to live pricing, and putting it here would be §8 #11 with money attached.
alter table sale_airdrop_snapshots
  add column if not exists tokens_for_sale numeric(78, 0);

-- ===================================================================
-- 6. The payment ledger (issue 44b)
-- ===================================================================
-- Payouts go out by hand from a plain wallet (§10.9), so nothing reverts and
-- nothing retries. `sale_airdrop_snapshot_rows` records what is OWED; this
-- records what was SENT. Without it the two failure modes — paying a wallet
-- twice, and never paying it at all — are invisible everywhere.
create table if not exists sale_referral_payments (
  snapshot_id    text not null references sale_airdrop_snapshots(id) on delete restrict,
  wallet_address text not null,
  -- referrer_eth (wei) | referrer_tokens (base units) | buyer_tokens (base units)
  kind           text not null,

  -- Base units, always. The integer that was pasted into the wallet, never a
  -- rounded human figure: a manual send is off by dust in exactly the way nobody
  -- notices (§8 #3 — and a zero here is a fact, not an absence).
  amount         numeric(78, 0) not null,

  tx_hash        text,

  -- THREE STATES, on purpose (§4, and issue 29 is this exact mistake with money
  -- attached). null = we have not looked, or the RPC could not answer. true =
  -- the transaction moved this amount to this wallet. false = it did not.
  -- An unread node must never render as an unpaid wallet.
  chain_verified boolean,
  verified_at    timestamptz,
  block_number   bigint,

  note           text,
  recorded_at    timestamptz not null default now(),
  recorded_by    text,

  -- The double-payment guard, in the database rather than in a handler somebody
  -- forgets to call. This is also what makes the operator page safe to reload,
  -- re-sort and re-export mid-payout.
  primary key (snapshot_id, wallet_address, kind),

  constraint sale_referral_payments_wallet_lower
    check (wallet_address = lower(wallet_address)),
  constraint sale_referral_payments_tx_lower
    check (tx_hash is null or tx_hash = lower(tx_hash)),
  constraint sale_referral_payments_kind
    check (kind in ('referrer_eth', 'referrer_tokens', 'buyer_tokens')),
  constraint sale_referral_payments_amount_nonneg
    check (amount >= 0),
  -- A verdict with no transaction to verify is a verdict about nothing.
  constraint sale_referral_payments_verdict_needs_tx
    check (chain_verified is null or tx_hash is not null),
  -- A verdict carries when it was reached. Without this, a stale true from
  -- before a re-org looks identical to one taken a second ago.
  constraint sale_referral_payments_verdict_timed
    check ((chain_verified is null) = (verified_at is null))
);

-- The payout queue: rows still waiting on a verdict, which is what the
-- verification job walks and what the operator page filters to.
create index if not exists sale_referral_payments_unverified_idx
  on sale_referral_payments (snapshot_id, kind)
  where tx_hash is not null and chain_verified is null;

create index if not exists sale_referral_payments_wallet_idx
  on sale_referral_payments (wallet_address);
