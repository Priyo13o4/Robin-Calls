import { NextResponse } from "next/server";
import { readPoolLiquidity } from "@/lib/sequencer/liquidity-recorder";

export const dynamic = "force-dynamic";

const ADDRESS = /^0x[0-9a-f]{40}$/;
const POOL = /^0x([0-9a-f]{40}|[0-9a-f]{64})$/;
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/trades/<token>/liquidity?pool=<id>
 * The sequencer's recorded liquidity history for one pool. Valkey only, no RPC.
 * `coverage: null` means "not recorded", never "no liquidity changes".
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token.trim().toLowerCase();
  const pool = (new URL(req.url).searchParams.get("pool") ?? "").trim().toLowerCase();
  if (!ADDRESS.test(token) || !POOL.test(pool)) {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400, headers: NO_STORE });
  }
  try {
    const found = await readPoolLiquidity(pool);
    return NextResponse.json({ ok: true, coverage: found?.coverage ?? null, record: found?.record ?? null }, { headers: NO_STORE });
  } catch {
    // Valkey down: the page runs its own log search instead.
    return NextResponse.json({ ok: true, coverage: null, record: null }, { headers: NO_STORE });
  }
}
