const SUBSCRIPT_DIGITS = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"];

export function toSubscript(num: number): string {
  return String(num)
    .split("")
    .map((d) => SUBSCRIPT_DIGITS[Number(d)] ?? d)
    .join("");
}

export interface FormatDexPriceOptions {
  prefix?: string;
  maxSignificantDigits?: number;
}

/**
 * Formats a USD price like DexScreener:
 * - Prices >= $1.00: standard currency format (e.g. $1,234.56)
 * - Prices between $0.0001 and $1.00: standard 4 to 6 decimal format (e.g. $0.001234)
 * - Micro-prices (< $0.000001 or with >= 4 leading zeros): DexScreener subscript notation (e.g. $0.0₆603)
 * - Safely parses standard decimals and scientific notation (e.g. 6.03e-24 -> $0.0₂₃603)
 */
export function formatDexPrice(
  value: number | null | undefined,
  options?: FormatDexPriceOptions
): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
    return "—";
  }

  const prefix = options?.prefix ?? "$";
  const sigDigits = options?.maxSignificantDigits ?? 4;

  if (value >= 1) {
    return `${prefix}${value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: value >= 1000 ? 2 : 4,
    })}`;
  }

  if (value >= 0.0001) {
    return `${prefix}${value.toFixed(6)}`;
  }

  const str = value.toString();

  // Handle scientific notation e.g. 6.03e-24 or 1e-7
  if (str.includes("e-")) {
    const [mantissa, exponent] = str.split("e-");
    const exp = parseInt(exponent, 10);
    const cleanMantissa = mantissa.replace(".", "").slice(0, sigDigits);
    const zeroCount = exp - 1;
    return `${prefix}0.0${toSubscript(zeroCount)}${cleanMantissa}`;
  }

  // Handle standard decimal string e.g. 0.000000603
  const match = str.match(/^0\.(0+)(\d+)/);
  if (match) {
    const zeroCount = match[1].length;
    const cleanDigits = match[2].slice(0, sigDigits);
    if (zeroCount >= 4) {
      return `${prefix}0.0${toSubscript(zeroCount)}${cleanDigits}`;
    }
  }

  return `${prefix}${value.toFixed(6)}`;
}

/** Token names and symbols are whatever the deployer typed; one live symbol is 28,161 chars. */
export const MAX_SYMBOL_CHARS = 16;
export const MAX_NAME_CHARS = 48;
export function capLabel(label: string, max: number): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

/** Display copy of a token's labels, capped so one hostile token cannot break a layout. */
export function withCappedLabels<T extends { name: string; symbol: string; pairSymbol?: string; baseToken?: { name: string; symbol: string }; quoteToken?: { name: string; symbol: string } }>(t: T): T {
  const cap = <L extends { name: string; symbol: string }>(l: L): L =>
    ({ ...l, name: capLabel(l.name, MAX_NAME_CHARS), symbol: capLabel(l.symbol, MAX_SYMBOL_CHARS) });
  return {
    ...cap(t),
    ...(t.baseToken ? { baseToken: cap(t.baseToken) } : {}),
    ...(t.quoteToken ? { quoteToken: cap(t.quoteToken) } : {}),
    ...(t.pairSymbol ? { pairSymbol: t.pairSymbol.split(" / ").map((x) => capLabel(x, MAX_SYMBOL_CHARS)).join(" / ") } : {}),
  };
}

/** NaN means nobody measured it; "—" is the placeholder for that (CLAUDE.md §10), never 0. */
export const countText = (n: number) => (Number.isFinite(n) ? n.toLocaleString("en-US") : "—");
export const pctText = (n: number, digits = 2) => (Number.isFinite(n) ? `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%` : "—");
/** Buy share of a bar, or null when either side is unknown (the bar then renders neutral). */
export const buyShare = (buy: number, sell: number): number | null =>
  Number.isFinite(buy) && Number.isFinite(sell) && buy + sell > 0 ? Math.round((buy / (buy + sell)) * 100) : null;
