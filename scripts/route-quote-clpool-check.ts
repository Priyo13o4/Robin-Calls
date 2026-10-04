// Proves the lens CL_POOL leg (swap, revert in callback) equals QuoterV2 on Uniswap V3 pools at ONE pinned block,
// then quotes UP on its Slipstream pool. Free public node only. Expected: "RESULT pools 8 same N diff 0 ...".
import type { Hex } from "viem";
import { readGraphPools } from "../lib/data/swap-pools";
import { quoteRoutes, quoteRpcParams, LEG_KIND, type QuoteLeg } from "../lib/swap/route-quote";
import { primeTrustedRegistry } from "../lib/config/trusted-addresses";
import { legTarget } from "../lib/swap/route-quote-targets";
const RPC = "https://rpc.mainnet.chain.robinhood.com";
async function main() {
  await primeTrustedRegistry();
  const block = await (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }) })).json() as { result: Hex };
  const call = async (req: { to: Hex; data: Hex; gas: Hex; code: Hex }) => {
    const [tx, , o] = quoteRpcParams(req);
    for (let i = 0; ; i++) {
      const j = await (await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [tx, block.result, o] }) })).json() as { result?: Hex; error?: { message: string } };
      if (j.result) return j.result;
      if (i > 5 || !/Too Many/.test(j.error?.message ?? "")) throw new Error(j.error?.message);
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  };
  const pools = (await readGraphPools(250)).filter((p) => p.protocol === "v3" && p.dex === "uniswap-v3").sort((a, b) => b.depthUsd - a.depthUsd).slice(0, 8);
  const routes: QuoteLeg[][] = [];
  for (const p of pools) for (const [i, o] of [[p.token0, p.token1], [p.token1, p.token0]]) {
    const base = { tokenIn: i as Hex, tokenOut: o as Hex, fee: p.fee ?? 0, tickSpacing: 0, hooks: "0x0000000000000000000000000000000000000000" as Hex };
    routes.push([{ ...base, kind: LEG_KIND.v3, target: legTarget("uniswap-v3", "v3")! }], [{ ...base, kind: LEG_KIND.clPool, target: p.poolId as Hex }]);
  }
  const amounts = [10n ** 6n, 10n ** 15n, 10n ** 18n, 10n ** 21n];
  const q = await quoteRoutes(routes, amounts, call);
  let same = 0, diff = 0, bothFail = 0, oneSided = 0;
  for (let r = 0; r < routes.length; r += 2) for (let a = 0; a < amounts.length; a++) {
    const x = q[r][a], y = q[r + 1][a];
    if (x.ok && y.ok) { if (x.amounts[1] === y.amounts[1]) same++; else { diff++; console.log("DIFF", routes[r][0].tokenIn, amounts[a], x.amounts[1], y.amounts[1]); } }
    else if (!x.ok && !y.ok) bothFail++;
    else { oneSided++; console.log("ONE-SIDED quoter ok=", x.ok, x.outOfGas, "pool ok=", y.ok, y.outOfGas, routes[r + 1][0].target, amounts[a]); }
  }
  console.log(`RESULT pools ${pools.length} same ${same} diff ${diff} bothFail ${bothFail} oneSided ${oneSided}`);
  // UP on its Slipstream market: 1,000 UP into WETH.
  const up = "0x57c0e45cb534413d1c20a4240955d6bb250bb4f1" as Hex, weth = "0x0bd7d308f8e1639fab988df18a8011f41eacad73" as Hex;
  const sl = await quoteRoutes([[{ kind: LEG_KIND.clPool, target: "0x23d641feccd207e8794c593e8240444a0674c4ba", tokenIn: up, tokenOut: weth, fee: 0, tickSpacing: 0, hooks: "0x0000000000000000000000000000000000000000" }]], [10n ** 21n, 10n ** 24n, 450n * 10n ** 24n], call);
  console.log("UP slipstream 1k / 1M / 450M UP -> WETH:", sl[0].map((x) => (x.ok ? Number(x.amounts[1]) / 1e18 : `fail ${x.reason} oog=${x.outOfGas}`)));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
