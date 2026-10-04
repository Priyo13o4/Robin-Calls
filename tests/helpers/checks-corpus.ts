/**
 * R1(a): concatenates every lib/scanner/checks/* module, in facade order.
 *
 * For pins whose subject spans several split modules (e.g. counting
 * INAPPLICABLE_SKIP uses across the family) a single-module readFile can no
 * longer see the whole picture. The list is EXPLICIT - never a glob - so a
 * dead module cannot silently ride along, and additions must be deliberate.
 */
import { readFileSync } from "node:fs";

const MODULES = [
  "shared",
  "critical-overrides",
  "subject-origin",
  "custody-materiality",
  "custody-findings",
  "holders-ownership",
  "market-checks",
  "provenance-history",
  "audit-scoring",
] as const;

export function checksCorpus(): string {
  return MODULES.map((m) =>
    readFileSync(new URL(`../../lib/scanner/checks/${m}.ts`, import.meta.url), "utf8"),
  ).join("\n");
}
