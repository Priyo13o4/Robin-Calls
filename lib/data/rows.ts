/**
 * Normalise what drizzle's `execute` hands back.
 *
 * It returns the DRIVER's result object, and the two drivers disagree:
 * postgres-js returns an array-like, node-postgres a `{ rows }`. Code that
 * assumes one shape reads an empty result on the other — silently, since both
 * are truthy objects.
 *
 * Written inline in `lib/data/ledger.ts` and assumed (array form only) in
 * `lib/data/marks.ts`. New callers use this.
 */
export function resultRows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const rows = (result as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}
