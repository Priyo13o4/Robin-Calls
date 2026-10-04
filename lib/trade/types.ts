import { formatUnits } from "viem";
import type { LaunchFeedRow } from "@/lib/launches/feed-types";
import { rowRaisedDisplay } from "@/lib/launches/raised";
import { ROBINHOOD_CHAIN_ID, ROBINHOOD_TESTNET_CHAIN_ID, explorerWebUrl } from "@/lib/config/chain";

export interface SelectableToken {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  priceUsd: number;
  priceEth: number;
  balance: number;
  rawBalance?: bigint;
  balanceStatus?: "loaded" | "loading" | "error" | "disconnected";
  volume24h?: number;
  category?: "crypto" | "stocks" | "ecosystem";
  imageUrl?: string;
  isNative?: boolean;
  iconBg?: string;
  iconColor?: string;
  iconLabel?: string;
}

/**
 * Canonical base tokens by Chain ID.
 * Mirrors Uniswap's `COMMON_BASES` pattern.
 *
 * To add a new chain in the future (e.g. Ethereum Mainnet `1`, Base `8453`,
 * Arbitrum `42161`), simply register its canonical gas and quote tokens here.
 * The UI and API will automatically retrieve the correct base tokens for the
 * active chain.
 */
export const COMMON_BASES_BY_CHAIN: Record<number, SelectableToken[]> = {
  // Robinhood Chain Mainnet (4663)
  [ROBINHOOD_CHAIN_ID]: [
    {
      symbol: "ETH",
      name: "Ethereum",
      address: "0x0000000000000000000000000000000000000000",
      decimals: 18,
      priceUsd: 0,
      priceEth: 1.0,
      balance: 0,
      isNative: true,
      category: "crypto",
      volume24h: 0,
      iconBg: "bg-[#2b59c3]",
      iconColor: "text-white",
      iconLabel: "Ξ",
    },
    {
      symbol: "USDG",
      name: "Global Dollar",
      address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
      decimals: 6,
      priceUsd: 1.0,
      priceEth: 0,
      balance: 0,
      category: "crypto",
      volume24h: 0,
      imageUrl: "/brand/usdg.svg",
      iconBg: "bg-[#1f9d55]",
      iconColor: "text-white",
      iconLabel: "$",
    },
    {
      symbol: "WETH",
      name: "Wrapped Ether",
      address: "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
      decimals: 18,
      priceUsd: 0,
      priceEth: 1.0,
      balance: 0,
      category: "crypto",
      volume24h: 0,
      imageUrl:
        "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/logo.png",
    },
  ],

  // Robinhood Chain Testnet (46630)
  [ROBINHOOD_TESTNET_CHAIN_ID]: [
    {
      symbol: "ETH",
      name: "Testnet Ether",
      address: "0x0000000000000000000000000000000000000000",
      decimals: 18,
      priceUsd: 0,
      priceEth: 1.0,
      balance: 0,
      isNative: true,
      category: "crypto",
      volume24h: 0,
      iconBg: "bg-[#2b59c3]",
      iconColor: "text-white",
      iconLabel: "Ξ",
    },
  ],
};

/**
 * Returns canonical base swap tokens for a given chainId.
 * Defaults to Robinhood Chain (4663) if chainId is omitted or unsupported.
 */
export function getBaseSwapTokens(chainId: number = ROBINHOOD_CHAIN_ID): SelectableToken[] {
  return COMMON_BASES_BY_CHAIN[chainId] ?? COMMON_BASES_BY_CHAIN[ROBINHOOD_CHAIN_ID] ?? [];
}

/** Backward-compatible export defaulting to Robinhood Chain (4663) */
export const BASE_SWAP_TOKENS: SelectableToken[] = COMMON_BASES_BY_CHAIN[ROBINHOOD_CHAIN_ID];

export interface TokenMarketData {
  address: string;
  name: string;
  symbol: string;
  pairAddress: string;
  pairSymbol: string; // e.g. "HOOD / WETH", "TSLA / USDG", "URANUS / ETH"
  baseToken: {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
  };
  venue: string; // "Uniswap V4", "Pons V2", "Flap", "Doppler", "Robinhood Equity", etc.
  isBondingCurve: boolean;
  bondingProgress?: number; // 0 to 100%
  raisedText?: string; // e.g. "24.50 DJT", "4.20 ETH", "5.2K USDG"
  isStock?: boolean;
  launchpadUrl?: string;
  launchpadName?: string;
  priceUsd: number;
  priceEth: number;
  /** Price in this market's quote token; absent when that conversion is unknown. */
  priceQuote?: number | null;
  fdv: number;
  marketCap: number;
  liquidityUsd: number;
  /** Launch registry observed and confirmed a liquidity pull; never revive it from a stale quote. */
  liquidityPulled?: boolean;
  volume24h: number;
  txns24h: {
    total: number;
    buys: number;
    sells: number;
  };
  volumeBreakdown24h: {
    buyUsd: number;
    sellUsd: number;
  };
  traders24h: {
    total: number;
    buyers: number;
    sellers: number;
  };
  priceChange: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  timeframeMetrics?: {
    "5m": {
      txns: { total: number; buys: number; sells: number };
      volume: { totalUsd: number; buyUsd: number; sellUsd: number };
      traders: { total: number; buyers: number; sellers: number };
    };
    "1h": {
      txns: { total: number; buys: number; sells: number };
      volume: { totalUsd: number; buyUsd: number; sellUsd: number };
      traders: { total: number; buyers: number; sellers: number };
    };
    "6h": {
      txns: { total: number; buys: number; sells: number };
      volume: { totalUsd: number; buyUsd: number; sellUsd: number };
      traders: { total: number; buyers: number; sellers: number };
    };
    "24h": {
      txns: { total: number; buys: number; sells: number };
      volume: { totalUsd: number; buyUsd: number; sellUsd: number };
      traders: { total: number; buyers: number; sellers: number };
    };
  };
  age: string;
  /** Pool (DexScreener) or launch creation time. `age` is display text and must not be sorted. */
  createdAtMs?: number | null;
  rank: number;
  avatarUrl?: string;
  headerUrl?: string;
  socials: {
    website?: string;
    twitter?: string;
    telegram?: string;
    explorer?: string;
  };
  pooled: {
    baseAmount: number;
    baseUsd: number;
    quoteAmount: number;
    quoteUsd: number;
  };
  auditVerdict: {
    score: number;
    tier: "VERIFIED" | "CLEAN" | "CAUTION" | "CRITICAL" | "UNSCANNED";
    honeypotPass: boolean;
    mintable: boolean;
    liquidityLocked: boolean;
    lockedPct: number;
  };
  boostScore?: number;
  dexVersion?: string;
  dexId?: string;
}

export type TimeframePeriod = "5m" | "1h" | "6h" | "24h";

/**
 * Real numbers only. A window nothing measured comes back NaN (renders "—"): the old fallback
 * scaled 24h by fixed ratios with floors, so a dead token showed 12 trades and $1,000 in 5m.
 */
export function getTimeframeMetrics(token: TokenMarketData, period: TimeframePeriod) {
  if (token.timeframeMetrics?.[period]) {
    return token.timeframeMetrics[period];
  }
  const known = period === "24h";
  return {
    txns: known ? token.txns24h : { total: NaN, buys: NaN, sells: NaN },
    volume: known
      ? { totalUsd: token.volume24h, buyUsd: token.volumeBreakdown24h.buyUsd, sellUsd: token.volumeBreakdown24h.sellUsd }
      : { totalUsd: NaN, buyUsd: NaN, sellUsd: NaN },
    traders: known ? token.traders24h : { total: NaN, buyers: NaN, sellers: NaN },
  };
}

const UNKNOWN_TRADERS = { total: NaN, buyers: NaN, sellers: NaN };

export interface TransactionRow {
  id: string;
  date: string;
  type: "buy" | "sell";
  usdAmount: number;
  tokenAmount: number;
  ethAmount: number;
  priceUsd: number;
  traderAddress: string;
  txHash: string;
  timestamp?: number;
}

export interface HolderRow {
  rank: number;
  address: string;
  tag?: string;
  percentage: number;
  amount: number;
  valueUsd: number;
  /** Balance in base units, for pricing the exact amount (lib/trade/holder-exit.ts). */
  raw?: string;
}

export interface TopTraderRow {
  rank: number;
  address: string;
  pnlUsd: number;
  roi?: number;
  txns?: number;
  pnlPct?: number;
  boughtUsd?: number;
  soldUsd?: number;
  txCount?: number;
}

// Canonical Robinhood Chain Stock Tokens and ETFs from 0018_registry_seed.sql
export const CANONICAL_STOCK_SYMBOLS = new Set([
  "AAPL", "AMD", "AMZN", "BABA", "BE", "COIN", "CRCL", "CRWV", "GOOGL",
  "INTC", "META", "MSFT", "MU", "NVDA", "ORCL", "PLTR", "SNDK", "SPCX",
  "TSLA", "USAR", "QQQ", "SGOV", "SLV", "SPY", "CUSO", "HOOD", "DJT",
  "GME", "RDDT", "MSTR", "AMC", "GLD", "RBLX", "LULU", "COST", "SNAP",
  "USO", "LLY", "BB", "NFLX", "PFE", "UPS", "IBM", "DELL", "BULL",
  "MRVL", "INDA", "F", "TSM", "SKHY", "JNJ", "FIG", "SHOP", "MRNA",
  "NU", "RIVN", "QUBT", "RCAT", "WYFI", "BA", "SNOW", "NET", "ORBIO"
]);

export const CANONICAL_STOCK_ADDRESSES = new Set([
  "0x274c8c4665c0343730c78b184e560f902a8bf200", // HOOD
  "0x322f0929c4625ed5bad873c95208d54e1c003b2d", // TSLA
  "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9", // AAPL
  "0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec", // NVDA
  "0x117cc2133c37b721f49de2a7a74833232b3b4c0c", // SPY
  "0x12f190a9f9d7d37a250758b26824b97ce941bf54", // AMZN
  "0xe93237c50d904957cf27e7b1133b510c669c2e74", // MSFT
  "0xc0d6457c16cc70d6790dd43521c899c87ce02f35", // META
  "0x2e0847e8910a9732eb3fb1bb4b70a580adad4fe3", // GOOGL
  "0x6330d8c3178a418788df01a47479c0ce7ccf450b", // COIN
  "0x894e1ec2d74ffe5aef8dc8a9e84686accb964f2a", // PLTR
  "0x4a0e65a3eccec6dbe60ae065f2e7bb85fae35eea", // SPCX
  "0xd5f3879160bc7c32ebb4dc785f8a4f505888de68", // QQQ
]);

export function getQuotePriceUsd(
  symbol: string | null | undefined,
  liveQuotePriceUsd?: number | null,
): number {
  if (liveQuotePriceUsd && Number.isFinite(liveQuotePriceUsd) && liveQuotePriceUsd > 0) {
    return liveQuotePriceUsd;
  }
  if (!symbol) return 0;
  const s = symbol.toUpperCase();
  if (s === "USDG" || s === "USDC" || s === "USDT" || s === "DAI") return 1.0;
  return 0;
}

export function isStockToken(address: string, symbol: string): boolean {
  if (CANONICAL_STOCK_ADDRESSES.has(address.toLowerCase())) return true;
  if (CANONICAL_STOCK_SYMBOLS.has(symbol.toUpperCase())) return true;
  return false;
}

export function formatTokenPrice(priceUsd: number, isStock: boolean = false): string {
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) return "$0.00";
  if (isStock || priceUsd >= 1) {
    return "$" + priceUsd.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  if (priceUsd < 0.0001) {
    return formatSubscriptPrice(priceUsd, isStock);
  }
  return "$" + priceUsd.toFixed(6);
}

/**
 * Formats low micro-prices with subscript zero count (e.g. $0.0₄5757 instead of scientific notation),
 * exactly matching DexScreener's price column representation.
 */
export function formatSubscriptPrice(val: number, isStock: boolean = false): string {
  if (!Number.isFinite(val) || val <= 0) return "$0.00";
  if (isStock || val >= 1) {
    return "$" + val.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: val >= 100 ? 2 : 4,
    });
  }
  if (val >= 0.0001) {
    return "$" + val.toFixed(6);
  }
  const str = val.toFixed(14);
  const match = str.match(/^0\.(0+)(\d+)/);
  if (match) {
    const zeroCount = match[1].length;
    const digits = match[2].slice(0, 4);
    const subscriptDigits = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"];
    const sub = String(zeroCount).split("").map((c) => subscriptDigits[Number(c)] ?? c).join("");
    return `$0.0${sub}${digits}`;
  }
  return "$" + val.toFixed(6);
}

export function formatCompactUsd(val: number): string {
  if (!Number.isFinite(val)) return "—"; // unmeasured, never "$0"
  if (val <= 0) return "$0";
  if (val >= 1_000_000_000) {
    return `$${(val / 1_000_000_000).toFixed(2)}B`;
  }
  if (val >= 1_000_000) {
    return `$${(val / 1_000_000).toFixed(2)}M`;
  }
  if (val >= 1_000) {
    return `$${Math.round(val / 1_000)}K`;
  }
  return `$${val.toFixed(2)}`;
}

export function formatTimeAgo(isoOrDate: string | number | null | undefined): string {
  if (!isoOrDate) return "—";
  const time = typeof isoOrDate === "string" ? new Date(isoOrDate).getTime() : isoOrDate;
  if (!Number.isFinite(time)) return "—";
  const diffSec = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d`;
}

import { resolveLaunchpadUrl, type LaunchpadConfigLike } from "@/lib/launches/launchpad-url";
export { resolveLaunchpadUrl, type LaunchpadConfigLike };

export type QuotePriceLookup =
  | ((symbol: string | null | undefined, address: string | null | undefined) => number | null | undefined)
  | Record<string, number>
  | Map<string, number>;

/**
 * Maps a database LaunchFeedRow to TokenMarketData for the DexScreener terminal.
 */
export function launchFeedRowToTokenMarketData(
  row: LaunchFeedRow,
  rank: number = 1,
  launchpads?: LaunchpadConfigLike[],
  quotePriceLookup?: QuotePriceLookup,
): TokenMarketData {
  const isBonding = row.venue_model === "BONDING_CURVE" && !row.pool_address;
  const rawSymbol = (row.token_symbol || "UNKNOWN").toUpperCase();
  const rawName = row.token_name || rawSymbol;
  const address = row.token_address;
  const isStock = isStockToken(address, rawSymbol);

  // Quote asset resolution (never assume ETH blindly)
  const quoteSymbol = row.quote_symbol || (row.quote_token ? `${row.quote_token.slice(0, 6)}…` : "ETH");
  const quoteDecimals = row.quote_decimals ?? 18;
  const quoteAddress = row.quote_token || "0x0000000000000000000000000000000000000000";
  const quoteHasAddress = Boolean(row.quote_token && row.quote_token.toLowerCase() !== "0x0000000000000000000000000000000000000000");
  const knownQuoteDecimals = row.quote_decimals !== null && Number.isInteger(row.quote_decimals) && row.quote_decimals >= 0 && row.quote_decimals <= 255
    ? row.quote_decimals
    : (!quoteHasAddress && (!row.quote_symbol || row.quote_symbol.toUpperCase() === "ETH") ? 18 : null);

  let liveQuotePriceUsd: number | null | undefined = undefined;
  if (typeof quotePriceLookup === "function") {
    liveQuotePriceUsd = quotePriceLookup(row.quote_symbol, row.quote_token);
  } else if (quotePriceLookup instanceof Map) {
    const byToken = row.quote_token ? quotePriceLookup.get(row.quote_token.toLowerCase()) : undefined;
    const bySymbol = !quoteHasAddress && row.quote_symbol ? quotePriceLookup.get(row.quote_symbol.toUpperCase()) : undefined;
    liveQuotePriceUsd = byToken ?? bySymbol;
  } else if (quotePriceLookup && typeof quotePriceLookup === "object") {
    const byToken = row.quote_token ? (quotePriceLookup as Record<string, number>)[row.quote_token.toLowerCase()] : undefined;
    const bySymbol = !quoteHasAddress && row.quote_symbol ? (quotePriceLookup as Record<string, number>)[row.quote_symbol.toUpperCase()] : undefined;
    liveQuotePriceUsd = byToken ?? bySymbol;
  }

  // When a quote has an address, a matching ticker elsewhere is not its price.
  const quotePriceUsd = quoteHasAddress && quotePriceLookup
    ? (liveQuotePriceUsd && Number.isFinite(liveQuotePriceUsd) && liveQuotePriceUsd > 0 ? liveQuotePriceUsd : 0)
    : getQuotePriceUsd(row.quote_symbol, liveQuotePriceUsd);

  // Liquidity and raise
  let liqUsd = row.liquidity_usd ?? 0;
  // Null is "not measured", not "$0" (§8 #3): NaN renders "—". A curve's volume is its
  // indexed quote flow priced in USD, so it also needs a decimals read and a quote price.
  let vol24h = row.volume_24h_usd ?? NaN;
  const buys = row.buys_24h ?? 0;
  const sells = row.sells_24h ?? 0;
  const totalTx = buys + sells;
  const pChangeH1 = row.price_change_h1 ?? NaN;

  // Real raise display (e.g. "24.50 DJT", "5,000 USDG", "4.20 ETH")
  const raisedText = rowRaisedDisplay(row);
  const bondingProgress = row.progress_bps ? Math.min(100, Math.max(0, Math.round(row.progress_bps / 100))) : 0;

  // Convert curve raised_wei to estimated USD liquidity if no DEX pool exists yet
  let raisedUsd = 0;
  if (row.raised_wei && knownQuoteDecimals !== null) {
    try {
      const rawUnits = parseFloat(formatUnits(BigInt(row.raised_wei), knownQuoteDecimals));
      if (Number.isFinite(rawUnits) && quotePriceUsd > 0) {
        raisedUsd = rawUnits * quotePriceUsd;
      }
    } catch {
      raisedUsd = 0;
    }
  }

  if (isBonding && liqUsd === 0 && raisedUsd > 0) {
    liqUsd = raisedUsd;
  }

  if (isBonding && !Number.isFinite(vol24h) && row.volume_24h_quote != null && knownQuoteDecimals !== null) {
    try {
      const quoteUnits = parseFloat(formatUnits(BigInt(row.volume_24h_quote), knownQuoteDecimals));
      if (Number.isFinite(quoteUnits)) {
        if (quoteUnits === 0) vol24h = 0;
        else if (quotePriceUsd > 0) vol24h = quoteUnits * quotePriceUsd;
      }
    } catch {
      // Unparseable quote volume stays unmeasured.
    }
  }

  // Price, Market Cap, and FDV calculation per pair type
  let priceUsd = 0;
  let mcap = 0;
  let fdv = 0;

  if (isStock) {
    // Stock / ETF tokenized asset
    priceUsd = liqUsd > 0 && vol24h > 0 ? liqUsd / 500_000 : 0;
    // On-chain supply of 1,000,000 tokens standard for Robinhood Chain stock assets
    mcap = Math.round(priceUsd * 1_000_000);
    fdv = mcap;
    if (liqUsd === 0) {
      liqUsd = Math.round(mcap * 0.15); // Fallback TVL representation if pool snapshot pending
    }
  } else if (isBonding) {
    // Curve tokens (Pons, Flap, Doppler)
    const targetMcapUsd = 69_000; // Target curve graduation valuation
    fdv = targetMcapUsd;
    mcap = Math.round(Math.max(5_000, targetMcapUsd * (Math.max(bondingProgress, 1) / 100)));
    priceUsd = mcap / 1_000_000_000; // Same estimate as the FDV column, so every curve is not one price
  } else {
    // Direct DEX / Graduated meme tokens
    mcap = liqUsd > 0 ? Math.round(liqUsd * 2) : 10_000;
    fdv = mcap;
    priceUsd = vol24h > 0 ? (liqUsd / Math.max(10_000, totalTx * 1000)) : (liqUsd / 1_000_000);
  }

  // Venue identification
  let venueName: string;
  if (isStock) {
    venueName = rawSymbol === "SPY" || rawSymbol === "QQQ" ? "Robinhood ETF" : "Robinhood Equity";
  } else if (isBonding) {
    venueName = row.launchpad_name || "Bonding Curve";
  } else {
    venueName = row.launchpad_name ? `${row.launchpad_name} (Graduated)` : "Direct DEX";
  }

  const realPadUrl =
    resolveLaunchpadUrl(
      {
        token_address: address,
        launchpad_slug: row.launchpad_slug,
        launchpad_name: row.launchpad_name,
      },
      launchpads,
    ) ?? undefined;

  return {
    address,
    name: rawName,
    symbol: rawSymbol,
    pairAddress: row.pool_address || address,
    pairSymbol: `${rawSymbol} / ${quoteSymbol}`,
    baseToken: {
      address,
      name: rawName,
      symbol: rawSymbol,
      decimals: 18,
    },
    quoteToken: {
      address: quoteAddress,
      name: quoteSymbol,
      symbol: quoteSymbol,
      decimals: quoteDecimals,
    },
    venue: venueName,
    isBondingCurve: isBonding,
    bondingProgress,
    raisedText,
    isStock,
    launchpadName: row.launchpad_name || undefined,
    launchpadUrl: realPadUrl,
    priceUsd,
    priceEth: priceUsd > 0 && quotePriceUsd > 0 ? priceUsd / quotePriceUsd : 0,
    fdv,
    marketCap: mcap,
    liquidityUsd: liqUsd,
    liquidityPulled: row.liquidity_pulled,
    volume24h: vol24h,
    txns24h: {
      total: totalTx,
      buys,
      sells,
    },
    // Only what the launch feed measured: no buy/sell volume split, no trader counts, 1h change only.
    volumeBreakdown24h: { buyUsd: NaN, sellUsd: NaN },
    traders24h: UNKNOWN_TRADERS,
    priceChange: {
      m5: NaN,
      h1: pChangeH1,
      h6: NaN,
      h24: NaN,
    },
    age: formatTimeAgo(row.created_at),
    createdAtMs: row.created_at ? Date.parse(row.created_at) || null : null,
    rank,
    avatarUrl: row.metadata_uri || undefined,
    socials: {
      explorer: `${explorerWebUrl}/token/${address}`,
    },
    pooled: {
      baseAmount: 0,
      baseUsd: Math.round(liqUsd * 0.5),
      quoteAmount: 0,
      quoteUsd: Math.round(liqUsd * 0.5),
    },
    auditVerdict: {
      score: row.verdict?.score ?? (isStock ? 100 : 0),
      tier: (row.verdict?.tier as any) || (isStock ? "VERIFIED" : "UNSCANNED"),
      honeypotPass: row.verdict?.tier !== "CRITICAL",
      mintable: false,
      liquidityLocked: !row.liquidity_pulled,
      lockedPct: row.liquidity_pulled ? 0 : 100,
    },
  };
}

/**
 * Maps a DexScreener pair response to TokenMarketData.
 */
interface DexWindowSource {
  txns?: Partial<Record<"m5" | "h1" | "h6" | "h24", { buys?: number; sells?: number }>>;
  volume?: Partial<Record<"m5" | "h1" | "h6" | "h24", number>>;
}

function dexWindow(pair: DexWindowSource, w: "m5" | "h1" | "h6" | "h24") {
  const buys = Number(pair.txns?.[w]?.buys ?? NaN);
  const sells = Number(pair.txns?.[w]?.sells ?? NaN);
  return {
    txns: { total: buys + sells, buys, sells },
    volume: { totalUsd: Number(pair.volume?.[w] ?? NaN), buyUsd: NaN, sellUsd: NaN },
    traders: UNKNOWN_TRADERS,
  };
}

export function dexPairToTokenMarketData(pair: any, rank: number = 1): TokenMarketData {
  const baseToken = pair.baseToken || {};
  const quoteToken = pair.quoteToken || {};
  const symbol = (baseToken.symbol || "TKN").toUpperCase();
  const address = baseToken.address || pair.pairAddress || "";
  const isStock = isStockToken(address, symbol);

  const pUsd = Number(pair.priceUsd ?? 0);
  const pEth = Number(pair.priceNative ?? 0);
  const totalLiqUsd = Number(pair.liquidity?.usd ?? 0);
  const vol24 = Number(pair.volume?.h24 ?? 0);

  const buys24 = pair.txns?.h24?.buys ?? 0;
  const sells24 = pair.txns?.h24?.sells ?? 0;

  // Absent is unknown, not "no change": NaN renders "—" and sorts last.
  const m5 = Number(pair.priceChange?.m5 ?? NaN);
  const h1 = Number(pair.priceChange?.h1 ?? NaN);
  const h6 = Number(pair.priceChange?.h6 ?? NaN);
  const h24 = Number(pair.priceChange?.h24 ?? NaN);

  const labelSuffix = pair.labels?.[0] ? ` ${String(pair.labels[0]).toUpperCase()}` : "";
  const venueBase = pair.dexId === "uniswap"
    ? "Uniswap"
    : pair.dexId
      ? pair.dexId.charAt(0).toUpperCase() + pair.dexId.slice(1)
      : "Direct DEX";
  const venue = isStock
    ? (symbol === "SPY" || symbol === "QQQ" ? "Robinhood ETF" : "Robinhood Equity")
    : `${venueBase}${labelSuffix}`;

  const quoteSym = quoteToken.symbol || "ETH";

  return {
    address,
    name: baseToken.name || symbol,
    symbol,
    pairAddress: pair.pairAddress || address,
    pairSymbol: `${symbol} / ${quoteSym}`,
    baseToken: {
      address,
      name: baseToken.name || symbol,
      symbol,
      decimals: 18,
    },
    quoteToken: {
      address: quoteToken.address || "0x0000000000000000000000000000000000000000",
      name: quoteSym,
      symbol: quoteSym,
      decimals: 18,
    },
    venue,
    isBondingCurve: false,
    isStock,
    priceUsd: pUsd,
    priceEth: pEth,
    priceQuote: Number.isFinite(pEth) && pEth > 0 ? pEth : null,
    fdv: Number(pair.fdv ?? pair.marketCap ?? NaN),
    marketCap: Number(pair.marketCap ?? pair.fdv ?? NaN),
    liquidityUsd: totalLiqUsd,
    volume24h: vol24,
    txns24h: {
      total: buys24 + sells24,
      buys: buys24,
      sells: sells24,
    },
    // DexScreener gives trades and volume per window, but no buy/sell volume split and no
    // trader counts. Those stay NaN ("—"); they were 52/48 and trades x 0.35, both invented.
    volumeBreakdown24h: { buyUsd: NaN, sellUsd: NaN },
    traders24h: UNKNOWN_TRADERS,
    timeframeMetrics: {
      "5m": dexWindow(pair, "m5"),
      "1h": dexWindow(pair, "h1"),
      "6h": dexWindow(pair, "h6"),
      "24h": dexWindow(pair, "h24"),
    },
    priceChange: { m5, h1, h6, h24 },
    age: formatTimeAgo(pair.pairCreatedAt),
    createdAtMs: typeof pair.pairCreatedAt === "number" && pair.pairCreatedAt > 0 ? pair.pairCreatedAt : null,
    rank,
    avatarUrl: pair.info?.imageUrl,
    headerUrl: pair.info?.header,
    boostScore: Number(pair.boosts?.active ?? pair.boostScore ?? 0),
    dexVersion: pair.labels?.[0]?.toLowerCase() || undefined,
    dexId: pair.dexId || undefined,
    socials: {
      website: pair.info?.websites?.[0]?.url,
      twitter: pair.info?.socials?.find((s: any) => s.type === "twitter")?.url,
      telegram: pair.info?.socials?.find((s: any) => s.type === "telegram")?.url,
      explorer: `${explorerWebUrl}/token/${address}`,
    },
    pooled: {
      baseAmount: Number(pair.liquidity?.base ?? 0),
      baseUsd: Math.round(Number(pair.liquidity?.base ?? NaN) * pUsd),
      quoteAmount: Number(pair.liquidity?.quote ?? 0),
      quoteUsd: Math.round(totalLiqUsd - Number(pair.liquidity?.base ?? NaN) * pUsd),
    },
    // A DexScreener pair has not been scanned. This was a hardcoded CLEAN / locked 100%.
    auditVerdict: {
      score: 0,
      tier: isStock ? "VERIFIED" : "UNSCANNED",
      honeypotPass: false,
      mintable: false,
      liquidityLocked: false,
      lockedPct: 0,
    },
  };
}
