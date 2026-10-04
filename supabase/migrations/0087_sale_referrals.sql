-- 0087_sale_referrals.sql
-- Referral + airdrop-eligibility plane for the token sale (docs/prds/REFERRALS.md).
--
-- The sale contract knows nothing about referrals and never will: `contribute()`
-- takes no arguments, so the link between "this wallet typed a code" and "this
-- wallet paid" can only be made off chain. These tables are that link.
--
-- The chain stays the only source of truth about money. `sale_contributions` is
-- a MIRROR of the contract's `Contributed` event, rebuildable from block 0 at
-- any time, and every ETH number the leaderboards and the airdrop publish is
-- summed from it — never from a running total we maintained by hand.
--
-- Additive. Touches no existing table; the whitelist plane is untouched.

-- ===================================================================
-- 1. Participants: one row per wallet we have ever seen
-- ===================================================================
create table if not exists sale_participants (
  wallet_address            text primary key,

  -- Display identity. Optional, set by the wallet owner with a signature.
  nickname                  text,
  emoji                     text,

  -- This wallet's OWN code. Null until its first contribution is indexed —
  -- a code is earned by contributing, so it cannot be farmed by connecting
  -- a thousand empty wallets.
  referral_code             text unique,
  referral_code_issued_at   timestamptz,

  -- The code this wallet USED. Both columns are read: the code is what we show
  -- the user ("you used ABCD2345"), the wallet is what the referral leaderboard
  -- groups by. Codes are immutable and 1:1 with a wallet, so these cannot drift.
  referred_by_code          text,
  referred_by_wallet        text,
  referral_bound_at         timestamptz,
  -- The chain head when the binding was recorded, and the column eligibility is
  -- actually decided by. `referral_bound_at` is OUR clock and
  -- `first_contribution_at` is the chain's, so comparing them compares two
  -- clocks: a server 25s ahead of the sequencer writes 'missed' on somebody who
  -- did everything in the right order, and a server behind it credits somebody
  -- who did not. Block numbers come from one clock. The timestamp is kept for
  -- display and for support questions, never for the decision.
  referral_bound_block      bigint,

  -- FOUR states, not a boolean. Before the first contribution is indexed the
  -- answer to "does this code count?" is not `false`, it is *not yet decided*,
  -- and collapsing those is CLAUDE.md §8 #9 verbatim — a wallet mid-flight
  -- would read as ineligible.
  --   none     no code applied, nothing indexed yet. Still changeable.
  --   pending  code applied, first contribution not yet on chain. Changeable.
  --   credited code was applied BEFORE the first contribution. Frozen. 2% draw.
  --   missed   first contribution landed with no valid earlier code. Permanent.
  referral_status           text not null default 'none',

  -- Decided by the indexer, from the chain, and never rewritten afterwards.
  first_contribution_block  bigint,
  first_contribution_at     timestamptz,
  first_contribution_tx     text,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint sale_participants_wallet_lower
    check (wallet_address = lower(wallet_address)),
  constraint sale_participants_referrer_lower
    check (referred_by_wallet is null or referred_by_wallet = lower(referred_by_wallet)),
  -- Structural, not cosmetic: a wallet referring itself would count toward its
  -- own 4% gate and win a 2% spin for money it already had.
  constraint sale_participants_no_self_referral
    check (referred_by_wallet is null or referred_by_wallet <> wallet_address),
  -- Crockford base32: no I, L, O or U, so a code read aloud or copied off a
  -- screenshot normalises back to exactly one wallet's code.
  constraint sale_participants_code_shape
    check (referral_code is null or referral_code ~ '^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$'),
  constraint sale_participants_referred_code_shape
    check (referred_by_code is null or referred_by_code ~ '^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$'),
  -- A binding names both halves or neither, and always says where on the chain
  -- it stood: without the block there is nothing to compare the first
  -- contribution against.
  constraint sale_participants_binding_paired
    check ((referred_by_code is null) = (referred_by_wallet is null)),
  constraint sale_participants_binding_has_block
    check (referred_by_code is null or referral_bound_block is not null),
  constraint sale_participants_status_values
    check (referral_status in ('none', 'pending', 'credited', 'missed')),
  -- 'credited' is the state that pays out, so it may never exist without the
  -- binding that justifies it, nor without the ordering that earned it.
  constraint sale_participants_credited_needs_binding
    check (referral_status <> 'credited' or referred_by_wallet is not null),
  constraint sale_participants_credited_needs_ordering
    check (
      referral_status <> 'credited'
      or (referral_bound_block is not null
          and first_contribution_block is not null
          and referral_bound_block < first_contribution_block)
    ),
  constraint sale_participants_nickname_len
    check (nickname is null or char_length(nickname) between 1 and 24),
  constraint sale_participants_emoji_len
    check (emoji is null or char_length(emoji) between 1 and 8)
);

create index if not exists sale_participants_referrer_idx
  on sale_participants (referred_by_wallet)
  where referred_by_wallet is not null;

create index if not exists sale_participants_status_idx
  on sale_participants (referral_status);

-- ===================================================================
-- 2. Contributions: a mirror of the contract's Contributed event
-- ===================================================================
create table if not exists sale_contributions (
  tx_hash          text    not null,
  log_index        integer not null,
  wallet_address   text    not null,
  amount_wei       numeric(78, 0) not null,
  -- The contract's running total at this log. Not used for any sum — it is the
  -- reconciliation handle: our own SUM(amount_wei) must equal the last row's
  -- value, and a mismatch means we missed a log.
  total_raised_wei numeric(78, 0),
  block_number     bigint  not null,
  block_time       timestamptz not null,
  indexed_at       timestamptz not null default now(),

  primary key (tx_hash, log_index),
  constraint sale_contributions_wallet_lower
    check (wallet_address = lower(wallet_address)),
  -- The contract rejects a zero contribution, so a zero row here is our bug.
  constraint sale_contributions_amount_positive
    check (amount_wei > 0)
);

create index if not exists sale_contributions_wallet_idx
  on sale_contributions (wallet_address);
create index if not exists sale_contributions_block_idx
  on sale_contributions (block_number);

-- ===================================================================
-- 3. Indexer cursor
-- ===================================================================
create table if not exists sale_indexer_cursor (
  contract_address text primary key,
  chain_id         integer not null,
  -- Highest block whose logs are fully written. Everything at or below this is
  -- complete; nothing above it has been looked at.
  last_block       bigint  not null,
  -- Chain head as of the last run. `head_block - last_block` is the lag, and
  -- the close snapshot refuses to run while that gap covers the close.
  head_block       bigint,
  last_run_at      timestamptz not null default now(),
  last_error       text,

  constraint sale_indexer_cursor_lower
    check (contract_address = lower(contract_address))
);

-- ===================================================================
-- 4. Airdrop snapshot: eligibility frozen at a moment
-- ===================================================================
-- Two tables, because the header carries the coverage facts. A per-wallet list
-- with no record of how far the indexer had got is a conclusion with no way to
-- tell whether it was drawn over the whole sale or half of it (§9).
create table if not exists sale_airdrop_snapshots (
  id                       text primary key,
  taken_at                 timestamptz not null default now(),
  -- A dry run may be taken any time; exactly one run is ever marked final, and
  -- only a final run may be paid out.
  is_final                 boolean not null default false,
  sale_address             text not null,
  sale_state               integer,
  -- How far the mirror had got when this run was taken.
  indexed_through_block    bigint not null,
  -- The contract's own totalRaised, read live at snapshot time. The authority.
  --
  -- NULLABLE, and null means "we could not read it". Substituting our own
  -- mirrored total here would put our number in the column that exists to
  -- disagree with it, and the completeness check below would then pass by
  -- comparing a value to itself (§8 #11: a literal where a measurement belongs).
  total_raised_wei         numeric(78, 0),
  -- What our mirror adds up to. These two being EQUAL is the completeness
  -- proof, and it is stronger than any block comparison: a tail of logs we
  -- never walked shows up here and nowhere else. A final snapshot is refused
  -- while they disagree.
  mirrored_wei             numeric(78, 0) not null,
  contributor_count        integer not null,
  -- Wallets holding one spin in the 2% draw.
  draw_entrant_count       integer not null,
  -- Referrers who cleared both gates.
  qualified_referrer_count integer not null,
  -- Denominator of the 4% pro-rata split.
  qualified_referred_wei   numeric(78, 0) not null,
  -- Rules the run was computed under, stored so an old snapshot stays readable
  -- after the thresholds move.
  rules                    jsonb not null,
  notes                    text,

  constraint sale_airdrop_snapshots_address_lower
    check (sale_address = lower(sale_address))
);

-- Exactly one final snapshot, enforced by the database rather than by a code
-- path someone can forget to call.
create unique index if not exists sale_airdrop_snapshots_one_final
  on sale_airdrop_snapshots ((is_final)) where is_final;

create table if not exists sale_airdrop_snapshot_rows (
  snapshot_id            text not null references sale_airdrop_snapshots(id) on delete cascade,
  wallet_address         text not null,

  -- What this wallet did.
  contributed_wei        numeric(78, 0) not null default 0,
  referred_by_wallet     text,
  referral_status        text not null,

  -- 2% pool: one spin per wallet that used a code before it paid.
  draw_entrant           boolean not null default false,

  -- 4% pool, all measured over DIRECT referrals only.
  referred_count         integer not null default 0,
  referred_wei           numeric(78, 0) not null default 0,
  referrer_qualified     boolean not null default false,
  -- Share of the 4% pool, in basis points of that pool. Zero for everyone who
  -- did not qualify. Sums to 10000 across a run, give or take integer dust.
  referral_share_bps     numeric(20, 6) not null default 0,

  -- Why this row says what it says, in plain words. Written for a human who is
  -- disputing their allocation, not for the code.
  reason                 text not null,

  primary key (snapshot_id, wallet_address),
  constraint sale_airdrop_snapshot_rows_wallet_lower
    check (wallet_address = lower(wallet_address)),
  -- A qualified referrer with no share, or a share with no qualification, is a
  -- bug in the split. Refuse to store it.
  constraint sale_airdrop_snapshot_rows_share_paired
    check ((referral_share_bps > 0) = referrer_qualified)
);

create index if not exists sale_airdrop_snapshot_rows_qualified_idx
  on sale_airdrop_snapshot_rows (snapshot_id, referrer_qualified)
  where referrer_qualified;
create index if not exists sale_airdrop_snapshot_rows_draw_idx
  on sale_airdrop_snapshot_rows (snapshot_id, draw_entrant)
  where draw_entrant;

-- ===================================================================
-- 5. Lucky draw results (2% pool) — filled when the draw is actually run
-- ===================================================================
-- The buckets and the spin are not built yet. The table is, so the draw has
-- somewhere honest to land and the entrant list it draws from is already frozen
-- above.
create table if not exists sale_draw_results (
  snapshot_id   text not null references sale_airdrop_snapshots(id) on delete cascade,
  wallet_address text not null,
  bucket        text not null,
  token_amount  numeric(78, 0) not null,
  -- The RNG input, kept so any spin can be replayed and checked.
  draw_seed     text,
  drawn_at      timestamptz not null default now(),

  primary key (snapshot_id, wallet_address),
  constraint sale_draw_results_wallet_lower
    check (wallet_address = lower(wallet_address))
);

-- ===================================================================
-- 6. Indexer schedule
-- ===================================================================
-- Every minute while the sale is open. The run is cheap — one `eth_getLogs`
-- over the blocks since the last run, plus one `eth_getBlockByNumber` per block
-- that actually contained a contribution (cached in-process) — and it is
-- idempotent, so a missed tick costs nothing but a minute of freshness.
--
-- Deliberately scheduled ahead of the flag: the job returns 200 with
-- `skipped: true` while ENABLE_TOKEN_SALE is off (lib/security/job-auth.ts
-- ::jobDisabled), so cron history stays clean instead of logging a failed run
-- every minute. Same reason the other job schedules ship dark. Referrals ride
-- the sale's own switch; there is no separate flag.
--
-- The snapshot job is NOT scheduled. It is run by hand: a rehearsal any number
-- of times while the sale is open, once for real after it closes.
do $$
begin
  if exists (select 1 from pg_proc where proname = 'rc_schedule_job') then
    perform public.rc_schedule_job(
      'robincalls-sale-index',
      '* * * * *',
      '/api/jobs/sale-index'
    );
  else
    raise notice 'RC_CRON_SKIPPED: rc_schedule_job absent — schedule robincalls-sale-index manually once cron prerequisites (0010) exist.';
  end if;
end $$;
