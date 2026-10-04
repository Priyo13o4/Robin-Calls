/**
 * The referral rules, as arithmetic. Pure — no database, no chain, no clock — so
 * every threshold and every amount can be tested against worked examples
 * (tests/referral-rules.test.ts) rather than against a live sale.
 *
 * Three commissions, replacing the two fixed pools of the original design
 * (docs/prds/TOKEN-SALE-INTENT.md §10). A pool had a denominator and a share; a
 * commission has neither. Nobody's reward depends on how many other people
 * claimed one.
 *
 *   2% BUYER BONUS. A buyer who applied a code before paying gets 2% more tokens
 *      on top of their own sale allocation.
 *
 *   4% REFERRER COMMISSION. A qualifying referrer gets 4% of the tokens their
 *      referred buyers actually received.
 *
 *   4% ETH REBATE. A qualifying referrer gets 4% of the ETH those buyers put in,
 *      paid out of the pot scooped in `withdrawProceeds` (§10.5).
 *
 * Direct referrals only. If A refers B and B refers C, C's money counts toward
 * B and stops there.
 *
 * WHY THERE IS NO TOKEN PRICE IN THIS FILE (§10.3, and it is a §8 #11 trap).
 * A commission of 4% on "the ETH they brought in, valued at the closing price"
 * looks like it needs a price. It does not: the price is `totalRaised /
 * tokensForSale`, and dividing by it inside a percentage cancels it out
 * completely. What remains is 4% of the token allocations themselves. Any price
 * constant here would be a number we invented standing in for one the chain
 * already holds — `SALE_TOKENS` in lib/sale/projection.ts says so in its own
 * comment, and it is published intent, never an input to live arithmetic.
 */

/** Every commission, in basis points of its own base. */
export const COMMISSION_BPS = {
  /** Of the buyer's own sale allocation, in tokens. */
  buyerBonus: 200,
  /** Of the summed sale allocations of the buyers a referrer brought, in tokens. */
  referrerTokens: 400,
  /** Of the ETH those buyers contributed, in wei. */
  referrerEth: 400,
} as const;

const BPS_DENOMINATOR = 10_000n;

/**
 * The two gates on the referrer legs, both measured at the close of the sale.
 *
 * They survive the rework unchanged. The commission model removes the reason
 * they were originally needed — there is no shared pool left to dilute — but the
 * operator kept them, so they are still the only thing standing between three
 * self-funded wallets and a commission.
 *
 * There is deliberately no per-referred-wallet floor beyond the one the CONTRACT
 * enforces on a wallet's first send: `minInitialContribution`, which is storage
 * the owner can move, not a constant to plan against. Raising `minReferredWei`
 * is the dial that closes it, and it is stored on every snapshot so a run stays
 * readable after the dial moves.
 */
export interface ReferralRules {
  /** Distinct credited referrals a referrer needs. */
  minReferredWallets: number;
  /** Combined ETH those referrals must have contributed, in wei. */
  minReferredWei: bigint;
}

export const DEFAULT_REFERRAL_RULES: ReferralRules = {
  minReferredWallets: 3,
  minReferredWei: 100_000_000_000_000_000n, // 0.1 ETH
};

/** One referrer's measured position, summed from the indexed contributions. */
export interface ReferrerTotals {
  wallet: string;
  /** Wallets that used this code AND were credited AND actually contributed. */
  referredCount: number;
  /** Every contribution those wallets made, not just their first. */
  referredWei: bigint;
}

/**
 * Both gates, ANDed. Named so the caller cannot accidentally test one:
 * `qualifiesAsReferrer` is the only export that decides eligibility.
 */
export function qualifiesAsReferrer(totals: ReferrerTotals, rules: ReferralRules): boolean {
  return totals.referredCount >= rules.minReferredWallets && totals.referredWei >= rules.minReferredWei;
}

/**
 * `TOKENS_FOR_SALE * contributed / totalRaised`, byte for byte the contract's
 * own `allocationOf` (contracts/src/token-sale/TokenSale.sol).
 *
 * Multiply before divide, exactly once. An intermediate "tokens per wei"
 * truncates to zero under integer division and silently zeroes every allocation.
 *
 * Both `tokensForSale` and `totalRaisedWei` are READ FROM THE CHAIN by the
 * caller. Neither has a default here on purpose: a default would let a faulted
 * read compute a confident allocation from a number nobody measured.
 */
export function saleAllocation(args: {
  contributedWei: bigint;
  totalRaisedWei: bigint;
  tokensForSale: bigint;
}): bigint {
  if (args.totalRaisedWei === 0n) return 0n;
  return (args.tokensForSale * args.contributedWei) / args.totalRaisedWei;
}

/** `amount * bps / 10000`, multiply before divide, truncating down as on chain. */
export function applyBps(amount: bigint, bps: number): bigint {
  return (amount * BigInt(bps)) / BPS_DENOMINATOR;
}

/**
 * Does this wallet earn the 2% buyer bonus?
 *
 * `credited` is the ONE status that means "a code was applied before this
 * wallet's first contribution landed". `pending` is a wallet that applied a code
 * and has not paid yet, and it must never count.
 *
 * DELIBERATELY says nothing about the referrer (operator decision, 2026-09-11).
 * A buyer cannot see how many other people their referrer brought in and cannot
 * influence it, so gating their bonus on it would make the reward turn on a fact
 * they have no access to. The referrer's own two legs are gated; this one is not.
 */
export function earnsBuyerBonus(referralStatus: string, contributedWei: bigint): boolean {
  return referralStatus === "credited" && contributedWei > 0n;
}

export interface CommissionInputs {
  /** This wallet's own allocation from the sale, in token base units. */
  ownAllocation: bigint;
  /** Did it apply a code before paying? */
  buyerBonusEligible: boolean;
  /** Did it clear both referrer gates? */
  referrerQualified: boolean;
  /** Summed allocations of the buyers it brought in, in token base units. */
  referredAllocation: bigint;
  /** Summed ETH those buyers contributed, in wei. */
  referredWei: bigint;
}

export interface Commissions {
  /** 2% of `ownAllocation`. Token base units. */
  buyerBonusTokens: bigint;
  /** 4% of `referredAllocation`. Token base units. */
  referrerCommissionTokens: bigint;
  /** 4% of `referredWei`. Wei. */
  referrerRebateWei: bigint;
}

/**
 * All three legs for one wallet. A wallet can earn any, all, or none of them.
 *
 * Every leg is independently zero-able and a zero is a FACT, not an absence
 * (§8 #3). A buyer who used no code is owed exactly nothing, and that is a
 * different statement from "we have not worked out what they are owed".
 */
export function commissionsFor(input: CommissionInputs): Commissions {
  return {
    buyerBonusTokens: input.buyerBonusEligible
      ? applyBps(input.ownAllocation, COMMISSION_BPS.buyerBonus)
      : 0n,
    referrerCommissionTokens: input.referrerQualified
      ? applyBps(input.referredAllocation, COMMISSION_BPS.referrerTokens)
      : 0n,
    referrerRebateWei: input.referrerQualified
      ? applyBps(input.referredWei, COMMISSION_BPS.referrerEth)
      : 0n,
  };
}

/**
 * Is the referral binding still open for this wallet?
 *
 * Three states, because two were wrong. Our mirror of the contributions is
 * written by a cron that runs a minute behind the chain, so it can confirm a
 * binding it has already seen close, but it can NEVER confirm one is still
 * open. Only the contract can say that, and `contributedOnChain === undefined`
 * is "we could not read it", never zero (§4).
 *
 * Consumers resolve "unknown" differently on purpose, and both directions are
 * deliberate: a purchase is not interrupted by a prompt we cannot justify, and
 * the code field is still offered, because a missed binding is permanent while
 * a redundant one is refused by the freeze in `bindReferralCode`.
 */
export function bindWindowState(args: {
  /** Has our own mirror already recorded a first contribution? */
  mirrorSaysOpen: boolean | null;
  /** `contributed(wallet)` off chain. undefined = unread. */
  contributedOnChain: bigint | undefined;
}): "open" | "closed" | "unknown" {
  if (args.mirrorSaysOpen === null) return "unknown";
  if (!args.mirrorSaysOpen) return "closed";
  if (args.contributedOnChain === undefined) return "unknown";
  return args.contributedOnChain > 0n ? "closed" : "open";
}
