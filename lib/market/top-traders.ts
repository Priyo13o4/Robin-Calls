import { geckoTerminalNetwork } from "../config/chain";
import { recordProviderState } from "../observability/context";
import { marketRequestTimeoutMs, num } from "./provider";

/**
 * Top traders with behavior tags (v1.9 data output — NOT part of the formula).
 *
 * One GeckoTerminal call fetches the pool's recent trades (up to ~300, last
 * 24h); we aggregate per wallet and classify each by behavior the way a floor
 * trader would read the tape:
 *
 *   - `high-frequency-bot` a trade count or cadence no human produces by hand:
 *                          ≥ HF_TRADE_COUNT trades in the window, or ≥ 6 trades
 *                          with a median gap under HF_MEDIAN_GAP_S.
 *   - `wash-suspect`       balanced buy/sell ping-pong: both sides ≥ 4 and the
 *                          smaller side is ≥ 75% of the larger. This is the
 *                          §15.4 recycled-volume shape, per wallet.
 *
 * Tags describe the market, they do not score the token: a bot trading a token
 * is a fact about the bot. The wash-trading CHECK owns the verdict-side of this
 * signal; this table is its raw material, published so a reader can see who the
 * "volume" actually is. Untagged wallets are presumed human.
 *
 * ## There is deliberately no `sniper` tag (removed 2026-08-07)
 *
 * There was one — first trade within 120s of pool creation — and it could never
 * fire, because the only call site hardcoded `poolCreatedAt: null` and the rule
 * required it non-null. Its unit test *injected* the value and passed, so
 * nothing caught it (CLAUDE.md §8 #10).
 *
 * It was deleted rather than repaired, and the reason is not the bug. This feed
 * is ~300 trades over 24h returned **newest-first** — a recency filter, not a
 * sample, and biased against exactly the launch-window trades a "sniper" label
 * claims to describe. Publishing that label off this source asserts something
 * the source structurally cannot see. Restore it only alongside a real
 * early-buy feed keyed to the launch block; the rules to pair it with are in
 * `git show 1c2107c^:lib/scanner/snipers.ts`. See
 * `docs/ways-of-work/plan/swarm-detector/PRD.md` §6.
 */

export type TraderTag = "high-frequency-bot" | "wash-suspect";

export interface TopTrader {
  address: string;
  buys: number;
  sells: number;
  volumeUsd: number;
  firstTradeAt: string | null;
  lastTradeAt: string | null;
  tags: TraderTag[];
}

/** One normalized trade row — the classifier's only input shape. */
export interface TradeRow {
  wallet: string;
  kind: "buy" | "sell";
  volumeUsd: number;
  /** Unix seconds. */
  timestamp: number;
}

/** Trades per 24h window that no hand produces. */
const HF_TRADE_COUNT = 10;
/** Median seconds between trades below which cadence reads as scripted. */
const HF_MEDIAN_GAP_S = 60;
/** Trades to keep per side before ping-pong symmetry is worth reading. */
const WASH_MIN_SIDE = 4;
const WASH_SYMMETRY = 0.75;

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Pure tagging for one wallet's trades (exported for tests). */
export function tagsFor(trades: readonly TradeRow[]): TraderTag[] {
  const tags: TraderTag[] = [];
  const times = trades.map((t) => t.timestamp).sort((a, b) => a - b);
  const buys = trades.filter((t) => t.kind === "buy").length;
  const sells = trades.length - buys;

  const gaps = times.slice(1).map((t, i) => t - times[i]);
  const scriptedCadence =
    trades.length >= 6 && gaps.length > 0 && median([...gaps].sort((a, b) => a - b)) < HF_MEDIAN_GAP_S;
  if (trades.length >= HF_TRADE_COUNT || scriptedCadence) {
    tags.push("high-frequency-bot");
  }

  if (
    buys >= WASH_MIN_SIDE &&
    sells >= WASH_MIN_SIDE &&
    Math.min(buys, sells) / Math.max(buys, sells) >= WASH_SYMMETRY
  ) {
    tags.push("wash-suspect");
  }

  return tags;
}

/** Aggregate trades into a top-N-by-volume trader table (exported for tests). */
export function aggregateTraders(rows: readonly TradeRow[], top = 8): TopTrader[] {
  const byWallet = new Map<string, TradeRow[]>();
  for (const row of rows) {
    const key = row.wallet.toLowerCase();
    const list = byWallet.get(key);
    if (list) list.push(row);
    else byWallet.set(key, [row]);
  }

  const traders: TopTrader[] = [];
  for (const [address, trades] of byWallet) {
    const times = trades.map((t) => t.timestamp).sort((a, b) => a - b);
    traders.push({
      address,
      buys: trades.filter((t) => t.kind === "buy").length,
      sells: trades.filter((t) => t.kind === "sell").length,
      volumeUsd: Math.round(trades.reduce((s, t) => s + t.volumeUsd, 0) * 100) / 100,
      firstTradeAt: times.length ? new Date(times[0] * 1000).toISOString() : null,
      lastTradeAt: times.length ? new Date(times[times.length - 1] * 1000).toISOString() : null,
      tags: tagsFor(trades),
    });
  }
  return traders.sort((a, b) => b.volumeUsd - a.volumeUsd).slice(0, top);
}

interface GtTrade {
  attributes?: {
    tx_from_address?: string | null;
    kind?: string | null;
    volume_in_usd?: string | null;
    block_timestamp?: string | null;
  };
}

/**
 * Fetch + classify the pool's recent traders. Best-effort: null on any
 * provider failure — a missing table is a missing table, never a scan failure,
 * and its absence is visible in provider_states.
 */
export async function fetchTopTraders(poolAddress: string): Promise<TopTrader[] | null> {
  try {
    const res = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/${geckoTerminalNetwork}/pools/${poolAddress.toLowerCase()}/trades`,
      {
        headers: { accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(marketRequestTimeoutMs()),
      },
    );
    if (!res.ok) {
      recordProviderState("market:geckoterminal:trades", res.status === 429 ? "RATE_LIMITED" : res.status === 404 ? "NOT_FOUND" : "ERROR");
      return null;
    }
    const body = (await res.json()) as { data?: GtTrade[] };
    recordProviderState("market:geckoterminal:trades", "OK");
    const rows: TradeRow[] = (body.data ?? [])
      .map((t): TradeRow | null => {
        const a = t.attributes;
        const wallet = a?.tx_from_address;
        const kind = a?.kind;
        const ts = a?.block_timestamp ? Math.floor(Date.parse(a.block_timestamp) / 1000) : NaN;
        if (!wallet || (kind !== "buy" && kind !== "sell") || !Number.isFinite(ts)) return null;
        return { wallet, kind, volumeUsd: num(a?.volume_in_usd) ?? 0, timestamp: ts };
      })
      .filter((r): r is TradeRow => r !== null);
    if (rows.length === 0) return [];
    return aggregateTraders(rows);
  } catch {
    recordProviderState("market:geckoterminal:trades", "ERROR");
    return null;
  }
}
