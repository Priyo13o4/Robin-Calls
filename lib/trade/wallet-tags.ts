/**
 * Trade-pane wallet tags. A tag is shown only on positive evidence: a read that failed or was
 * never made yields NO tag, never a "human" or "not a whale" claim (§4).
 * Thresholds measured 2026-09-29 on 1,073 wallets across 7 trending pools (KNOWN-PROBLEMS L217).
 */

/** Median lifetime tx count was 260, the 90th percentile 11,227; 5k to 10k held 14 of 1,073. */
export const BOT_LIFETIME_TXS = 10_000;
/** AD's three wallets: 51 to 125 trades, one every 23 to 46 s. Hand scalpers sat at 60 to 90 s. */
export const BOT_MIN_TRADES = 10;
export const BOT_MAX_MEDIAN_GAP_S = 45;
/** Share of circulating supply (total minus burned minus pool balances). */
export const WHALE_SHARE = 0.01;
const BLOCK_S = 0.1;

export interface WalletFacts {
  /** Lifetime transactions sent (the account nonce). Null: not read. */
  txCount: number | null;
  /** Share of circulating supply held now. Null: not read, or the denominator was unreadable. */
  heldShare: number | null;
  /** "dev" sent the token's creation tx; "insider" received tokens in it. Null: neither, or not read. */
  launch: "dev" | "insider" | null;
}

export interface WalletTag {
  kind: "bot" | "dev" | "insider";
  label: string;
  title: string;
}

export interface TradeLike {
  traderAddress: string;
  txHash: string;
  block: number;
  type: "buy" | "sell";
  liquidity?: "add" | "remove";
}

export interface RateEvidence { trades: number; medianGapS: number }

/** Wallets trading this token faster than a person does. Swaps sharing a tx count once. */
export function fastTraders(rows: readonly TradeLike[]): Map<string, RateEvidence> {
  const byWallet = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (r.liquidity || !r.traderAddress || !Number.isFinite(r.block)) continue;
    const w = r.traderAddress.toLowerCase();
    const txs = byWallet.get(w) ?? new Map<string, number>();
    txs.set(r.txHash.toLowerCase(), r.block);
    byWallet.set(w, txs);
  }
  const out = new Map<string, RateEvidence>();
  for (const [w, txs] of byWallet) {
    if (txs.size < BOT_MIN_TRADES) continue;
    const blocks = [...txs.values()].sort((a, b) => a - b);
    const gaps = blocks.slice(1).map((b, i) => (b - blocks[i]) * BLOCK_S).sort((a, b) => a - b);
    const medianGapS = gaps[Math.floor(gaps.length / 2)];
    if (medianGapS <= BOT_MAX_MEDIAN_GAP_S) out.set(w, { trades: txs.size, medianGapS });
  }
  return out;
}

/** Wallets that bought and sold in one block: arbitrage or a sandwich, never a hand trade. */
export function sameBlockRoundTrips(rows: readonly TradeLike[]): Set<string> {
  const sides = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.liquidity || !r.traderAddress) continue;
    const k = `${r.traderAddress.toLowerCase()}|${r.block}`;
    const s = sides.get(k) ?? new Set<string>();
    s.add(r.type);
    sides.set(k, s);
  }
  const out = new Set<string>();
  for (const [k, s] of sides) if (s.size === 2) out.add(k.split("|")[0]);
  return out;
}

export function walletTags(
  facts: WalletFacts | undefined,
  rate: RateEvidence | undefined,
  roundTrip: boolean,
): WalletTag[] {
  const tags: WalletTag[] = [];
  const botWhy = [
    facts?.txCount != null && facts.txCount >= BOT_LIFETIME_TXS ? `${facts.txCount.toLocaleString("en-US")} transactions sent from this wallet` : null,
    rate ? `${rate.trades} trades on this token, one every ~${Math.round(rate.medianGapS)} s` : null,
    roundTrip ? "Bought and sold in the same block" : null,
  ].filter((x): x is string => x !== null);
  if (botWhy.length) tags.push({ kind: "bot", label: "🤖 Bot", title: botWhy.join(". ") });
  if (facts?.launch === "dev") tags.push({ kind: "dev", label: "🛠 Dev", title: "Sent the transaction that created this token" });
  if (facts?.launch === "insider") tags.push({ kind: "insider", label: "🎯 Insider", title: "Received tokens in the transaction that created this token" });
  return tags;
}

/**
 * What the wallet holds now, as a share of tokens in wallets (pools and burn addresses excluded).
 * Null when unread, and when it holds nothing: a seller who exited gets no animal.
 */
export function holdingTier(share: number | null | undefined): { icon: string; label: string; title: string } | null {
  if (share == null || !Number.isFinite(share) || share <= 0) return null;
  const pct = share * 100;
  const shown = pct >= 10 ? pct.toFixed(0) : pct >= 1 ? pct.toFixed(1) : pct >= 0.01 ? pct.toFixed(2) : "<0.01";
  const title = `Holds ${shown}% of the tokens in wallets (pools and burned tokens not counted). ${HOLDING_LEGEND}`;
  if (share >= WHALE_SHARE) return { icon: "🐳", label: `🐳 ${shown}%`, title };
  if (share >= 0.001) return { icon: "🐬", label: "🐬", title };
  if (share >= 0.0001) return { icon: "🐟", label: "🐟", title };
  return { icon: "🦐", label: "🦐", title };
}

export const HOLDING_LEGEND = "🐳 1% or more, 🐬 0.1% to 1%, 🐟 0.01% to 0.1%, 🦐 less.";
