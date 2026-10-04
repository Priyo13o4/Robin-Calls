import { NextResponse } from "next/server";
import { ROBINHOOD_CHAIN_ID } from "@/lib/config/chain";
import { readUniswapHooks } from "@/lib/data/uniswap-hooks";
import { readTokenV4Hooks } from "@/lib/data/v4-pools";

const ADDRESS = /^0x[0-9a-f]{40}$/;
const MAX = 10;

/**
 * GET /api/hooks?addresses=<a,b>: Uniswap hook list entries for these hooks (DB only).
 * GET /api/hooks?token=<t>: the same, for every hook on the token's recorded V4 pools.
 * `looked: false` means the list could not be read; an address missing from `hooks` is only
 * "not listed" when `looked` is true.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const token = params.get("token")?.toLowerCase();
  if (token !== undefined) return byToken(token);
  const addresses = [...new Set((params.get("addresses") ?? "").toLowerCase().split(",").filter(Boolean))];
  if (addresses.length === 0 || addresses.length > MAX || !addresses.every((a) => ADDRESS.test(a))) {
    return NextResponse.json({ error: "addresses: 1 to 10 hook addresses" }, { status: 400 });
  }
  const { looked, hooks, fetchedAt } = await readUniswapHooks(ROBINHOOD_CHAIN_ID, addresses);
  return NextResponse.json(
    { looked, fetchedAt, hooks: Object.fromEntries(hooks) },
    { headers: { "Cache-Control": looked ? "public, max-age=300, s-maxage=3600" : "no-store" } },
  );
}

async function byToken(token: string) {
  if (!ADDRESS.test(token)) return NextResponse.json({ error: "token: an address" }, { status: 400 });
  const pools = await readTokenV4Hooks(token);
  const list = await readUniswapHooks(ROBINHOOD_CHAIN_ID, pools.hooks.map((h) => h.hook));
  return NextResponse.json(
    {
      poolsLooked: pools.looked,
      looked: list.looked,
      fetchedAt: list.fetchedAt,
      tokenHooks: pools.hooks,
      hooks: Object.fromEntries(list.hooks),
    },
    { headers: { "Cache-Control": pools.looked && list.looked ? "public, max-age=300, s-maxage=900" : "no-store" } },
  );
}
