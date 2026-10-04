import { TOTAL_SUPPLY } from "./projection";

/**
 * The published split and launch principles — the data both token pages
 * (/token-sale and /tokenomics) render, so the two cannot drift.
 *
 * `note` is the only place lock/vest language may appear: rows carry exactly
 * what the operator has decided. A row whose schedule is decided carries an
 * `unlock` summary restating its VESTING entry — the two are kept in step by
 * tests/sale-projection.test.ts, which derives each summary from the shape.
 */
export interface AllocationRow {
  label: string;
  /** Share of TOTAL_SUPPLY, in percent. */
  pct: number;
  note: string;
  /**
   * The decided unlock summary, in words. Derivable from VESTING but printed
   * from here so the table stays readable; the test pins the pairing.
   */
  unlock?: string;
  /**
   * The building in /public/tokenomics/city that stands for this row. Named
   * here rather than in the component so the city and the split cannot drift:
   * tests/sale-projection.test.ts pins that every row has a building and that
   * no building is orphaned.
   */
  city: string;
  /**
   * Sub-rows that decompose THIS row. Their `pct` is a share of TOTAL_SUPPLY
   * (not of the parent) and must sum to the parent's `pct` — pinned in
   * tests/sale-projection.test.ts. Nested here rather than kept as a second
   * top-level list so no string match can pair the wrong parent with a
   * breakdown, and so the sum check is local to the data.
   */
  breakdown?: { label: string; pct: number; note: string }[];
}

export const TOKENOMICS: AllocationRow[] = [
  {
    label: "PUBLIC FAIR LAUNCH",
    pct: 30,
    city: "fair_launch",
    note: "the pool on the sale page, split pro-rata",
    unlock: "100% at the close of the sale",
  },
  {
    label: "LIQUIDITY",
    pct: 20,
    city: "liquidity",
    note: "seeded at the close, from 80% of the raise",
    unlock: "100% into the pool at the close. Pool lock planned, not yet on chain",
  },
  {
    label: "DEV & ECOSYSTEM",
    pct: 15,
    city: "dev",
    note: "10% at TGE; 3-month cliff, then linear",
    unlock: "10% at TGE, 3M cliff, then linear to M24",
  },
  {
    label: "PLATFORM REWARD",
    pct: 15,
    city: "platform",
    note: "funds user rewards and features, released in steps",
    unlock: "12.5% at TGE, 12.5% at M3, then 25% at M12, M18 and M24",
  },
  {
    label: "GENESIS AIRDROP",
    pct: 10,
    city: "airdrop",
    note: "referrals, referred buyers, and a holder drop, broken out below",
    unlock: "60% with the sale, 40% after listing",
    breakdown: [
      {
        label: "FAIRLAUNCH REFERRAL REWARDS",
        pct: 4,
        note: "paid to referrers who bring sale participants",
      },
      {
        label: "BUYERS USING A REFERRAL CODE",
        pct: 2,
        note: "paid to sale buyers who enter a referral code",
      },
      {
        label: "TOKEN HOLDER AIRDROP",
        pct: 4,
        note: "eligible holders, about a week after the listing. Snapshot method not yet defined",
      },
    ],
  },
  {
    label: "TREASURY",
    pct: 5,
    city: "treasury",
    note: "3-month cliff, then linear",
    unlock: "3M cliff, then linear to M24",
  },
  {
    label: "TEAM & CONTRIBUTORS",
    pct: 5,
    city: "team",
    note: "6-month cliff, then linear",
    unlock: "6M cliff, then linear to M24",
  },
];

/**
 * Launch principles. `draft` marks the ones whose on-chain execution does not
 * yet exist — the vesting schedule is DECIDED (see VESTING), but a decision is
 * not a contract, so the stamps stay until the locks and vests are deployed.
 */
export const LAUNCH_PRINCIPLES: { text: string; draft?: true }[] = [
  { text: "No Private Sale" },
  { text: "No VC Allocation" },
  { text: "No Insider Discounts" },
  { text: "Fair Launch, no fixed price" },
  { text: "Community determines the final price" },
  { text: "80% of funds raised goes to liquidity" },
  { text: "Team allocation vested. 6M cliff, then linear to M24" },
  { text: "Liquidity locked in the pool", draft: true },
];

/**
 * Allocation colours: a fixed ramp ranked by size, never a continuous scale.
 * The colour separates rows; it does not re-encode a number already printed
 * (15% vs 15% would be indistinguishable on a continuous ramp anyway). Lime is
 * the scarce accent (DESIGN.md), so only the largest row gets it.
 */
export const ALLOCATION_SHADES = [
  "#ccff00",
  "#a8d81a",
  "#7fae22",
  "#5c8424",
  "#3d5c1f",
  "#2a3f18",
] as const;

/** label → shade, ranked by pct. Ties keep input order (stable sort). */
export function allocationShades(rows: { label: string; pct: number }[]): Map<string, string> {
  const ranked = [...rows].sort((a, b) => b.pct - a.pct);
  return new Map(
    ranked.map((r, i) => [r.label, ALLOCATION_SHADES[Math.min(i, ALLOCATION_SHADES.length - 1)]]),
  );
}

/**
 * Token counts per row, DERIVED from pct × TOTAL_SUPPLY — never a second
 * hand-typed list that can drift from the percentages.
 */
export function tokensFor(pct: number): number {
  return Math.round((pct / 100) * TOTAL_SUPPLY);
}

/**
 * FINAL unlock schedules — decided by the operator, 2026-09-04. Every locked
 * allocation is fully unlocked by month 24; nothing runs longer.
 *
 * `tge` is the fraction released at the token generation event; the remainder
 * unlocks linearly from `cliff` to `end` (months). `end <= cliff` means a
 * single step at `cliff`, not a curve. `steps` replaces the single ramp for
 * stepped releases (Platform Rewards, revised 2026-09-30): each entry is the
 * CUMULATIVE fraction unlocked AT that month, flat in between.
 *
 * The Liquidity row's lock is a lock on the LP POSITION, not a vest of its
 * tokens — the 20% is deployed into the pool at launch. Position lock duration
 * is not yet fixed (12–24 months), so its shape carries the deployment, and
 * the LAUNCH_PRINCIPLES draft stamp is what still says "not yet on chain".
 */
export const VESTING_MONTHS = 24;

export interface VestingShape {
  tge: number;
  cliff: number;
  end: number;
  /** Printed inside the bar — the shape in words. */
  rule: string;
  /** Stepped release: [month, cumulative fraction unlocked from that month on]. */
  steps?: [number, number][];
}

export const VESTING: Record<string, VestingShape> = {
  "PUBLIC FAIR LAUNCH": { tge: 1, cliff: 0, end: 0, rule: "100% AT SALE CLOSE" },
  LIQUIDITY: { tge: 1, cliff: 0, end: 0, rule: "SEEDED AT CLOSE. POOL LOCK PLANNED" },
  "DEV & ECOSYSTEM": { tge: 0.1, cliff: 3, end: 24, rule: "10% AT TGE, 3M CLIFF, THEN LINEAR TO M24" },
  "PLATFORM REWARD": {
    tge: 0.125,
    cliff: 0,
    end: 24,
    rule: "12.5% AT TGE, 12.5% AT M3, THEN 25% AT M12, M18, M24",
    // Mirrors the two PinkLock vests: 50/50 at TGE and M3, then thirds at M12/M18/M24.
    steps: [[3, 0.25], [12, 0.5], [18, 0.75], [24, 1]],
  },
  // Referral rewards + referred buyers (6 of the 10 points) settle with the
  // sale; the holder drop follows the listing, inside the launch period.
  "GENESIS AIRDROP": { tge: 0.6, cliff: 1, end: 1, rule: "60% AT THE SALE, 40% AFTER LISTING" },
  TREASURY: { tge: 0, cliff: 3, end: 24, rule: "3M CLIFF, THEN LINEAR TO M24" },
  "TEAM & CONTRIBUTORS": { tge: 0, cliff: 6, end: 24, rule: "6M CLIFF, THEN LINEAR TO M24" },
};

/** Fraction of a row unlocked at `month`. Clamped to [tge, 1], monotonic. */
export function vestedFraction(v: VestingShape, month: number): number {
  if (v.steps) {
    let f = v.tge;
    for (const [m, cum] of v.steps) if (month >= m) f = cum;
    return f;
  }
  if (v.end <= v.cliff) return month >= v.cliff ? 1 : v.tge;
  const t = (month - v.cliff) / (v.end - v.cliff);
  return v.tge + (1 - v.tge) * Math.min(1, Math.max(0, t));
}

/** Percent of TOTAL SUPPLY circulating at `month` under the schedule. */
export function circulatingPctAt(month: number): number {
  return TOKENOMICS.reduce((sum, r) => {
    const v = VESTING[r.label];
    // A row with no shape is NOT assumed liquid — an unmodelled row would
    // otherwise inflate the circulating line by its whole allocation.
    return sum + (v ? r.pct * vestedFraction(v, month) : 0);
  }, 0);
}

/**
 * The unlock bar's geometry, as percent-of-track strings for VestingExplorer's
 * three spans. Derived here rather than inline in the component so tests can
 * pin the DRAWN shape against the schedule — the number tests never reached
 * the pixels, which is how the airdrop's two-step release once drew a
 * 24-month unwind (§8 #10).
 *
 * Grammar: hatch = locked, nothing releases. Colour = the span over which the
 * allocation releases; past it the track is dark because the row is settled.
 * A step row (GENESIS AIRDROP: 60% at TGE, 40% at M1) therefore colours only
 * the window [TGE, cliff] — a block to end-of-track would draw an unwind that
 * does not exist — and carries no hatch, because with tge already out the
 * window is not a dead stretch (tge = 0 keeps the hatch up to the step).
 */
// Fixed width on purpose: the mark flags "releases at TGE", it does not
// encode how much — the rule tooltip and the month-0 number own that quantity.
const TGE_MARKER = "1.5%";

export function vestingBarGeometry(
  v: VestingShape,
  months: number,
): { cliffW: string; linLeft: string; linW: string; tgeW: string } {
  const pct = (m: number) => `${(m / months) * 100}%`;
  if (v.tge >= 1) return { cliffW: "0%", linLeft: "0%", linW: "0%", tgeW: "100%" };
  if (v.end <= v.cliff) {
    return {
      cliffW: v.tge > 0 ? "0%" : pct(v.cliff),
      linLeft: "0%",
      linW: v.tge > 0 ? pct(v.cliff) : "0%",
      tgeW: v.tge > 0 ? TGE_MARKER : "0%",
    };
  }
  return {
    cliffW: pct(v.cliff),
    linLeft: pct(v.cliff),
    linW: pct(v.end - v.cliff),
    tgeW: v.tge > 0 ? TGE_MARKER : "0%",
  };
}
