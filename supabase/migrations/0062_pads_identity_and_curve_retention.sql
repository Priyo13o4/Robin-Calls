-- Launchpad coverage + curve retention. One migration, three parts.
--
-- Merged from three unapplied drafts (pads / pad-infra identity / retention).
-- Safe precisely BECAUSE none of them ever ran: `scripts/apply-migrations.sh`
-- keys the ledger on FILENAME, so squashing files a database has already
-- applied would make them unknown again and re-run them against a full schema
-- (see the standing "do NOT squash" rule). Prod is at 0061 and has recorded
-- none of these; the local stack's ledger stops at 0054. Every statement below
-- is `if not exists` / `on conflict` guarded and has been applied twice against
-- the local stack to prove re-runnability.
--
--   Part 1 — register PonsV2LaunchFactory and StonkSafeLaunchpad as indexed
--            launchpads (L12, L25).
--   Part 2 — identity-only trusted_address rows for the pad infrastructure
--            those adapters surfaced.
--   Part 3 — curve_tokens retention: the curve_launch_origins archive, the
--            retention index, and the hourly job (L26).
--
-- Parts 1 and 2 need the adapter code that ships in the same commit
-- (`pons-v2`, `stonk-v1` presets). The pad rows are inert without it — the
-- poller skips a pad whose adapter it cannot resolve.

-- ════════════════════════════════════════════════════════════════════════════
-- PART 1 — launchpad rows
-- ════════════════════════════════════════════════════════════════════════════

-- Register PonsV2LaunchFactory and StonkSafeLaunchpad as indexed launchpads.
--
-- WHY. KNOWN-PROBLEMS L12: an ungraduated bonding-curve token whose pad we do
-- not index has no `curve_tokens` row, so `liquidity_depth`'s `isCurveOnlyVenue`
-- branch never fires and the check publishes FAIL -10, "no market data" — a
-- deduction for our own blindness. L25 is the same gap one layer on: without a
-- `curve_tokens.creator_address` the launch is unattributable and 26 more
-- points are withheld. Migration 0059 registered both contracts as IDENTITY
-- rows only; this is the half that actually reads them.
--
-- THESE ARE NOT NEWER VERSIONS OF THE PADS WE ALREADY HAVE.
--   PonsV2LaunchFactory shares a name with pons-v1 and nothing else. v1 is a
--   direct V3 launcher with a `graduationStatus` oracle; v2 gives every token
--   its OWN curve contract and graduates into Uniswap V4. Pointing `pons-v1`
--   at it decodes nothing — its `TokenLaunched` has a different parameter list
--   and therefore a different topic0. pons-v1 itself was RETIRED 2026-08-23
--   (dead on chain); see that row's `notes`.
--   StonkSafeLaunchpad is keyed by a numeric launch id rather than a token
--   address, and gates graduation on a USD market cap rather than raised ETH.
--
-- ENABLED, one of two. `ponsv2` ships ON: it is the live pad (2,402 logs/day,
-- ~11 launches per 9,000 blocks) and the one that actually fills the Bonding
-- tab. `stonksafe` ships OFF: real and correctly decoded, but 601 launches
-- lifetime, quiet ~3 days, and zero live curves at the time of writing — there
-- is nothing for it to sync. Turn it on at /admin/launchpads when the pad wakes
-- up; the adapter is built and tested and needs no deploy to start working.
--
-- A pad begins indexing the moment it is enabled, from a bootstrap cursor
-- capped at 250,000 blocks, and writes `creator_address` into `curve_tokens` —
-- the exact field L25 trusts for attribution. That cap is why enabling is safe
-- here rather than a genesis crawl.
--
-- Chain-verified 2026-08-23 before writing this file (adapters were built
-- against the readings, not against a guess):
--   pons-v2   11 TokenLaunched in one 9,000-block window; graduationThreshold
--             4.2 ETH; the one observed PoolGraduated deployed
--             4.200000000000000093 ETH, confirming the threshold counts REAL
--             quote and NOT the 1.68 ETH phantom reserve.
--   stonk-v1  launchCount 601; LaunchCreated/SafeBuy/LegBonded all decode; of
--             the last 25 launches 24 read `bonded` with realEth 0, which is a
--             window expiring rather than a market — the adapter refuses to
--             call those graduations.

ALTER TABLE launchpads DROP CONSTRAINT IF EXISTS launchpads_adapter_check;
ALTER TABLE launchpads ADD CONSTRAINT launchpads_adapter_check
  CHECK (adapter = ANY (ARRAY[
    'curve-events-v1'::text,
    'flap-v1'::text,
    'pons-v1'::text,
    'pons-v2'::text,
    'stonk-v1'::text,
    'stoxes-v1'::text
  ]));

INSERT INTO launchpads (slug, name, curve_address, adapter, venue_model, enabled, notes)
VALUES
  ('ponsv2', 'Pons V2', '0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e', 'pons-v2',
   'BONDING_CURVE', true,
   'PonsV2LaunchFactory. Per-token bonding curve graduating into Uniswap V4 — '
   || 'NOT a newer pons-v1, which was a direct V3 launcher and is retired. '
   || 'Trades live on each token''s own curve contract, so progress is read as '
   || 'state (curve balance / graduationThreshold), never folded from events.'),
  ('stonksafe', 'Stonk Safe', '0xeca5726dae1e53365c37ffc02369d947a91d71f9', 'stonk-v1',
   'BONDING_CURVE', false,
   'StonkSafeLaunchpad. Keyed by numeric launch id, graduation gated on USD '
   || 'market cap rather than raised ETH, and one launch can bond several '
   || 'quote legs. 601 launches lifetime and bursty — a quiet sample window '
   || 'does not mean the pad is dead. Left DISABLED 2026-08-23: quiet ~3 days '
   || 'with zero live curves, so there is nothing to sync yet. The adapter is '
   || 'built and tested; enabling is a toggle, not a deploy.')
ON CONFLICT (slug) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- PART 2 — pad infrastructure identity
-- ════════════════════════════════════════════════════════════════════════════

-- Identity rows for the launchpad infrastructure surfaced while building the
-- pons-v2 / stonk-v1 adapters (part 1 above). Probed on chain 2026-08-23.
--
-- EVERY ROW HERE IS IDENTITY ONLY. Not one grants LOCKED credit, exempts a
-- holder from the whale scan, or clears anything. That is deliberate: an
-- exclusion is an all-clear (CLAUDE.md §8 #13) and a wrong `lp-locker` row buys
-- a false all-clear, which is the one trade §9 forbids. These rows exist so an
-- unrecognised contract holding a position gets a NAME instead of becoming an
-- "unidentified contract whale" (the L11 shape) — nothing more.
--
-- SUBTYPE PREFIX IS LOAD-BEARING. `launchpadIdentity()`
-- (lib/config/trusted-addresses.ts) matches on `subtype LIKE 'launchpad-%'`,
-- and anything it matches becomes attributable as a token's launch ORIGIN and
-- can be credited a stake in V4 custody attribution (L22/L23). So only a real
-- pad factory/deployer/curve may carry that prefix. The Pons V2 hook is
-- `v4-hook` and the Stonk booster is `pad-helper` for exactly this reason —
-- both sit beside a launchpad without being one, and a prefix typo would let
-- a hook answer "who launched this token".
--
-- WHAT WAS ALREADY THERE, checked before writing this file: the four pad
-- lockers are all registered and all correctly classified.
--   0x267444d0… V2LaunchLocker    lp-locker/permanent   (dispatch census 11/11)
--   0x2f9878d3… FeeLockerV2 (uni) lp-locker/permanent
--   0x35e41f84… PartyLocker       dex-infra/lp-locker-candidate
--   0xc1afa59e… StonkUpLockerCL   dex-infra/lp-locker-per-lock
-- An independent enumeration of all four write surfaces agreed with every one
-- of those labels. No locker classification is changed by this migration.
--
-- THE ONE REAL GAP: Banger's SUSHI fee locker (0xd7b99eee…) was unregistered
-- while its UNI twin (0x2f9878d3…) is trusted-permanent. Both are named
-- FeeLockerV2, both expose the same five write functions
-- (collectFees, lockPosition, onERC721Received, prepareDeposit,
-- setCreatorFeeRecipient) and neither has a path that withdraws principal.
--
-- It still does NOT get the permanent row. The registry's precedent for
-- inheriting a sibling's trust is BYTECODE IDENTITY (see the FeeSplitter (2)
-- row's `sourceMatch`). These two are the same length, 3,302 bytes, and their
-- codehashes DIFFER — same source, different baked-in immutables, and this
-- migration has not established what those immutables point at. Same name and
-- same ABI is not the same contract (§8 #16: read is not understood). It lands
-- as a candidate with the remaining work written down.

INSERT INTO trusted_address (address, chain_id, category, subtype, label, dex_id, verify_status, metadata)
VALUES
  ('0xd7b99eee33d62c152fbc2cd1ea1ca7166b646220', 4663, 'dex-infra', 'lp-locker-candidate',
   'Banger Fee Locker — Sushi (unverified custody)', 'sushiswap', 'ok', '{
     "role": "lp-locker-candidate",
     "auditedAt": "2026-08-23",
     "contractName": "FeeLockerV2",
     "factory": "0xa1e3bfdfee0c19f7bbff52d14e007da5e705660b",
     "identifiedVia": ["banger-v6-sushiFeeLocker()", "blockscout-verified-source"],
     "writeFunctions": ["collectFees", "lockPosition", "onERC721Received", "prepareDeposit", "setCreatorFeeRecipient"],
     "noWithdrawPathInAbi": true,
     "siblingTrustedRow": "0x2f9878d39173b9711136547ac0f84555153ce230",
     "whyNotTrusted": "surface enumerated and clean, but the trusted uni twin is NOT bytecode-identical: both 3302 bytes, codehash 0xa11aaa1e… vs 0xe5590f61…. Same source, different immutables, and those immutables were not read. Sibling trust does not transfer without bytecode identity.",
     "earnsLpLockerRowWhen": ["read the baked-in positionManager/factory immutables and confirm they are the Sushi V3 NPM", "dispatcher enumeration shows no selector outside the declared 5", "confirm no proxy or upgrade path independently of blockscout proxy_type"],
     "grantsLockedCredit": false
   }'::jsonb),

  ('0xe5e702641ea86f4ae6cc3cdaed2b886f976be044', 4663, 'dex-infra', 'v4-hook',
   'Pons V2 Meme Hook', 'uniswap', 'unchecked', '{
     "role": "v4-hook", "factory": "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e",
     "identifiedVia": ["pons-v2-factory-memeHook()"], "auditedAt": "2026-08-23",
     "note": "identity only — a V4 hook is an authority surface and must still be censused by lib/audit before any claim is made about it",
     "grantsLockedCredit": false }'::jsonb),

  ('0xd3afeb2a57f70ef218aa82451c51b2fb0416ac9e', 4663, 'dex-infra', 'fee-collector',
   'Pons V2 Fee Escrow', 'uniswap', 'unchecked', '{
     "role": "fee-escrow", "factory": "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e",
     "identifiedVia": ["pons-v2-factory-feeEscrow()"], "auditedAt": "2026-08-23",
     "grantsLockedCredit": false }'::jsonb),

  ('0x1f12fe622c11947f93f53d63f68f7f46b6d081c9', 4663, 'dex-infra', 'pad-helper',
   'Stonk Stock Booster', 'up', 'unchecked', '{
     "role": "launchpad-helper", "launchpad": "0xeca5726dae1e53365c37ffc02369d947a91d71f9",
     "identifiedVia": ["stonk-launchpad-stockBooster()"], "auditedAt": "2026-08-23",
     "grantsLockedCredit": false }'::jsonb),

  ('0x2e2ae202bd8c7944189a724d572098c16b375c9d', 4663, 'dex-infra', 'smart-router',
   'Stonk Safe Launch Punch Router', 'up', 'ok', '{
     "role": "router", "contractName": "SafeLaunchPunchRouter",
     "launchpad": "0xeca5726dae1e53365c37ffc02369d947a91d71f9",
     "identifiedVia": ["stonk-launchpad-clockInCard()"], "auditedAt": "2026-08-23",
     "writeFunctions": 8,
     "note": "NOT a locker despite sitting beside one — it has rescueToken(address,address). Never classify as lp-locker.",
     "grantsLockedCredit": false }'::jsonb),

  ('0xd1ecc847e6c707a4d172e74e3ab6538daf38bf67', 4663, 'dex-infra', 'migrator',
   'Banger Graduation Manager', 'sushiswap', 'unchecked', '{
     "role": "graduation-manager", "factory": "0xa1e3bfdfee0c19f7bbff52d14e007da5e705660b",
     "identifiedVia": ["banger-v6-graduationManager()"], "auditedAt": "2026-08-23",
     "grantsLockedCredit": false }'::jsonb),

  ('0x3dfd73a63e15920add4b6c5c6a4b1b4b768b2c1a', 4663, 'dex-infra', 'launchpad-factory',
   'CashCat Factory vNext (implementation)', NULL, 'ok', '{
     "role": "launchpad-factory-impl", "contractName": "CashCatFactoryVNext",
     "proxy": "0x5bd1fbe78a78fe8236fa00cf48fbeba74ae34661",
     "identifiedVia": ["erc1967-implementation-slot"], "auditedAt": "2026-08-23",
     "note": "direct Uniswap V4 launcher with a hook; ~285 logs/day. No adapter yet.",
     "grantsLockedCredit": false }'::jsonb),

  ('0x818fdd15dbe95851a0bd8c5389c49ed6d4fe2bbf', 4663, 'dex-infra', 'launchpad-factory',
   'Sentry Launch Factory V4 (implementation)', NULL, 'ok', '{
     "role": "launchpad-factory-impl", "contractName": "SentryLaunchFactoryV4",
     "proxy": "0xd0a93885a387e3a8a14dd82776cf9104a3676b3a",
     "identifiedVia": ["erc1967-implementation-slot"], "auditedAt": "2026-08-23",
     "note": "direct V4 launcher; zero activity in a 7-day sample. No adapter.",
     "grantsLockedCredit": false }'::jsonb)

ON CONFLICT (address, chain_id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- PART 3 — curve_tokens retention (L26)
-- ════════════════════════════════════════════════════════════════════════════

-- curve_tokens retention (KNOWN-PROBLEMS L26) — archive, never plain-delete.
--
-- WHY THIS IS NOT A DELETE JOB. Every curve_tokens row carries
-- `creator_address`, and it is 100% populated on all 340,855 rows (measured on
-- prod 2026-08-23). That column is the ONLY input that can make a launch origin
-- `attributable: true` — lib/scanner/launch-origin.ts falls back to the
-- creation-tx sender otherwise and returns `attributable: false` with the
-- reason "a transaction sender is not established as the launcher rather than
-- the pad's relayer". So a plain DELETE demotes that token's provenance
-- permanently and re-arms L22/L25: a scanner regression wearing a housekeeping
-- costume, which is exactly what L26 warned about.
--
-- This table is therefore the archive the prune writes BEFORE it deletes. It
-- holds every field `readCurveTokenProvenance` returns and nothing else — the
-- dropped columns are name/symbol/metadata_uri (which that read never selects)
-- and the trade counters, target and sweep clocks (all provably zero or NULL
-- for a row that satisfies the prune predicate). The read falls back to this
-- table on a miss, so a pruned token publishes the SAME verdict sentence it
-- would have published with its row intact. That equality is the invariant;
-- tests/curve-retention.test.ts pins it.
--
-- `raised_wei` and `creator_buy_wei` are kept for that reason and no other:
-- `checkLaunchpadProvenance` computes creator-share from them, and synthesising
-- zeros here would turn "the creator bought 0% of the raise" into "an unknown
-- share" — a different published sentence.
--
-- WHAT THIS IS ACTUALLY FOR. Not disk: the VM has 30 GB free and the whole
-- database is 291 MB. It is (a) bounding growth on a table fed by launch spam
-- (~4,600 flap rows/day, ~97% of which stall weightless), and (b) keeping the
-- hot table small — `recordStalledCurves`, `readCurvingTokensForSweep` and
-- `readCurveTokensForMarketSweep` all walk curve_tokens every tick, and the
-- 121,488 rows this prunes at a 14-day window sit in six of its seven indexes.

create table if not exists curve_launch_origins (
  token_address   text primary key,
  launchpad_id    bigint not null references launchpads(id) on delete cascade,
  creator_address text not null,
  created_block   bigint,
  created_at      timestamptz,
  raised_wei      numeric not null default '0',
  creator_buy_wei numeric not null default '0',
  status          text not null,
  pruned_at       timestamptz not null default now(),
  constraint curve_launch_origins_token_address_check
    check (token_address = lower(token_address)),
  -- The prune predicate, restated where it cannot drift. Only STALLED rows are
  -- archivable: a CURVING row publishes a LIVE claim ("still on the bonding
  -- curve, so liquidity is custodied by the launchpad contract"), GRADUATED is
  -- load-bearing for the curve lifecycle, and RUGGED is an indictment. If
  -- someone widens the job's status filter, this check rejects the insert
  -- instead of silently archiving a row whose facts the fallback cannot replay.
  constraint curve_launch_origins_status_check check (status = 'STALLED')
);

comment on table curve_launch_origins is
  'Attribution archive for pruned curve_tokens rows. readCurveTokenProvenance falls back here so pruning never demotes a launch origin from attributable to unknown (KNOWN-PROBLEMS L26).';

-- The retention scan is an ordered range over created_block inside the fixed
-- status/peak/pool/rug predicate. Partial so it indexes the ~170k archivable
-- shapes rather than the whole table. `raised_wei` and the verdicts exclusion
-- stay out of the predicate deliberately: a numeric comparison and a NOT EXISTS
-- are cheap once the range scan has narrowed the candidate set, and folding
-- them in would make the index unusable the moment the dust floor is retuned.
create index if not exists curve_tokens_retention_idx
  on curve_tokens (created_block)
  where status = 'STALLED'
    and peak_progress_bps = 0
    and dex_pool_address is null
    and rug_suspected_at is null;

-- Hourly, same cadence as launch-retention. The 30-second pg_cron ceiling
-- (migration 0002 invokes through `curl -fsS -m 30`) is why the per-run cap is
-- 5,000 rows and not more: raise the frequency, never the batch count.
select public.rc_schedule_job('robincalls-curve-retention', '30 * * * *', '/api/jobs/curve-retention');
