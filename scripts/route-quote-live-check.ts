// Live check for the route quote lens: lens-priced routes == the same legs priced one by one, at ONE pinned block.
// Uses the FREE public node only. Expected last line: RESULT ok N failed M legs-match K mismatch 0
import { encodeFunctionData, decodeFunctionResult, parseAbi, type Hex } from "viem";
import { readGraphPools } from "../lib/data/swap-pools";
import { buildRouteGraph, findRoutes, type GraphRoute } from "../lib/swap/graph";
import { NATIVE } from "../lib/swap/types";
import { WETH } from "../lib/swap/venues";
import { quoteRoutes, quoteRpcParams, type QuoteLeg } from "../lib/swap/route-quote";
import { toQuoteLeg } from "../lib/swap/route-quote-targets";
import { primeTrustedRegistry } from "../lib/config/trusted-addresses";

async function main() {
await primeTrustedRegistry();
// Live check for item A: lens-priced routes == the same legs priced one by one, at ONE pinned block.

const RPC = "https://rpc.mainnet.chain.robinhood.com";
let id = 0;
async function rpc<T>(method: string, params: unknown[], tries = 6): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await rpc1<T>(method, params); }
    catch (e) { if (i >= tries || !/Too Many|429|timeout/i.test((e as Error).message)) throw e; await new Promise((r) => setTimeout(r, 500 * 2 ** i)); }
  }
}
async function rpc1<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
  const j = await r.json() as { result?: T; error?: { message: string } };
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result as T;
}

const block = await rpc<Hex>("eth_blockNumber", []);
console.log("block", Number(block));

const pools = await readGraphPools(250);
console.log("graph pools", pools.length, "v4", pools.filter((p) => p.protocol === "v4").length);
const graph = buildRouteGraph(pools, { aliases: { [NATIVE]: WETH } });

// Tokens with the most depth on each protocol give 1, 2 and 3 pool routes across V2/V3/V4.
const byProto = (proto: string) => [...pools].filter((p) => p.protocol === proto && p.token0 !== WETH && p.token1 !== WETH).sort((a, b) => b.depthUsd - a.depthUsd).slice(0, 12);
const targets = new Set<string>();
for (const proto of ["v2", "v3", "v4"]) for (const p of byProto(proto)) targets.add(p.token0 === "0x5fc5360d0400a0fd4f2af552add042d716f1d168" ? p.token1 : p.token0);
for (const p of [...pools].filter((p) => p.protocol === "v4").sort((a, b) => b.depthUsd - a.depthUsd).slice(0, 12)) targets.add(p.token0 === NATIVE ? p.token1 : p.token0);

const routes: GraphRoute[] = [];
for (const t of targets) {
  if (t === WETH) continue;
  const res = findRoutes(graph, WETH, t, { families: ["uniswap", "pancake"], limit: 4 });
  routes.push(...res.routes);
}
const legs: QuoteLeg[][] = [];
const kept: GraphRoute[] = [];
for (const r of routes) {
  const q = r.legs.map((l) => toQuoteLeg({ ...l.pool, tokenIn: l.tokenIn, tokenOut: l.tokenOut }));
  if (q.every((x): x is QuoteLeg => x !== null)) { legs.push(q); kept.push(r); }
}
console.log("routes", routes.length, "quotable", kept.length, "by hops", [1, 2, 3].map((n) => kept.filter((r) => r.legs.length === n).length), "protocols", [...new Set(kept.flatMap((r) => r.legs.map((l) => l.pool.protocol)))]);

const amounts = [10n ** 15n, 10n ** 17n, 10n ** 21n];
let lensCalls = 0;
const call = async (req: { to: Hex; data: Hex; gas: Hex; code: Hex }) => {
  lensCalls++;
  const [tx, , override] = quoteRpcParams(req);
  return rpc<Hex>("eth_call", [tx, block, override]);
};
const t0 = Date.now();
const quotes = await quoteRoutes(legs, amounts, call);
const gases = quotes.flat().map((q) => q.gasUsed).sort((a, b) => a - b);
console.log("lens calls", lensCalls, "outOfGas", quotes.flat().filter((q) => q.outOfGas).length, "gas p50", gases[gases.length >> 1], "p95", gases[Math.floor(gases.length * 0.95)], "max", gases.at(-1));
console.log("lens call ms", Date.now() - t0, "payload routes x amounts", legs.length * amounts.length);

const v2 = parseAbi(["function getAmountsOut(uint256,address[]) view returns (uint256[])"]);
const v3 = parseAbi(["function quoteExactInputSingle((address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256,uint160,uint32,uint256)"]);
const v4 = parseAbi(["function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData)) returns (uint256,uint256)"]);

async function single(l: QuoteLeg, amountIn: bigint): Promise<bigint | string> {
  try {
    if (l.kind === 2) {
      const d = await rpc<Hex>("eth_call", [{ to: l.target, data: encodeFunctionData({ abi: v2, functionName: "getAmountsOut", args: [amountIn, [l.tokenIn, l.tokenOut]] }) }, block]);
      return (decodeFunctionResult({ abi: v2, functionName: "getAmountsOut", data: d }) as readonly bigint[])[1];
    }
    if (l.kind === 3) {
      const d = await rpc<Hex>("eth_call", [{ to: l.target, data: encodeFunctionData({ abi: v3, functionName: "quoteExactInputSingle", args: [{ tokenIn: l.tokenIn, tokenOut: l.tokenOut, amountIn, fee: l.fee, sqrtPriceLimitX96: 0n }] }) }, block]);
      return (decodeFunctionResult({ abi: v3, functionName: "quoteExactInputSingle", data: d }) as readonly bigint[])[0];
    }
    const z = BigInt(l.tokenIn) < BigInt(l.tokenOut);
    const key = { currency0: z ? l.tokenIn : l.tokenOut, currency1: z ? l.tokenOut : l.tokenIn, fee: l.fee, tickSpacing: l.tickSpacing, hooks: l.hooks };
    const d = await rpc<Hex>("eth_call", [{ to: l.target, data: encodeFunctionData({ abi: v4, functionName: "quoteExactInputSingle", args: [{ poolKey: key, zeroForOne: z, exactAmount: amountIn, hookData: "0x" }] }) }, block]);
    return (decodeFunctionResult({ abi: v4, functionName: "quoteExactInputSingle", data: d }) as readonly bigint[])[0];
  } catch (e) {
    return `revert ${(e as Error).message.slice(0, 80)}`;
  }
}

let match = 0, mismatch = 0, okRoutes = 0, failedRoutes = 0;
for (let r = 0; r < legs.length; r++) {
  for (let a = 0; a < amounts.length; a++) {
    const q = quotes[r][a];
    const label = `${kept[r].legs.map((l) => `${l.pool.dex}`).join(">")} ${kept[r].path.at(-1)!.slice(0, 10)} amt=${amounts[a]}`;
    if (!q.ok && q.outOfGas) { console.log("  OOG", label); continue; }
    if (!q.ok) {
      failedRoutes++;
      // The lens says leg N failed: the single call on that leg, fed the lens's own input, must fail too.
      const leg = q.failedLeg ?? 0;
      let input = amounts[a];
      for (let i = 0; i < leg; i++) { const o = await single(legs[r][i], input); if (typeof o !== "bigint") { input = -1n; break; } input = o; }
      const o = input < 0n ? "upstream" : await single(legs[r][leg], input);
      const agree = typeof o !== "bigint" || o === 0n;
      agree ? match++ : mismatch++;
      console.log(agree ? "  same" : "  DIFF", "FAIL leg", leg, q.reason, "gas", q.gasUsed, "single:", typeof o === "bigint" ? o.toString() : o, label);
      continue;
    }
    okRoutes++;
    for (let i = 0; i < legs[r].length; i++) {
      const o = await single(legs[r][i], q.amounts[i]);
      const agree = o === q.amounts[i + 1];
      agree ? match++ : mismatch++;
      if (!agree) console.log("  DIFF leg", i, "lens", q.amounts[i + 1].toString(), "single", String(o), label);
    }
  }
}
console.log(`RESULT ok ${okRoutes} failed ${failedRoutes} legs-match ${match} mismatch ${mismatch}`);
process.exit(0);

}
main().catch((e) => { console.error(e); process.exit(1); });
