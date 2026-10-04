import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { readTradeIndictment } from "@/lib/swap/indictment";
import type { TradeIndictment } from "@/lib/swap/types";

/**
 * The Wanted-board cross-check for one token, read by the sign-time disclaimer the instant it
 * opens (WAYS-OF-WORK §5, differentiation features).
 *
 * Public and unauthenticated, so §6's checklist applies: it has a `read` class in
 * `classifyPath` AND a `/api/wanted/:path*` entry in `proxy.ts`. One without the other is
 * dead code, and `tests/ratelimit-coverage.test.ts` enumerates this route off disk.
 *
 * Always 200. Every state here is an answer, including "we could not look" (§4), and a 503
 * would make the browser's `catch` the only thing distinguishing them.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  const body: TradeIndictment = isAddress(address)
    ? await readTradeIndictment(address.toLowerCase())
    : // Not "clear": we never looked. A malformed address must not answer like a clean one.
      { kind: "unknown" };

  return NextResponse.json(body, {
    status: 200,
    // A lifted mark or a fresh indictment must reach the next signer, not a cached copy.
    headers: { "Cache-Control": "no-store" },
  });
}
