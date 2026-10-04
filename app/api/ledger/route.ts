import { NextRequest, NextResponse } from "next/server";
import { latestTradeGatesForTokens, ledgerPoolsForEntries, queryLedgerFeed } from "@/lib/data/ledger";
import { tradeableTokens } from "@/lib/swap/ledger-gate";
import { launchIconsForTokens } from "@/lib/data/launches";

/**
 * Public Ledger feed (/ledger).
 *
 * GET /api/ledger?cursor=<id>&q=<search>&token=<addr>
 *   → { entries: VerdictRow[], nextCursor: number | null }
 *
 * Keyset pagination on the descending primary key: the first page omits
 * `cursor`; each subsequent page passes the last id it received, and we return
 * rows with `id < cursor`. This is stable under inserts (unlike OFFSET) and
 * uses the verdicts PK index directly.
 *
 * Search (`q`):
 *   - 0x-prefixed → token_address substring (addresses are stored lowercase).
 *   - otherwise   → token_symbol / token_name ILIKE.
 * `token` pins the feed to one contract's full history (used by "MORE IN THE
 * LEDGER" from a token's record strip).
 */

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;

  const cursorRaw = params.get("cursor");
  const cursor = cursorRaw && /^\d+$/.test(cursorRaw) ? Number(cursorRaw) : null;

  const token = /^0x[0-9a-fA-F]{40}$/.test(params.get("token") ?? "")
    ? params.get("token")!.toLowerCase()
    : null;

  const q = (params.get("q") ?? "").trim().slice(0, 64);

  try {
    const { entries, nextCursor } = await queryLedgerFeed({ cursor, token, search: q, limit: 20 });
    // A failed gate read only costs the swap links, never the feed.
    // Gates and pools are extras: a failed read costs swap links or depth, never the feed.
    const [gates, pools, icons] = await Promise.all([
      latestTradeGatesForTokens(entries.map((e) => e.token_address)).catch(() => new Map()),
      ledgerPoolsForEntries(entries).catch(() => ({})),
      // Decorative: a failed read falls back to the explorer and DexScreener tiers.
      launchIconsForTokens(entries.map((e) => e.token_address)).catch(() => ({})),
    ]);
    return NextResponse.json(
      { entries, nextCursor, tradeable: tradeableTokens(gates), pools, icons },
      { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=120" } }
    );
  } catch {
    return NextResponse.json(
      { error: "Feed query failed", entries: [], nextCursor: null },
      { status: 500 }
    );
  }
}
