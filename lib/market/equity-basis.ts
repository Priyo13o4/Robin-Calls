import type { EquityReference } from "./equity-reference";
import type { RwaQuoteResult } from "./rwa-quotes";

export type MarketPriceRead =
  | { kind: "price"; usd: number }
  | { kind: "no-pool" }
  | { kind: "unavailable" };

export interface EquityBasisView {
  tone: "neutral" | "warn";
  lines: string[];
  premiumBps: number | null;
  referencePriceUsd: number | null;
  referenceStatus: "unavailable" | "halted" | "stale" | "live" | "no-pool" | "market-unavailable";
  referenceTime: string | null;
  shareRatio: string | null;
  pendingCorporateAction: boolean;
}

// Convert RWA DexScreener batch results to market price state.
export function marketPriceFrom(result: RwaQuoteResult, address: string): MarketPriceRead {
  if (!result.complete) {
    return { kind: "unavailable" };
  }

  const target = address.trim().toLowerCase();
  if (!result.quotes.has(target)) {
    return { kind: "no-pool" };
  }

  const quote = result.quotes.get(target);
  if (
    !quote ||
    quote.priceUsd == null ||
    quote.priceUsd <= 0 ||
    !Number.isFinite(quote.priceUsd)
  ) {
    return { kind: "unavailable" };
  }

  return { kind: "price", usd: quote.priceUsd };
}

function formatMoney(val: number): string {
  return "$" + val.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPercent(bps: number): string {
  return (Math.abs(bps) / 100).toFixed(2) + "%";
}

function formatUtcTime(generatedAt: string): string | null {
  const d = new Date(generatedAt);
  // Never print a time we did not read: an unparseable stamp has no time to show.
  if (Number.isNaN(d.getTime())) return null;
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} UTC`;
}

// Pure presenter: compares Robinhood stock reference price to on-chain pool pricing.
export function describeEquityBasis(
  ref: EquityReference,
  market: MarketPriceRead,
): EquityBasisView | null {
  if (ref.kind === "not-equity") {
    return null;
  }

  if (ref.kind === "unavailable") {
    return {
      tone: "warn",
      lines: ["We could not load Robinhood's price for this stock."],
      premiumBps: null,
      referencePriceUsd: null,
      referenceStatus: "unavailable",
      referenceTime: null,
      shareRatio: null,
      pendingCorporateAction: false,
    };
  }

  if (ref.kind === "halted") {
    return {
      tone: "warn",
      lines: [`Trading in ${ref.symbol} is halted, so there is no live reference price.`],
      premiumBps: null,
      referencePriceUsd: null,
      referenceStatus: "halted",
      referenceTime: null,
      shareRatio: null,
      pendingCorporateAction: false,
    };
  }

  let tone: "neutral" | "warn" = "neutral";
  const lines: string[] = [];
  let premiumBps: number | null = null;

  if (ref.stale) {
    tone = "neutral";
    const timeStr = formatUtcTime(ref.generatedAt);
    lines.push(
      timeStr
        ? `Robinhood's last price for ${ref.symbol} is from ${timeStr}, so we do not compare it with the on-chain price.`
        : `Robinhood's last price for ${ref.symbol} carries no time, so we do not compare it with the on-chain price.`,
    );
  } else if (market.kind === "price") {
    const bps = Math.round(((market.usd - ref.tokenReferenceUsd) / ref.tokenReferenceUsd) * 10_000);
    const absBps = Math.abs(bps);
    const marketStr = formatMoney(market.usd);
    const refStr = formatMoney(ref.tokenReferenceUsd);

    premiumBps = bps;

    if (absBps < 10) {
      tone = "neutral";
      lines.push(
        `${ref.symbol} tokens trade at ${marketStr} on chain, in line with Robinhood's price of ${refStr}.`,
      );
    } else {
      tone = absBps >= 500 ? "warn" : "neutral";
      const pct = formatPercent(bps);
      const direction = bps >= 0 ? "above" : "below";
      lines.push(
        `${ref.symbol} tokens trade at ${marketStr} on chain, ${pct} ${direction} Robinhood's price of ${refStr}.`,
      );
    }
  } else if (market.kind === "no-pool") {
    tone = "neutral";
    const refStr = formatMoney(ref.tokenReferenceUsd);
    lines.push(
      `Robinhood's price for one ${ref.symbol} token is ${refStr}. No pool trades it on chain yet.`,
    );
  } else {
    tone = "warn";
    const refStr = formatMoney(ref.tokenReferenceUsd);
    lines.push(
      `Robinhood's price for one ${ref.symbol} token is ${refStr}. We could not load the on-chain price.`,
    );
  }

  if (ref.multiplier !== 1) {
    lines.push(`One token tracks ${ref.multiplierText} shares.`);
  }

  if (ref.pendingMultiplier) {
    lines.push("A corporate action is pending, so that ratio is about to change.");
    tone = "warn";
  }

  return {
    tone,
    lines,
    premiumBps,
    referencePriceUsd: ref.tokenReferenceUsd,
    referenceStatus: ref.stale ? "stale"
      : market.kind === "price" ? "live"
      : market.kind === "no-pool" ? "no-pool"
      : "market-unavailable",
    referenceTime: formatUtcTime(ref.generatedAt),
    shareRatio: ref.multiplier !== 1 ? ref.multiplierText : null,
    pendingCorporateAction: ref.pendingMultiplier,
  };
}
