-- Standing invariant sweep over the referral + airdrop plane (CLAUDE.md §9,
-- Method F). The sibling of scripts/invariant-sweep.sql, which covers the
-- verdict ledger; this one covers who is owed what.
--
-- Every query states something the data must satisfy ON ITS OWN TERMS — no
-- chain read, no RPC. A row returned is a contradiction we are already
-- carrying, and several of them would be a wrong airdrop rather than a wrong
-- screen.
--
--   docker exec -i <pg> psql -U postgres -d robincalls -P pager=off \
--     < scripts/referral-invariants.sql
--
-- Expected output: every count zero. Run it before taking a final snapshot, and
-- after any change under lib/referrals/ or lib/data/sale-referrals.ts.

\pset pager off

\echo '== the binding ============================================='

\echo '-- 1. credited, but without a bound referral code --'
-- A row here is a wallet credited with no binding to justify it.
select count(*) as credited_without_binding
from sale_participants
where referral_status = 'credited'
  and (referred_by_code is null or referred_by_wallet is null);

\echo '-- 2. settled without a contribution to settle against --'
-- `credited` and `missed` are decisions made when the first contribution lands.
-- Either state without one means something wrote a decision it could not have
-- reached.
select count(*) as settled_with_no_first_contribution
from sale_participants
where referral_status in ('credited', 'missed')
  and first_contribution_block is null;

\echo '-- 3. paid, but never settled --'
-- The indexer is behind, or `settleFirstContributions` is not running. Harmless
-- for a minute, a silently shrinking draw if it persists.
select count(*) as contributed_but_unsettled
from sale_participants
where first_contribution_block is not null
  and referral_status in ('none', 'pending');

\echo '-- 4. paid, but no code issued --'
-- A code is earned by contributing. A wallet here has nothing to share, and
-- nobody can refer through it.
select count(*) as contributed_but_no_code
from sale_participants
where first_contribution_block is not null
  and referral_code is null;

\echo '-- 5. referring themselves --'
-- The check constraint prevents this; the query exists because a constraint
-- that gets dropped in a future migration fails silently from then on.
select count(*) as self_referrals
from sale_participants
where referred_by_wallet = wallet_address;

\echo '-- 6. referred by a wallet that owns no code --'
-- A binding points at a code; the code belongs to exactly one wallet. A row
-- here means the two halves disagree about who the referrer is.
select count(*) as referrer_without_that_code
from sale_participants p
where p.referred_by_wallet is not null
  and not exists (
    select 1 from sale_participants r
    where r.wallet_address = p.referred_by_wallet
      and r.referral_code = p.referred_by_code
  );

\echo '== the mirror =============================================='

\echo '-- 7. a contributor with no participant row --'
-- The reconciler creates one for every wallet it records. A row here cannot be
-- credited, cannot hold a code, and does not appear on either leaderboard.
select count(*) as contributors_missing_a_participant_row
from sale_wallet_totals t
where not exists (
  select 1 from sale_participants p where p.wallet_address = t.wallet_address
);

\echo '-- 7b. a verified claim whose wallet has no census total --'
-- The claim path writes the contribution; the reconciler's census pass writes
-- the total. A wallet stuck here means the census pass has not caught up, and
-- its leaderboard amount is stale (it will read 0 from the totals table).
select count(*) as verified_claims_without_a_census_total
from (select distinct wallet_address from sale_contribution_claims where verdict = 'verified') v
where not exists (
  select 1 from sale_wallet_totals t where t.wallet_address = v.wallet_address
);

\echo '-- 8. our sum disagrees with the contract''s own running total --'
-- The census totals ARE the contract's `contributed(w)` readings, refreshed
-- every reconciler pass. Their sum must equal the running total stamped on the
-- newest verified contribution — and the snapshot compares it to a fresh
-- `totalRaised()` read as the stronger gate. A gap here is a wallet the census
-- pass has not recorded, and it is invisible from anywhere else.
select count(*) as mirror_does_not_reconcile
from (
  select
    (select coalesce(sum(contributed_wei), 0) from sale_wallet_totals) as ours,
    (select total_raised_wei from sale_contributions
     order by block_number desc, log_index desc limit 1) as theirs
) x
where theirs is not null and ours <> theirs;

\echo '-- 9. a first contribution that is not the earliest one on record --'
-- `first_contribution_block` decides eligibility, so it must be the genuine
-- earliest. A row here means a decision was made against the wrong block.
-- The claim path writes the receipt's block; the census path writes the head
-- of the pass that first saw the wallet, which can only be LATER than the
-- true first block — so a census-recorded wallet is exempt (its block is an
-- honest lower bound, never a wrong ordering), and only claim-recorded
-- wallets are held to the exact earliest.
select count(*) as first_contribution_is_not_the_earliest
from sale_participants p
join (
  select wallet_address, min(block_number) as earliest
  from sale_contributions group by wallet_address
) c on c.wallet_address = p.wallet_address
where p.first_contribution_block is not null
  and p.first_contribution_block <> c.earliest
  and exists (select 1 from sale_contributions c2
              where c2.wallet_address = p.wallet_address
                and c2.block_number = p.first_contribution_block);

\echo '== the snapshot ============================================'

\echo '-- 10. a FINAL snapshot taken over an incomplete mirror --'
-- The one that would actually pay the wrong people. A final run is only
-- publishable when what we indexed equals what the contract holds.
select count(*) as final_snapshot_over_an_incomplete_mirror
from sale_airdrop_snapshots
where is_final
  and (total_raised_wei is null or mirrored_wei <> total_raised_wei);

\echo '-- 11. a FINAL snapshot taken before the sale closed --'
-- SaleState.Closed is 3. Eligibility measured while money can still move is a
-- guess with a timestamp on it.
select count(*) as final_snapshot_while_sale_open
from sale_airdrop_snapshots
where is_final and (sale_state is null or sale_state <> 3);

\echo '-- 12. a buyer bonus for a wallet that was not credited, or that paid nothing --'
-- The one rule the whole bonus rests on: the code came first. A bonus on a
-- wallet that added its code late, or never paid, is the rule not being applied.
select count(*) as buyer_bonus_without_credit
from sale_airdrop_snapshot_rows
where buyer_bonus_eligible and (referral_status <> 'credited' or contributed_wei = 0);

\echo '-- 13. a qualified referrer below the run''s own stored gates --'
-- The rules are stored ON the snapshot precisely so this can be checked after
-- the dials move. A row here is a referrer paid under rules the run says it
-- did not use.
select count(*) as qualified_below_its_own_rules
from sale_airdrop_snapshot_rows r
join sale_airdrop_snapshots s on s.id = r.snapshot_id
where r.referrer_qualified
  and (r.referred_count < (s.rules->>'minReferredWallets')::int
       or r.referred_wei  < (s.rules->>'minReferredWei')::numeric);

\echo '-- 14. an unqualified wallet holding a referrer reward --'
-- No pool and no shared denominator any more, so there is no constraint pairing
-- these. Both referrer legs are gated on the same boolean and must be exactly
-- zero without it.
select count(*) as referrer_reward_without_qualification
from sale_airdrop_snapshot_rows
where not referrer_qualified
  and (referrer_commission_tokens > 0 or referrer_rebate_wei > 0);

\echo '-- 15. a commission that is not the published percentage of its own base --'
-- The whole redesign in one check. Every amount is a fixed percentage of a base
-- stored on the same row, truncating down, so this can be recomputed exactly in
-- SQL with no chain read and no price. A row here is arithmetic that does not
-- match what the site says it does.
select count(*) as amounts_that_are_not_the_stated_percentage
from sale_airdrop_snapshot_rows
where buyer_bonus_tokens
        <> case when buyer_bonus_eligible then trunc(sale_allocation_tokens * 200 / 10000) else 0 end
   or referrer_commission_tokens
        <> case when referrer_qualified then trunc(referred_allocation_tokens * 400 / 10000) else 0 end
   or referrer_rebate_wei
        <> case when referrer_qualified then trunc(referred_wei * 400 / 10000) else 0 end;

\echo '-- 16. a FINAL snapshot row disagreeing with the mirror --'
-- Scoped to the final run deliberately. A rehearsal taken mid-sale disagrees
-- with the mirror as soon as any of its wallets contributes again — that is the
-- normal case, rehearsals are meant to be re-run, and a non-zero here on an
-- open sale would train the operator to ignore this file. Only a final run is
-- ever paid from, so only a final run must agree.
select count(*) as final_snapshot_row_disagrees_with_mirror
from sale_airdrop_snapshot_rows r
join sale_airdrop_snapshots s on s.id = r.snapshot_id
join sale_wallet_totals t on t.wallet_address = r.wallet_address
where s.is_final and r.contributed_wei <> t.contributed_wei;

\echo '-- 17. a FINAL snapshot holding a wallet that was never settled --'
-- Gate four. `earnsBuyerBonus` is false for `pending`, so an unsettled wallet is
-- frozen OUT of the bonus rather than failing loudly, and gates 1 to 3 can all
-- pass while this is true: the contributions commit in their own transaction,
-- so a settle that threw leaves a complete, reconciled, and undecided mirror.
--
-- SCOPED TO CONTRIBUTORS. The row set now also holds referrers who never bought
-- anything, carried at contributed_wei = 0 and referral_status 'none' because
-- they are owed a commission and nothing else would list them. Without this
-- clause every such wallet reads as an unsettled contributor and the block
-- fires on a correct run.
select count(*) as final_snapshot_over_unsettled_wallets
from sale_airdrop_snapshot_rows r
join sale_airdrop_snapshots s on s.id = r.snapshot_id
where s.is_final and r.contributed_wei > 0 and r.referral_status in ('none', 'pending');

\echo '-- 18. a gap in the census walk --'
-- The contract pushes each contributor once, in order, so the recorded index
-- set must be a contiguous prefix. A gap is a contributor the walk stepped
-- over and will never return to: no code, no board row, no snapshot row, and
-- their referrer silently short by one.
select count(*) as census_indices_never_recorded
from generate_series(0, coalesce((select max(census_index) from sale_wallet_totals), -1)) g
where not exists (select 1 from sale_wallet_totals t where t.census_index = g);

\echo '-- 19. an allocation that is not the contract''s own arithmetic --'
-- allocationOf(a) = TOKENS_FOR_SALE * contributed[a] / totalRaised, multiply
-- before divide, truncating. Both inputs are stored on the header, so the whole
-- thing is checkable here without a chain read. Skips runs where either input
-- could not be read: those store zeroes and are blocked from ever going final.
select count(*) as allocations_that_do_not_match_the_contract
from sale_airdrop_snapshot_rows r
join sale_airdrop_snapshots s on s.id = r.snapshot_id
where s.tokens_for_sale is not null
  and s.total_raised_wei is not null
  and s.total_raised_wei > 0
  and r.sale_allocation_tokens <> trunc(s.tokens_for_sale * r.contributed_wei / s.total_raised_wei);

\echo '-- 20. header totals that disagree with the rows under them --'
-- Two independently written numbers (§9). The header sums are computed by the
-- snapshot at run time; these are the rows it wrote. They must be identical, and
-- a disagreement means a row set edited, truncated, or partly written since.
select count(*) as headers_disagreeing_with_their_rows
from sale_airdrop_snapshots s
join (
  select snapshot_id,
         sum(buyer_bonus_tokens)         as b,
         sum(referrer_commission_tokens) as rt,
         sum(referrer_rebate_wei)        as rw
  from sale_airdrop_snapshot_rows group by snapshot_id
) x on x.snapshot_id = s.id
where s.owed_buyer_tokens <> x.b
   or s.owed_referrer_tokens <> x.rt
   or s.owed_referrer_wei <> x.rw;

\echo '-- 21. a payment recorded against something that is not owed --'
-- The ledger is the only record a manual payout leaves. A payment with no row
-- behind it, or one against a rehearsal, is money sent on numbers no gate
-- cleared.
select count(*) as payments_without_a_final_owed_row
from sale_referral_payments p
left join sale_airdrop_snapshot_rows r
  on r.snapshot_id = p.snapshot_id and r.wallet_address = p.wallet_address
left join sale_airdrop_snapshots s on s.id = p.snapshot_id
where r.wallet_address is null or s.is_final is not true;

\echo '-- 22. a payment larger than the amount it settles --'
-- Overpayment is not caught by anything else: recordPayment can be forced, on
-- purpose, and the force is meant to be deliberate and noted rather than silent.
select count(*) as payments_exceeding_what_is_owed
from sale_referral_payments p
join sale_airdrop_snapshot_rows r
  on r.snapshot_id = p.snapshot_id and r.wallet_address = p.wallet_address
where p.amount > case p.kind
                   when 'buyer_tokens'    then r.buyer_bonus_tokens
                   when 'referrer_tokens' then r.referrer_commission_tokens
                   when 'referrer_eth'    then r.referrer_rebate_wei
                 end;

\echo '-- 23. a wallet owed something that has no payment and no explanation --'
-- The reconciliation, as one number. This is the ONE block expected to be
-- non-zero while a payout is in progress: before anything is sent it equals the
-- whole owed set, and it falls as the ledger fills. It must be zero when the
-- payout is called finished, and it is the only thing that can find a manual
-- payment that was simply never made.
select count(*) as final_owed_legs_never_sent
from sale_airdrop_snapshot_rows r
join sale_airdrop_snapshots s on s.id = r.snapshot_id
left join sale_referral_payments pb
  on pb.snapshot_id = r.snapshot_id and pb.wallet_address = r.wallet_address and pb.kind = 'buyer_tokens'
left join sale_referral_payments pt
  on pt.snapshot_id = r.snapshot_id and pt.wallet_address = r.wallet_address and pt.kind = 'referrer_tokens'
left join sale_referral_payments pe
  on pe.snapshot_id = r.snapshot_id and pe.wallet_address = r.wallet_address and pe.kind = 'referrer_eth'
where s.is_final
  and ((r.buyer_bonus_tokens > 0         and (pb.wallet_address is null or pb.chain_verified is false))
    or (r.referrer_commission_tokens > 0 and (pt.wallet_address is null or pt.chain_verified is false))
    or (r.referrer_rebate_wei > 0        and (pe.wallet_address is null or pe.chain_verified is false)));

\echo '-- detail for anything non-zero above --'
\echo 'rerun the block''s WHERE clause selecting wallet_address instead of count(*)'
