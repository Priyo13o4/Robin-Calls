/**
 * snake_case ↔ camelCase conversion for repositories that still expose the
 * pre-Drizzle snake_case row shape to their callers.
 *
 * These MUST be exact inverses over the column names they are applied to.
 * They were not, and the mismatch was silent in both directions:
 *
 *   write: `step_3_status` -> `step_3Status` (no such column, Drizzle drops it)
 *   read:  `step3Status`   -> `step3_status` (caller reads `step_3_status`)
 *
 * Net effect: whitelist step completion was never persisted, and never read
 * back, so auto-approval could not fire. Digits are part of these names and
 * must be treated as word boundaries on both sides.
 *
 * Prefer explicit column mapping in new code. Use these only where a legacy
 * snake_case caller contract has to be preserved, and cover the table's real
 * column list with a round-trip test (see tests/data-case.test.ts).
 */

/** `step_3_status` → `step3Status` */
export function snakeToCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

/** `step3Status` → `step_3_status` */
export function camelToSnake(key: string): string {
  return key
    .replace(/([a-z])([A-Z0-9])/g, "$1_$2")
    .replace(/([0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
}

/** Convert every key of a row to snake_case (read path). */
export function rowToSnakeCase<T extends Record<string, unknown>>(
  row: T
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [camelToSnake(key), value])
  );
}
