/**
 * Shared coercion helpers for Postgres `numeric` columns.
 *
 * Drizzle maps `numeric` to `string` to preserve precision, so every
 * repository has to convert on the way in and out. Doing that inline with a
 * truthiness ternary (`n ? n.toString() : null`) silently turns a real `0`
 * into NULL — which is exactly wrong for this domain, where a liquidity of 0
 * means "fully drained" and is the strongest signal we have, not missing data.
 *
 * Use these instead of hand-rolling the conversion.
 */

/** Number → numeric-column string. Preserves 0; only null/undefined/NaN become NULL. */
export function toNumericString(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  return value.toString();
}

/** numeric-column string → number. Preserves 0; only null/undefined/unparseable become null. */
export function fromNumericString(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * numeric-column string → bigint wei. Exact.
 *
 * The reason this exists: `BigInt(Math.trunc(Number(s)))` was the idiom in
 * `applyFills`, and float64 carries only ~15-16 significant digits. Above
 * 2^53 wei — **0.009 ETH** — that round-trip silently rewrites the value.
 * Measured on prod 2026-08-23: 14 of 25 sampled pons-v2 `target_wei` rows
 * disagreed with the chain, e.g. `917162201643832986520` stored as
 * `917162201643833000000`. Round numbers like 4.2e18 survive exactly, which
 * is precisely why the bug hides — it only appears once a pad publishes a
 * non-round quantity.
 *
 * `numeric` may render with a fractional part (`'123.000'`); wei has none, so
 * anything after the point is dropped rather than throwing. Unparseable or
 * absent → the caller's fallback.
 */
export function bigintFromNumericString(
  value: string | null | undefined,
  fallback = 0n
): bigint {
  if (value === null || value === undefined) return fallback;
  const trimmed = value.trim();
  const digits = trimmed.split(".")[0];
  if (!/^-?\d+$/.test(digits)) return fallback;
  return BigInt(digits);
}
