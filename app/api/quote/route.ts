import { NextRequest, NextResponse } from "next/server";
import { normalizeAddress } from "@/lib/scanner/metadata";
import { quoteToken, type QuoteDirection } from "@/lib/dex/quote";

/**
 * Swap router Phase 1 (docs/cross-dex-router/WAYS-OF-WORK.md) — the first
 * consumer of lib/dex/quote.ts. Read-only: no scan coordination, no ledger
 * write, no DB. Rate-limited via the `quote` class (lib/security/ratelimit.ts,
 * proxy.ts matcher) — RPC-bound like `scan`, so it needs its own budget, not
 * an unlimited one.
 *
 * `amountIn` is a raw base-unit (wei) string, not a human amount — converting
 * from the token's decimals is a caller concern (this route doesn't look up
 * decimals, matching lib/dex/quote.ts's own scope).
 */

function parseDirection(v: string | null): QuoteDirection | null {
  return v === "buy" || v === "sell" ? v : null;
}

function parseAmountIn(v: string | null): bigint | null {
  if (!v || !/^[0-9]+$/.test(v)) return null;
  try {
    const n = BigInt(v);
    return n > 0n ? n : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const token = normalizeAddress(searchParams.get("token") ?? "");
  const direction = parseDirection(searchParams.get("direction"));
  const amountIn = parseAmountIn(searchParams.get("amountIn"));

  if (!token || !direction || amountIn === null) {
    return NextResponse.json(
      { error: "Required: token (address), direction (buy|sell), amountIn (positive base-unit integer string)." },
      { status: 400 },
    );
  }

  const quote = await quoteToken(token, direction, amountIn);
  // A quote is a snapshot of the current block — never cached, unlike the
  // scanner's verdict reads (a stale price quote is actively misleading, not
  // just stale data).
  return NextResponse.json(quote, { headers: { "Cache-Control": "no-store" } });
}
