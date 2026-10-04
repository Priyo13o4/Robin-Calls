import { NextResponse } from "next/server";
import { readTradeSenders, watchTradeToken, MAX_WATCH_POOLS } from "@/lib/sequencer/trade-senders";

export const dynamic = "force-dynamic";

const ADDRESS = /^0x[0-9a-f]{40}$/;
const POOL = /^0x([0-9a-f]{40}|[0-9a-f]{64})$/;
const TX = /^0x[0-9a-f]{64}$/;
const MAX_HASHES = 30;
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/trades/<token>/senders?pools=<ids>&tx=<hashes>
 * Registers the token with the sequencer relay and returns the senders it has seen for these
 * tx hashes. Valkey only, no RPC. A missing hash means "not seen", never "no sender".
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token.trim().toLowerCase();
  const url = new URL(req.url);
  const list = (key: string) => (url.searchParams.get(key) ?? "").toLowerCase().split(",").filter(Boolean);
  const pools = list("pools");
  const hashes = [...new Set(list("tx"))];
  if (!ADDRESS.test(token) || pools.length > MAX_WATCH_POOLS || !pools.every((p) => POOL.test(p))
    || hashes.length > MAX_HASHES || !hashes.every((h) => TX.test(h))) {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400, headers: NO_STORE });
  }
  try {
    const watching = await watchTradeToken(token, pools);
    const senders = await readTradeSenders(hashes);
    return NextResponse.json({ ok: true, watching, senders }, { headers: NO_STORE });
  } catch {
    // Valkey down: the ticker keeps its RPC and GeckoTerminal fallbacks.
    return NextResponse.json({ ok: true, watching: false, senders: {} }, { headers: NO_STORE });
  }
}
