/**
 * Sale economics projections — pure arithmetic, no chain reads, no React.
 * Everything on the /tokenomics page derives from these constants and nothing
 * else, so the page's claims stay reconcilable in one place (and testable in
 * node:test).
 *
 * DENOMINATION: ETH, deliberately. The contract raises ETH and the LP pair is
 * ETH, so prices are currency-exact here; USD would need a
 * price feed this repo does not have (KNOWN-PROBLEMS L89). If USD is added
 * later it must degrade to absent, never to stale.
 */
import { formatUnits } from "viem";

/** Total supply. Named once: the operator may still change it. */
export const TOTAL_SUPPLY = 10_000_000;

/** 30% of supply — the PUBLISHED sale pool. This constant is the tokenomics
 *  page's intent, never an input to the live sale panel: /token-sale's pricing
 *  derives from the chain's `tokensForSale` (liveProjection takes it as an
 *  argument), and renders a drift warning when the two disagree. Dividing a
 *  live raise by this constant while the neighbouring cell shows the chain's
 *  pool is the two-surfaces-disagree failure that produced that rule. */
export const SALE_TOKENS = 3_000_000;

/** 20% of supply — the LP allocation seeded at close. */
export const LP_TOKENS = 2_000_000;

/** Share of the raised ETH that seeds liquidity (the rest is raised proceeds). */
export const LP_SHARE = 0.8;

/** Price a contributor effectively pays: raised ÷ sale pool. */
export function fairLaunchPrice(raisedEth: number): number {
  return raisedEth / SALE_TOKENS;
}

/** FDV at a price — the whole supply valued at one price. */
export function fdvAt(pricePerToken: number): number {
  return pricePerToken * TOTAL_SUPPLY;
}

/** FDV the fair-launch price implies at a given raise. */
export function fairLaunchFdv(raisedEth: number): number {
  return fdvAt(fairLaunchPrice(raisedEth));
}

/**
 * NO LISTING PROJECTION LIVES HERE, deliberately. `listingPrice`,
 * `listingFdv` and `LISTING_UPLIFT` (the structural +20%, LP_SHARE × SALE ÷ LP)
 * were removed 2026-09-04 by operator decision: publishing "the pool opens 20%
 * above what you paid" is an invitation to sell into the first buyers, and the
 * arithmetic was correct enough to be believed. The sale's own price — raised ÷
 * pool — is the only price this product asserts.
 *
 * Do not reintroduce them as a "just for the chart" local: the number is a
 * claim wherever it is computed, and a second copy is how it comes back.
 */

/** One scenario row at a given raise; caller supplies the raise levels. */
export interface ScenarioRow {
  raisedEth: number;
  toLpEth: number;
  fairLaunchPrice: number;
  fairLaunchFdv: number;
}

export function scenarioRow(raisedEth: number): ScenarioRow {
  const fl = fairLaunchPrice(raisedEth);
  return {
    raisedEth,
    toLpEth: raisedEth * LP_SHARE,
    fairLaunchPrice: fl,
    fairLaunchFdv: fdvAt(fl),
  };
}

/** The first rung of the raise ladder, and the factor between rungs. */
export const RAISE_LADDER_BASE = 5;

/**
 * Top of the raise axis for a live total: 5 ETH until the sale passes 5, then
 * 10, 20, 40, … — each rung double the last.
 *
 * The axis GROWS, it never re-scales to fit. A ceiling that tracked the raise
 * continuously would leave the bar sitting at the same fraction forever, which
 * is the one thing a progress bar must not do. Ties resolve in favour of the
 * smaller rung: at exactly 5 ETH the bar is full at 5, and only 5.000…1 opens
 * the 10 rung — "in case we cross 5".
 *
 * Guards, in order: a negative or non-finite raise (a bad decode, never a real
 * balance) falls back to the base rather than producing NaN or Infinity, and
 * the exponent is clamped so an absurd raise cannot loop the ladder forever.
 */
export function raiseCeiling(raisedEth: number): number {
  if (!Number.isFinite(raisedEth) || raisedEth <= RAISE_LADDER_BASE) return RAISE_LADDER_BASE;
  const steps = Math.ceil(Math.log2(raisedEth / RAISE_LADDER_BASE));
  return RAISE_LADDER_BASE * 2 ** Math.min(steps, 40);
}

/**
 * The live panel's three states, as data so node:test can pin the branches
 * (§8 #9: "raised nothing yet" and "we could not read the contract" are two
 * different sentences; collapsing them publishes a fake zero or a fake
 * unavailability). `undefined` raised means the read faulted — `totalRaised`
 * is absent from a faulted SaleView, never present-as-zero.
 */
export type LiveProjection =
  | { kind: "unavailable" }
  | { kind: "zero" }
  | { kind: "implied"; raisedEth: number; fairLaunchPrice: number; fairLaunchFdv: number };

export function liveProjection(
  totalRaised: bigint | undefined,
  salePoolTokens: number = SALE_TOKENS,
): LiveProjection {
  if (totalRaised === undefined) return { kind: "unavailable" };
  if (totalRaised === 0n) return { kind: "zero" };
  const raised = Number(totalRaised) / 1e18;
  const fl = raised / salePoolTokens;
  return { kind: "implied", raisedEth: raised, fairLaunchPrice: fl, fairLaunchFdv: fdvAt(fl) };
}

/* ------------------------------------------------------------------ */
/* Formatting — one home, because three copies of fmtPrice is how the
   tokenomics table and the sale panel drifted into different notations
   for the same number. Prices are token-denominated, so "6 decimals, no
   scientific notation" is the retail-readable form; 1.25e-5 reads as
   broken to the buyer whose money it describes. */

/** Fixed decimal notation — the exponent form `toExponential` produces for
 *  small prices is correct arithmetic and unreadable money. */
export function fmtPrice(p: number): string {
  if (!Number.isFinite(p)) return "—";
  if (p >= 1) return p.toLocaleString('en-US', { maximumFractionDigits: 4 });
  if (p === 0 || p >= 0.0001) return p.toFixed(6);
  return subscriptZeros(p);
}

const SUBSCRIPT = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"];
/** 0.0000000033 → "0.0₈33": the zero run as a subscript count, four significant digits, no exponent. */
export function subscriptZeros(p: number): string {
  const m = p.toFixed(20).match(/^0\.(0+)(\d{1,4})/);
  if (!m) return p.toFixed(6);
  const sub = String(m[1].length).split("").map((c) => SUBSCRIPT[Number(c)]).join("");
  return `0.0${sub}${m[2].replace(/0+$/, "") || "0"}`;
}

/** A USD price in the same notation, for the sale's price cells. */
export function fmtUsdPrice(p: number): string {
  if (!Number.isFinite(p)) return "—";
  return p >= 0.01 ? "$" + p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : "$" + fmtPrice(p);
}

/** Whole-token formatting for a chain bigint at its own decimals. */
export function fmtTokens(v: bigint, decimals: number): string {
  return Number(formatUnits(v, decimals)).toLocaleString('en-US', {
    maximumFractionDigits: 0,
  });
}
