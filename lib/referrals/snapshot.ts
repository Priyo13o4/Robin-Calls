import { formatEther } from "viem";

import { readSaleSnapshot } from "@/lib/sale/server";
import { SALE_STATE } from "@/lib/sale/abi";
import { saleReader } from "@/lib/referrals/census";
import {
  readAllReferrerTotals,
  readSnapshotPopulation,
  readUnsettledContributorCount,
  writeAirdropSnapshot,
  type ReferralStatus,
  type SnapshotRow,
} from "@/lib/data/sale-referrals";

import { readReferralConfig } from "./config";
import {
  COMMISSION_BPS,
  commissionsFor,
  earnsBuyerBonus,
  qualifiesAsReferrer,
  saleAllocation,
  type ReferralRules,
  type ReferrerTotals,
} from "./rules";

/**
 * Freezing eligibility (docs/prds/REFERRALS.md §"The close").
 *
 * This is the one place that turns a running sale into a fixed list of who is
 * owed what, so it is written to REFUSE rather than to approximate. Payouts are
 * now MANUAL (docs/prds/TOKEN-SALE-INTENT.md §10.9), which raises the stakes: nothing
 * downstream reverts, so this list is the only record that will ever exist.
 *
 * Gates between a run and `is_final`:
 *
 *   1. The sale is Closed. Eligibility measured while money can still move is a
 *      guess with a timestamp on it.
 *   2. The mirror reconciles. Our census totals must EQUAL the contract's own
 *      `totalRaised`, read live. This is the completeness proof (§9, coverage
 *      before conclusion) and it is stronger than any block comparison — a
 *      contributor we never recorded shows up here and nowhere else.
 *   3. Every contributor has been settled. Gates 1 and 2 can pass over a
 *      population the settle step never reached — the census totals commit in
 *      their own transaction — and an unsettled wallet is frozen out silently
 *      rather than failing loudly.
 *   4. Both allocation inputs were read. `tokensForSale` and `totalRaised` are
 *      the two numbers every amount in the run is a percentage of. Without them
 *      there are no amounts, only zeroes that look like amounts.
 *   5. The two queries that count referrals agree. NOT a completeness proof;
 *      the comment on `crossCheck` says exactly what it is worth.
 *
 * A dry run may be taken at any time and skips none of the checks — it records
 * what failed instead, so a rehearsal tells you what is still broken.
 */

export interface SnapshotOutcome {
  id: string;
  isFinal: boolean;
  /** Every gate that failed, in plain words. Empty means the run is publishable. */
  blockers: string[];
  contributorCount: number;
  buyerBonusCount: number;
  qualifiedReferrerCount: number;
  /** Null when the chain read faulted. Not a zero, and not our own total. */
  totalRaisedWei: bigint | null;
  /** Null when the chain read faulted. Never SALE_TOKENS standing in (§8 #11). */
  tokensForSale: bigint | null;
  mirroredWei: bigint;
  /** What this run says is owed, across every wallet, per leg. */
  owedBuyerTokens: bigint;
  owedReferrerTokens: bigint;
  owedReferrerWei: bigint;
  /** The chain head this run read. With no walker there is no "indexed
   *  through" block; this says when the completeness proof was taken. */
  headBlock: number | null;
}

/**
 * `reason` is written for the person disputing their own row, so it says what
 * happened in words rather than naming a status. "missed" means nothing to a
 * buyer; "you contributed before applying a code" is the actual event.
 *
 * Every amount is named in tokens or ETH, because under a commission the
 * question people ask is not "am I in" but "why is it that number".
 */
function reasonFor(args: {
  buyerBonusEligible: boolean;
  referralStatus: string;
  contributedWei: bigint;
  referrerQualified: boolean;
  referredCount: number;
  referredWei: bigint;
  buyerBonusTokens: bigint;
  referrerCommissionTokens: bigint;
  referrerRebateWei: bigint;
  amountsComputable: boolean;
  rules: ReferralRules;
}): string {
  const parts: string[] = [];

  if (args.buyerBonusEligible) {
    parts.push(
      `Added a referral code before contributing, so this wallet earns ${COMMISSION_BPS.buyerBonus / 100}% more tokens on top of what it bought: ${args.buyerBonusTokens} extra.`,
    );
  } else if (args.contributedWei === 0n) {
    parts.push("This wallet did not contribute to the sale, so there is no buyer bonus.");
  } else if (args.referralStatus === "missed") {
    parts.push("Contributed before adding a referral code, so there is no buyer bonus.");
  } else if (args.referralStatus === "pending") {
    parts.push("A referral code was added but no contribution arrived in time, so there is no buyer bonus.");
  } else {
    parts.push("No referral code was added, so there is no buyer bonus.");
  }

  if (args.referrerQualified) {
    parts.push(
      `Brought in ${args.referredCount} buyers who put in ${formatEther(args.referredWei)} ETH between them, so this wallet earns ${COMMISSION_BPS.referrerTokens / 100}% of the tokens those buyers received (${args.referrerCommissionTokens}) and ${COMMISSION_BPS.referrerEth / 100}% of the ETH they sent (${formatEther(args.referrerRebateWei)} ETH).`,
    );
  } else if (args.referredCount > 0) {
    // Name the gate that was actually missed. Saying "did not qualify" without
    // saying which half fell short is the sentence people write in to ask about.
    const missing: string[] = [];
    if (args.referredCount < args.rules.minReferredWallets) {
      missing.push(`${args.rules.minReferredWallets} people (had ${args.referredCount})`);
    }
    if (args.referredWei < args.rules.minReferredWei) {
      missing.push(
        `${formatEther(args.rules.minReferredWei)} ETH between them (had ${formatEther(args.referredWei)})`,
      );
    }
    parts.push(`Did not reach the referrer bar, so there is no referrer commission. Needed ${missing.join(" and ")}.`);
  }

  // A zero amount on a blocked run is not the same claim as a zero amount on a
  // run that computed one. Saying so is the difference between "you are owed
  // nothing" and "we could not work out what you are owed" (§4).
  if (!args.amountsComputable) {
    parts.push("The sale's closing numbers could not be read on this run, so no amount here is final.");
  }

  return parts.join(" ");
}

export async function buildAirdropSnapshot(args: {
  id: string;
  saleAddress: string;
  /** The sale's chain. Required: a default here would read mainnet for a
   *  testnet sale and block on gates it cannot see. */
  chainId: number;
  /** A final run is refused unless every gate passes. A dry run records them. */
  final: boolean;
  notes?: string | null;
}): Promise<SnapshotOutcome> {
  const config = await readReferralConfig();
  const blockers: string[] = [];

  // ---- do we know what the rules ARE? ----
  // The fallbacks keep the indexer running through a blip, but a snapshot is
  // where they stop being safe: raise the referrer bar after a sybil wave, have
  // the config read throw at the close, and the run pays out under the old bar
  // AND stores the old bar in its own `rules` column — so sweep block 13, which
  // compares rows against the run's stored rules, returns zero. Internally
  // consistent and wrong.
  if (config.source !== "stored") {
    blockers.push("Could not read the airdrop rules, so this run cannot say which thresholds are in force.");
  }
  if (config.invalidKeys.length > 0) {
    blockers.push(
      `These settings are saved but could not be read, so a default is standing in for them: ${config.invalidKeys.join(", ")}.`,
    );
  }

  // ---- the chain's own numbers ----
  // Through the chain-aware reader: on a testnet build the sale lives on
  // 46630 while the provider pool is pinned to mainnet, and a snapshot that
  // read the wrong chain would block on gates it cannot see.
  const targetChainId = args.chainId;
  const live = await readSaleSnapshot(args.saleAddress, { client: saleReader(targetChainId) });
  const saleState = live?.view.state;
  const contractTotal = live?.view.totalRaised;
  const tokensForSale = live?.view.tokensForSale;
  // The head this run's completeness proof stands at. readSaleSnapshot pins
  // its reads to a block when it can read one; otherwise re-ask rather than
  // storing 0, which would say "nothing was looked at" about a run that read
  // the whole census (the column is NOT NULL, so a null here would throw).
  let headBlock: number | null =
    live?.blockNumber !== null && live?.blockNumber !== undefined ? Number(live.blockNumber) : null;
  if (headBlock === null) {
    try {
      headBlock = Number(await saleReader(targetChainId).getBlockNumber());
    } catch {
      // Stored as 0 below only when even the direct read faulted; the state
      // blocker above has already fired in that case, so this run is not
      // going final on a number it invented.
    }
  }

  if (saleState === undefined) {
    blockers.push("Could not read the sale's state from the chain.");
  } else if (saleState !== SALE_STATE.CLOSED) {
    blockers.push("The sale has not closed yet. Nothing is final until it does.");
  }
  if (contractTotal === undefined) {
    // §4: an unread total is not a zero total. Without it there is no
    // reconciliation, so the run cannot claim completeness at all.
    blockers.push("Could not read the contract's total raised, so the mirror cannot be reconciled.");
  }
  if (tokensForSale === undefined) {
    // Gate four. SALE_TOKENS in lib/sale/projection.ts is the obvious stand-in
    // and it is exactly the wrong move: it is published intent, not the number
    // this contract was deployed with, and substituting it would compute every
    // allocation in the run from a constant nobody measured (§8 #11).
    blockers.push("Could not read how many tokens the sale is selling, so no allocation can be computed.");
  }

  // Every amount below is a percentage of these two numbers. Without both, the
  // run stores zeroes and says so in each row's reason; it can never go final.
  const amountsComputable = contractTotal !== undefined && tokensForSale !== undefined;

  // ---- has the settle step caught up? ----
  // `earnsBuyerBonus` is false for a wallet still `pending`, so an unsettled
  // population does not fail loudly — it freezes those wallets OUT of the bonus
  // and publishes "no contribution arrived in time" about people who are in the
  // row set precisely because they paid. The census can be complete while this
  // is still true: `recordCensusEntry` commits in its own transaction, so a
  // settle that throws leaves the earlier gates passing.
  const unsettled = await readUnsettledContributorCount();
  if (unsettled.kind !== "found") {
    blockers.push("Could not check whether every contributor has been settled.");
  } else if (unsettled.count > 0) {
    blockers.push(
      unsettled.count === 1
        ? "1 wallet that contributed has not been settled yet. Let the reconciler finish before taking a final snapshot."
        : `${unsettled.count} wallets that contributed have not been settled yet. Let the reconciler finish before taking a final snapshot.`,
    );
  }

  // ---- the population, and what each wallet did ----
  const population = await readSnapshotPopulation();
  const mirroredWei = population.reduce((sum, p) => sum + p.contributedWei, 0n);

  if (contractTotal !== undefined && mirroredWei !== contractTotal) {
    const gap = contractTotal - mirroredWei;
    blockers.push(
      `Our copy does not match the contract. The contract holds ${formatEther(contractTotal)} ETH and we have recorded ${formatEther(mirroredWei)} ETH, a gap of ${formatEther(gap)} ETH.`,
    );
  }

  // ---- each buyer's own allocation, the way the CONTRACT computes it ----
  const allocationOf = (contributedWei: bigint): bigint =>
    amountsComputable
      ? saleAllocation({ contributedWei, totalRaisedWei: contractTotal!, tokensForSale: tokensForSale! })
      : 0n;

  const ownAllocation = new Map(population.map((p) => [p.walletAddress, allocationOf(p.contributedWei)]));

  // ---- what each referrer brought in ----
  // Measured from the POPULATION, because the referrer commission is a
  // percentage of the allocations their buyers received and only the population
  // carries a per-buyer contribution to derive those from.
  //
  // The base is the SUM OF TRUNCATED PER-BUYER ALLOCATIONS, never the allocation
  // of the summed contribution. Those differ by up to one unit per buyer, and
  // the first is the only one that equals what the buyers actually received —
  // which is what the commission is defined as (§10.2).
  interface Brought {
    referredCount: number;
    referredWei: bigint;
    referredAllocation: bigint;
  }
  const brought = new Map<string, Brought>();
  for (const subject of population) {
    // `credited` is the only status that credits a referrer, and it is the same
    // status readAllReferrerTotals filters on. A wallet whose code was applied
    // late counts for nobody.
    if (subject.referralStatus !== "credited" || subject.referredByWallet === null) continue;
    const key = subject.referredByWallet;
    const current = brought.get(key) ?? { referredCount: 0, referredWei: 0n, referredAllocation: 0n };
    brought.set(key, {
      referredCount: current.referredCount + 1,
      referredWei: current.referredWei + subject.contributedWei,
      referredAllocation: current.referredAllocation + (ownAllocation.get(subject.walletAddress) ?? 0n),
    });
  }

  // Gate five. Be precise about what this can and cannot catch, because it
  // LOOKS like a §9 two-representation reconciliation and is not one: both
  // sides derive from `sale_wallet_totals` filtered on `referral_status =
  // 'credited'`, over the same two tables. No data problem can make them
  // diverge, so this is not evidence of completeness.
  //
  // What it does catch is a future EDIT to either query, which is the realistic
  // failure: the commission base lives here and the eligibility filter lives
  // three files away, and moving one without the other would pay commissions
  // from a set that quietly shrank with nothing else noticing. The real
  // completeness proof is the live `totalRaised` comparison above.
  const declaredTotals: ReferrerTotals[] = await readAllReferrerTotals();
  const crossCheck: string[] = [];
  for (const t of declaredTotals) {
    const mine = brought.get(t.wallet);
    if (!mine) {
      crossCheck.push(`${t.wallet} is credited with ${t.referredCount} referrals by one query and none by the other`);
      continue;
    }
    if (mine.referredCount !== t.referredCount || mine.referredWei !== t.referredWei) {
      crossCheck.push(
        `${t.wallet}: one query says ${t.referredCount} buyers and ${formatEther(t.referredWei)} ETH, the other says ${mine.referredCount} and ${formatEther(mine.referredWei)} ETH`,
      );
    }
  }
  for (const wallet of brought.keys()) {
    if (!declaredTotals.some((t) => t.wallet === wallet)) {
      crossCheck.push(`${wallet} has credited referrals in the population and no row in the referrer totals`);
    }
  }
  if (crossCheck.length > 0) {
    blockers.push(
      `Two ways of counting referrals disagree, so the commission base is not settled: ${crossCheck.slice(0, 5).join("; ")}${crossCheck.length > 5 ? `, and ${crossCheck.length - 5} more` : ""}.`,
    );
  }

  // ---- one row per wallet that is owed something, or that paid ----
  // A referrer who brought in buyers and never contributed themselves has NO row
  // in sale_wallet_totals, so the population does not contain them. Under the
  // old pool design that was correct, and the query still says so in its own
  // comment: they were owed nothing. Under a commission they are owed both
  // referrer legs, so the row set is the population PLUS every such wallet.
  // Leaving them out would drop a real debt with no error anywhere.
  const subjects: {
    walletAddress: string;
    contributedWei: bigint;
    referredByWallet: string | null;
    referralStatus: ReferralStatus;
    contributor: boolean;
  }[] = population.map((p) => ({ ...p, contributor: true }));

  const inPopulation = new Set(population.map((p) => p.walletAddress));
  for (const wallet of brought.keys()) {
    if (inPopulation.has(wallet)) continue;
    subjects.push({
      walletAddress: wallet,
      contributedWei: 0n,
      referredByWallet: null,
      // Their own participation, not their referrals. They never contributed, so
      // no code of theirs was ever credited against a purchase.
      referralStatus: "none",
      contributor: false,
    });
  }
  subjects.sort((a, b) => (a.walletAddress < b.walletAddress ? -1 : a.walletAddress > b.walletAddress ? 1 : 0));

  const rows: SnapshotRow[] = subjects.map((subject) => {
    const mine = brought.get(subject.walletAddress);
    const referredCount = mine?.referredCount ?? 0;
    const referredWei = mine?.referredWei ?? 0n;
    const referredAllocation = mine?.referredAllocation ?? 0n;
    const referrerQualified = qualifiesAsReferrer(
      { wallet: subject.walletAddress, referredCount, referredWei },
      config.rules,
    );
    const buyerBonusEligible = earnsBuyerBonus(subject.referralStatus, subject.contributedWei);
    const saleAllocationTokens = ownAllocation.get(subject.walletAddress) ?? 0n;

    const amounts = commissionsFor({
      ownAllocation: saleAllocationTokens,
      buyerBonusEligible,
      referrerQualified,
      referredAllocation,
      referredWei,
    });

    return {
      walletAddress: subject.walletAddress,
      contributedWei: subject.contributedWei,
      referredByWallet: subject.referredByWallet,
      referralStatus: subject.referralStatus,
      saleAllocationTokens,
      buyerBonusEligible,
      buyerBonusTokens: amounts.buyerBonusTokens,
      referredCount,
      referredWei,
      referredAllocationTokens: referredAllocation,
      referrerQualified,
      referrerCommissionTokens: amounts.referrerCommissionTokens,
      referrerRebateWei: amounts.referrerRebateWei,
      reason: reasonFor({
        buyerBonusEligible,
        referralStatus: subject.referralStatus,
        contributedWei: subject.contributedWei,
        referrerQualified,
        referredCount,
        referredWei,
        buyerBonusTokens: amounts.buyerBonusTokens,
        referrerCommissionTokens: amounts.referrerCommissionTokens,
        referrerRebateWei: amounts.referrerRebateWei,
        amountsComputable,
        rules: config.rules,
      }),
    };
  });

  const buyerBonusCount = rows.filter((r) => r.buyerBonusEligible).length;
  const isFinal = args.final && blockers.length === 0;

  // The header counts what the ROW SET actually holds, never a parallel piece of
  // bookkeeping. Counting the latter drifts the moment the two disagree, and the
  // sweep's own checks only look at rows, so nothing would catch it (issue 16).
  const qualifiedRowCount = rows.filter((r) => r.referrerQualified).length;
  const qualifiedWeiInRows = rows
    .filter((r) => r.referrerQualified)
    .reduce((sum, r) => sum + r.referredWei, 0n);

  // Totals owed, per leg. Stored rather than derived on read so the payout
  // reconciliation compares two independently written numbers (§8 #11).
  const owedBuyerTokens = rows.reduce((sum, r) => sum + r.buyerBonusTokens, 0n);
  const owedReferrerTokens = rows.reduce((sum, r) => sum + r.referrerCommissionTokens, 0n);
  const owedReferrerWei = rows.reduce((sum, r) => sum + r.referrerRebateWei, 0n);

  await writeAirdropSnapshot(
    {
      id: args.id,
      isFinal,
      finalRequested: args.final,
      blockers,
      saleAddress: args.saleAddress,
      saleState: saleState ?? null,
      // NOT NULL in the DDL. The head this run's reads were pinned to, or the
      // head at run time when the pinned read faulted — never 0, which would
      // say "nothing was looked at" about a run that read the whole census.
      indexedThroughBlock: headBlock ?? 0,
      // The contract's numbers or nothing. `?? mirroredWei` here would store our
      // own total in the column that exists to disagree with it, and the
      // completeness check would then compare a value to itself.
      totalRaisedWei: contractTotal ?? null,
      tokensForSale: tokensForSale ?? null,
      mirroredWei,
      contributorCount: population.length,
      buyerBonusCount,
      qualifiedReferrerCount: qualifiedRowCount,
      qualifiedReferredWei: qualifiedWeiInRows,
      owedBuyerTokens,
      owedReferrerTokens,
      owedReferrerWei,
      // Stored so this run stays readable after the dials move.
      rules: {
        minReferredWallets: config.rules.minReferredWallets,
        minReferredWei: config.rules.minReferredWei.toString(),
        buyerBonusBps: COMMISSION_BPS.buyerBonus,
        referrerTokensBps: COMMISSION_BPS.referrerTokens,
        referrerEthBps: COMMISSION_BPS.referrerEth,
      },
      notes: args.notes ?? null,
    },
    rows,
  );

  return {
    id: args.id,
    isFinal,
    blockers,
    contributorCount: population.length,
    buyerBonusCount,
    qualifiedReferrerCount: qualifiedRowCount,
    totalRaisedWei: contractTotal ?? null,
    tokensForSale: tokensForSale ?? null,
    mirroredWei,
    owedBuyerTokens,
    owedReferrerTokens,
    owedReferrerWei,
    headBlock,
  };
}
