/**
 * Shared CSV flattening for admin exports (was duplicated once already in
 * logs/export/route.ts — AGENTS.md §2: extract on the second write, not the
 * eighth).
 */

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(
  columns: readonly string[],
  rows: Record<string, unknown>[],
): string {
  const lines = [columns.join(",")];
  for (const row of rows) lines.push(columns.map((c) => csvCell(row[c])).join(","));
  return lines.join("\n");
}

/** Timestamp suffix used across admin CSV filenames, e.g. "2026-08-27-14-05-00". */
export function csvFilenameStamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}
