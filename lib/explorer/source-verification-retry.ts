import { explorer } from "./blockscout";

/**
 * L59 (KNOWN-PROBLEMS) — `source_verification` published `{"is_verified":
 * false}` off ONE explorer call, and that bare boolean cannot distinguish "we
 * read it and it is unverified" from "the explorer never really answered".
 * Chain-verified 2026-08-28: Blockscout's `/addresses/<addr>` genuinely 500s
 * on `PonsV2LauncherToken` at roughly the rate a sustained outage would (5 of
 * 5 attempts in one live probe), while `/addresses` on a good call and
 * `/smart-contracts/<addr>` both agree the contract IS verified. Even
 * `lib/explorer/retry.ts`'s own retry (bumped by this same investigation to 3
 * attempts / 2000ms — still tuned to plain congestion, one gate upstream of
 * this module) exhausts inside a single `fetchOnce` call and gives up on the
 * SAME cached-negative read; once it does, the fallback adapter's thinner
 * answer can stand in for a question neither ever actually answered.
 *
 * Fix: never trust a LONE negative. A second, explicitly-gapped read of the
 * exact same question — long enough to plausibly outlast a short Blockscout
 * incident — decides whether `false` was real or noise. Three outcomes, never
 * two: `verified` (the retry disagreed and wins — a positive is the stronger
 * signal, same polarity as L39's corroboration), `unverified` (both reads
 * agree — a real negative), `unreadable` (the retry itself could not answer —
 * SKIP, never FAIL; §4's "an empty result is not a fact" applies to a RETRY's
 * emptiness exactly as much as a first read's).
 */

export type SourceVerificationReadStatus = "verified" | "unverified" | "unreadable";

/** PURE. */
export function classifySourceVerificationRetry(
  retryIsVerified: boolean | null | undefined,
): SourceVerificationReadStatus {
  if (retryIsVerified === true) return "verified";
  if (retryIsVerified === false) return "unverified";
  return "unreadable";
}

/**
 * Gap before the retry. Long enough to plausibly clear a Blockscout 500
 * window (measured live: consecutive failures across >1s spacing), short
 * enough not to meaningfully extend a scan that hits this branch — which per
 * L59's population is 15 tokens out of hundreds of published verdicts.
 */
const RETRY_GAP_MS = Number(process.env.SOURCE_VERIFICATION_RETRY_GAP_MS ?? 2_000);

/**
 * Impure shell. Called ONLY when a first read already answered `is_verified:
 * false` — never on `undefined` (already SKIP) or `true` (nothing to
 * corroborate). Bypasses `addressInfoCached`'s TTL cache deliberately: the
 * whole point is a genuinely NEW network read, not the same cached negative
 * played back.
 */
export async function reprobeSourceVerification(
  address: string,
): Promise<SourceVerificationReadStatus> {
  await new Promise((resolve) => setTimeout(resolve, RETRY_GAP_MS));
  const retry = await explorer.addressInfoDetailed(address).catch(() => null);
  return classifySourceVerificationRetry(retry?.info?.is_verified ?? null);
}
