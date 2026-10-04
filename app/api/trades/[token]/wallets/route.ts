import { NextResponse } from "next/server";
import { MAX_WALLETS, readWalletFacts } from "@/lib/trade/wallet-facts";
import { MAX_WATCH_POOLS } from "@/lib/sequencer/trade-senders";

export const dynamic = "force-dynamic";

const ADDRESS = /^0x[0-9a-f]{40}$/;
const POOL = /^0x([0-9a-f]{40}|[0-9a-f]{64})$/;
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/trades/<token>/wallets?w=<addrs>&pools=<ids>
 * Facts behind the trade pane's wallet tags. A null field is "not read", never "no".
 */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token.trim().toLowerCase();
  const url = new URL(req.url);
  const list = (key: string) => [...new Set((url.searchParams.get(key) ?? "").toLowerCase().split(",").filter(Boolean))];
  const wallets = list("w");
  const pools = list("pools");
  if (!ADDRESS.test(token) || !wallets.length || wallets.length > MAX_WALLETS || !wallets.every((w) => ADDRESS.test(w))
    || pools.length > MAX_WATCH_POOLS || !pools.every((p) => POOL.test(p))) {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400, headers: NO_STORE });
  }
  try {
    return NextResponse.json({ ok: true, wallets: await readWalletFacts(token, wallets, pools) }, { headers: NO_STORE });
  } catch {
    // Every read inside already degrades to null; this only catches a fault outside them.
    return NextResponse.json({ ok: true, wallets: {} }, { headers: NO_STORE });
  }
}
