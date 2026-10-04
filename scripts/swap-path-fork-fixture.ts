/**
 * Path plans (lib/swap/path-plan.ts) on real 4663 pools, each with the EXACT output and fee the
 * quote lens predicts at one pinned block, for contracts/test/swap-router/PathPlanFork.t.sol.
 *
 *   npx tsx scripts/swap-path-fork-fixture.ts
 *   cd contracts && ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com \
 *     forge test --match-path 'test/swap-router/PathPlanFork.t.sol' -vv
 *
 * Run forge within a few minutes: the public node is not an archive, and the fork pins this block.
 * Free public node only (never a keyed provider).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Hex } from "viem";
import { buildPathPlan, pathFeePoint, type PathLeg } from "../lib/swap/path-plan";
import { quoteLegFrom, quoteRoutes, type EthCall, type QuoteLeg } from "../lib/swap/route-quote";
import { PANCAKE_INFINITY_UR, UNISWAP_UR, WETH, type UniversalRouterProfile } from "../lib/swap/venues";
import { NATIVE, type Address } from "../lib/swap/types";

const RPC = "https://rpc.mainnet.chain.robinhood.com";
// Chain-verified (eth_getCode) 2026-10-01.
const QUOTER_V2 = "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7";
const V4_QUOTER = "0x8dc178efb8111bb0973dd9d722ebeff267c98f94";
const UNI_V2_ROUTER = "0x89e5db8b5aa49aa85ac63f691524311aeb649eba";
// Pancake, from trusted_address (dex_id pancakeswap); verified to have code 2026-10-02.
const PCS_QUOTER_V2 = "0x8553aa1615549a86882151784b329b017aa7c832";
const PCS_V2_ROUTER = "0x8cfe327cec66d1c090dd72bd0ff11d690c33a2eb";
// Pools from scripts/swap-fork-fixture.ts, verified there.
const USDG: Address = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const CRWD: Address = "0xea72ecca2d0f6bfa1394dbbcff85b52cd4233931";
const AAPL: Address = "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9";
const TSLA: Address = "0x322f0929c4625ed5bad873c95208d54e1c003b2d";
const U: Address = "0xce24439f2d9c6a2289f741120fe202248b666666";
const BMNR: Address = "0x05d8e73787acd02c70a9c43dd6f0443e3b8d3d77";
const SMK2: Address = "0x0d6b6f604c1bf5b3533c445334bb4e1044145688";
const PV2T: Address = "0x9af220e6e234ba4b838087dce00b6a39e3035afe"; // not a Flap "…7777" token: those can carry a transfer tax a V2 quote ignores
const ETH_CRWD = { currency0: NATIVE, currency1: CRWD, fee: 50000, tickSpacing: 500, hooks: NATIVE };
const USDG_CRWD = { currency0: USDG, currency1: CRWD, fee: 30100, tickSpacing: 301, hooks: NATIVE };

const FEE_RECIPIENT: Address = "0x00000000000000000000000000000000feeeeeee";
const FEE_BPS = 50;
const DEADLINE = BigInt(Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60);

const v3 = (tokenIn: Address, tokenOut: Address, feeTier: number): PathLeg => ({ protocol: "v3", pool: `v3-${feeTier}`, tokenIn, tokenOut, feeTier });
const v2 = (tokenIn: Address, tokenOut: Address): PathLeg => ({ protocol: "v2", pool: "v2", tokenIn, tokenOut });
const v4 = (tokenIn: Address, tokenOut: Address, key: typeof ETH_CRWD): PathLeg => ({ protocol: "v4", pool: `v4-${key.fee}`, tokenIn, tokenOut, v4Key: key });

interface Spec { name: string; tokenIn: Address; tokenOut: Address; amountIn: bigint; legs: PathLeg[]; profile?: UniversalRouterProfile;
  /** V2 pools here are thin and mostly taxed, so these are checked against the DEX's own Router02 on the fork, not the lens. */
  refRouter?: Address }
const SPECS: Spec[] = [
  { name: "2 pools: ETH -> V3 USDG -> V4 CRWD (fee on the ETH in)", tokenIn: NATIVE, tokenOut: CRWD, amountIn: 500_000_000_000_000n,
    legs: [v3(WETH, USDG, 100), v4(USDG, CRWD, USDG_CRWD)] },
  { name: "3 pools: AAPL -> WETH -> USDG -> V4 CRWD (fee in the WETH between pools)", tokenIn: AAPL, tokenOut: CRWD, amountIn: 1_000_000_000_000_000n,
    legs: [v3(AAPL, WETH, 500), v3(WETH, USDG, 100), v4(USDG, CRWD, USDG_CRWD)] },
  { name: "3 pools, all V3: TSLA -> WETH -> USDG -> AAPL", tokenIn: TSLA, tokenOut: AAPL, amountIn: 1_000_000_000_000_000n,
    legs: [v3(TSLA, WETH, 3000), v3(WETH, USDG, 100), v3(USDG, AAPL, 500)] },
  { name: "2 pools: CRWD -> native V4 ETH -> wrap -> V3 USDG (fee on the USDG out)", tokenIn: CRWD, tokenOut: USDG, amountIn: 1_000_000_000_000_000n,
    legs: [v4(CRWD, NATIVE, ETH_CRWD), v3(WETH, USDG, 100)] },
  { name: "1 pool: CRWD -> native V4 ETH, delivered as WETH", tokenIn: CRWD, tokenOut: WETH, amountIn: 1_000_000_000_000_000n,
    legs: [v4(CRWD, NATIVE, ETH_CRWD)] },
  { name: "2 pools: AAPL -> USDG -> WETH, delivered as ETH", tokenIn: AAPL, tokenOut: NATIVE, amountIn: 1_000_000_000_000_000n,
    legs: [v3(AAPL, USDG, 500), v3(USDG, WETH, 100)] },
  { name: "2 V4 pools: USDG -> CRWD -> native ETH", tokenIn: USDG, tokenOut: NATIVE, amountIn: 1_000_000n,
    legs: [v4(USDG, CRWD, USDG_CRWD), v4(CRWD, NATIVE, ETH_CRWD)] },
  // Pancake Infinity router, V2 and V3 pools (it has no V4 command we build).
  { name: "PCS 1 pool: USDG -> V3 U (fee on the USDG in)", tokenIn: USDG, tokenOut: U, amountIn: 1_000_000n, legs: [v3(USDG, U, 100)], profile: PANCAKE_INFINITY_UR },
  { name: "PCS 1 pool: U -> V3 USDG (fee on the USDG out)", tokenIn: U, tokenOut: USDG, amountIn: 1_000_000_000_000_000_000n, legs: [v3(U, USDG, 100)], profile: PANCAKE_INFINITY_UR },
  { name: "PCS 1 pool: ETH -> V3 SMK2 (wrap, fee on the ETH in)", tokenIn: NATIVE, tokenOut: SMK2, amountIn: 500_000_000_000_000n, legs: [v3(WETH, SMK2, 10000)], profile: PANCAKE_INFINITY_UR },
  { name: "PCS 1 pool: BMNRon -> V3 USDG (fee on the USDG out)", tokenIn: BMNR, tokenOut: USDG, amountIn: 10_000_000_000_000_000n, legs: [v3(BMNR, USDG, 10000)], profile: PANCAKE_INFINITY_UR },
  { name: "PCS 2 pools: BMNRon -> V3 USDG -> V3 U (fee in the USDG between pools)", tokenIn: BMNR, tokenOut: U, amountIn: 10_000_000_000_000_000n, legs: [v3(BMNR, USDG, 10000), v3(USDG, U, 100)], profile: PANCAKE_INFINITY_UR },
  { name: "PCS 1 pool: ETH -> V2 token (fee on the ETH in)", tokenIn: NATIVE, tokenOut: PV2T, amountIn: 100_000_000_000_000n, legs: [v2(WETH, PV2T)], profile: PANCAKE_INFINITY_UR, refRouter: PCS_V2_ROUTER },
  { name: "PCS 1 pool: V2 token -> ETH (unwrap, fee on the ETH out)", tokenIn: PV2T, tokenOut: NATIVE, amountIn: 0n, legs: [v2(PV2T, WETH)], profile: PANCAKE_INFINITY_UR, refRouter: PCS_V2_ROUTER },
];

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await r.json()) as { result?: T; error?: { message: string } };
  if (j.error || j.result === undefined) throw new Error(`${method}: ${j.error?.message ?? r.status}`);
  return j.result;
}

const quoteLeg = (l: PathLeg, family: "uniswap" | "pancake"): QuoteLeg => {
  const target = l.protocol === "v4" ? V4_QUOTER
    : l.protocol === "v3" ? (family === "pancake" ? PCS_QUOTER_V2 : QUOTER_V2)
      : (family === "pancake" ? PCS_V2_ROUTER : UNI_V2_ROUTER);
  const q = quoteLegFrom({
    protocol: l.protocol, dex: `${family}-${l.protocol}`, fee: l.feeTier ?? l.v4Key?.fee ?? null, tickSpacing: l.v4Key?.tickSpacing ?? null,
    hooks: l.v4Key?.hooks ?? null, tokenIn: l.tokenIn, tokenOut: l.tokenOut,
  }, target);
  if (!q) throw new Error(`unquotable leg ${l.pool}`);
  return q;
};

async function main() {
  const block = BigInt(await rpc<string>("eth_blockNumber", []));
  const blockHex = `0x${block.toString(16)}`;
  const call: EthCall = (req) => rpc<Hex>("eth_call", [{ to: req.to, data: req.data, gas: req.gas }, blockHex, { [req.to]: { code: req.code } }]);
  let family: "uniswap" | "pancake" = "uniswap";
  const out1 = async (legs: readonly PathLeg[], amount: bigint) => {
    const [[q]] = await quoteRoutes([legs.map((l) => quoteLeg(l, family))], [amount], call);
    if (!q.ok) throw new Error(`lens could not price ${legs.map((l) => l.pool).join(">")}: leg ${q.failedLeg} ${q.reason}`);
    return q.amounts.at(-1)!;
  };

  const plans = [];
  let lastBought = 0n;
  for (const s of SPECS) {
    const profile = s.profile ?? UNISWAP_UR;
    family = profile.family === "pancake" ? "pancake" : "uniswap";
    // amountIn 0: sell back what the previous plan bought, so the size fits a thin pool.
    if (s.amountIn === 0n) s.amountIn = lastBought / 2n;
    const at = pathFeePoint(s.tokenIn, s.tokenOut, s.legs, WETH, USDG)!;
    const cut = (n: bigint) => (n * BigInt(FEE_BPS)) / 10_000n;
    // PAY_PORTION pays bps of the balance at its point; the next pool swaps what is left.
    let expectedOut: bigint, expectedFee: bigint;
    if (at.at === "input") { expectedFee = cut(s.amountIn); expectedOut = await out1(s.legs, s.amountIn - expectedFee); }
    else if (at.at === "output") { const gross = await out1(s.legs, s.amountIn); expectedFee = cut(gross); expectedOut = gross - expectedFee; }
    else {
      const mid = await out1(s.legs.slice(0, at.afterLeg + 1), s.amountIn);
      expectedFee = cut(mid);
      expectedOut = await out1(s.legs.slice(at.afterLeg + 1), mid - expectedFee);
    }
    lastBought = expectedOut;
    const build = (minOut: bigint) => buildPathPlan({
      profile, legs: s.legs, tokenIn: s.tokenIn, tokenOut: s.tokenOut, amountIn: s.amountIn, minOut,
      feeBps: FEE_BPS, feeRecipient: FEE_RECIPIENT, deadline: DEADLINE, usdg: USDG,
    });
    const exact = build(expectedOut);
    const middles = s.legs.slice(0, -1).map((l) => (l.tokenOut === NATIVE ? WETH : l.tokenOut));
    plans.push({
      name: s.name, to: exact.to, data: exact.data, dataOver: build(expectedOut + 1n).data, dataNoFloor: build(1n).data, value: exact.value.toString(),
      tokenIn: s.tokenIn, tokenOut: s.tokenOut, amountIn: s.amountIn.toString(),
      expectedOut: expectedOut.toString(), expectedFee: expectedFee.toString(), feePaidAsset: exact.feePaidAsset,
      middle0: middles[0] ?? NATIVE, middle1: middles[1] ?? NATIVE, commands: exact.commandNames,
      router: profile.router, permit2: profile.permit2, refRouter: s.refRouter ?? NATIVE,
    });
    console.log(`${s.name}\n  out ${expectedOut} fee ${expectedFee} in ${exact.feePaidAsset}\n  ${exact.commandNames.join(" ")}`);
  }
  const fixture = {
    note: "Generated by scripts/swap-path-fork-fixture.ts. Do not hand edit.",
    block: block.toString(), weth: WETH, usdg: USDG, feeRecipient: FEE_RECIPIENT, feeBps: FEE_BPS,
    permit2: UNISWAP_UR.permit2, router: UNISWAP_UR.router, count: plans.length, plans,
  };
  const dir = join(import.meta.dirname, "..", "contracts", "test", "fixtures");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "swap-path-plans.json"), `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`wrote ${plans.length} plans at block ${block}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
