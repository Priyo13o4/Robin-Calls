import { NextRequest, NextResponse } from "next/server";
import { normalizeAddress } from "@/lib/scanner/metadata";
import { latestVerdictRowForToken } from "@/lib/data/ledger";
import { fetchTopTraders, type TopTrader } from "@/lib/market/top-traders";

/**
 * M18 — v1.9 top-traders enrichment (high-frequency-bot /
 * wash-suspect tags), relocated off the scan critical path. This table is
 * market description, never scoring (see lib/market/top-traders.ts's own
 * doc comment) — pipeline.ts no longer computes it inside the verdict's
 * Promise.all, so the client fetches it here, after the verdict itself has
 * already rendered.
 *
 * Read-only and best-effort: no scan coordination, no rate-limit admission,
 * never mints a verdict or a receipt. A short edge cache keeps repeat
 * requests for the same token from re-hitting GeckoTerminal.
 */

/**
 * Resolve a token address to its top-traders table via the latest verdict on
 * record. Exported (not just the route handler) so tests can exercise this
 * logic directly without a Next.js request/response harness.
 *
 * - Invalid address, no DB, no verdict on record, or no pool on that
 *   verdict → null. None of these are errors; a missing table is a missing
 *   table (matches fetchTopTraders's own best-effort contract).
 *
 * This used to pass a hardcoded `null` poolCreatedAt, which meant the `sniper`
 * tag could never fire for any user. The tag is gone (2026-08-07) rather than
 * repaired — the GeckoTerminal feed behind it is newest-first and cannot see a
 * launch block, so the label asserted more than the source supports. See
 * `lib/market/top-traders.ts` and
 * `docs/ways-of-work/plan/swarm-detector/PRD.md` §6.
 */
export async function resolveTopTraders(
  rawAddress: string,
  _mockVerdict?: (address: string) => Promise<{ primary_pool_address: string | null } | null>
): Promise<TopTrader[] | null> {
  const normalized = normalizeAddress(rawAddress);
  if (!normalized) return null;
  const row = _mockVerdict 
    ? await _mockVerdict(normalized)
    : await latestVerdictRowForToken(normalized);
  const poolAddress = row?.primary_pool_address ?? null;
  if (!poolAddress) return null;
  return fetchTopTraders(poolAddress);
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;
  const traders = await resolveTopTraders(address);
  return NextResponse.json(
    { traders },
    {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=180, stale-while-revalidate=600",
      },
    }
  );
}

