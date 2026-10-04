/**
 * Generate the calldata the swap router would actually serve, for replay on a fork.
 *
 *   npx tsx scripts/swap-fork-fixture.ts
 *
 * Every other swap test asserts the SHAPE of a plan. None of them can fail on "the bytes
 * are well formed and the chain rejects them", or on "the router kept the change". Those
 * need a real EVM with real pool state, which is contracts/test/swap-router/SwapPlanFork.t.sol.
 *
 * This writes the fixture rather than hardcoding hex, so the gate replays the CURRENT
 * builder. A hand-copied blob would keep passing after ur-plan.ts changed under it.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildUrPlan, isQuoteAsset } from "../lib/swap/ur-plan";
import { buildV4Plan } from "../lib/swap/v4-plan";
import { PANCAKE_V3_UR, UNISWAP_UR, WETH } from "../lib/swap/venues";
import { NATIVE, type Address } from "../lib/swap/types";

// Chain-verified 2026-09-16 against rpc.mainnet.chain.robinhood.com, not from memory.
const USDG: Address = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
/** Marketplier. Uniswap V3 WETH pair at tier 100 only: 0x162eE8F2…4515, liquidity 5.4e22. */
const MKT: Address = "0x0e5f7772ab4717c9ce4cad0acd01de7bf17d442e";
/** United Stables. Its only pool is Pancake V3 USDG/U tier 100: 0x090f2f03…c3f0. */
const UNITED: Address = "0xce24439f2d9c6a2289f741120fe202248b666666";
/** CrowdStrike stock token. V4 pool 0x1d054a66 (ETH) and 0xa8f24e17 (USDG). */
const CRWD: Address = "0xea72ecca2d0f6bfa1394dbbcff85b52cd4233931";
/** Canonical stock tokens with funded Uniswap V3 WETH pools (verified 2026-09-23). */
const AAPL: Address = "0xaf3d76f1834a1d425780943c99ea8a608f8a93f9";
const TSLA: Address = "0x322f0929c4625ed5bad873c95208d54e1c003b2d";
/** Pons V2 HYDX graduation pool, authenticated from factory, receipt and position NFT. */
const HYDX: Address = "0xaa5751ff3fb61e613993b2eb4eab1fce017081fc";
const PONS_V2_HOOK: Address = "0xe5e702641ea86f4ae6cc3cdaed2b886f976be044";

const V4_ETH_CRWD_KEY = {
  currency0: NATIVE,
  currency1: CRWD,
  fee: 50000,
  tickSpacing: 500,
  hooks: NATIVE,
};

const V4_USDG_CRWD_KEY = {
  currency0: USDG,
  currency1: CRWD,
  fee: 30100,
  tickSpacing: 301,
  hooks: NATIVE,
};
const V4_PONS_HYDX_KEY = {
  currency0: NATIVE,
  currency1: HYDX,
  fee: 0,
  tickSpacing: 200,
  hooks: PONS_V2_HOOK,
};

const FEE_RECIPIENT: Address = "0x00000000000000000000000000000000feeeeeee";
const FEE_BPS = 100;
/** Far future: the fork's block.timestamp is real, so a short deadline would expire it. */
const DEADLINE = BigInt(Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60);

/** The pool holds 0.038 WETH, so a large buy is all price impact and proves nothing. */
const BUY_ETH = 500_000_000_000_000n;
const SELL_MKT = 1_000_000_000_000_000_000n;
const SWAP_USDG = 1_000_000n;
const SELL_CRWD = 1_000_000_000_000_000n;

interface FixturePlan {
  name: string;
  to: string;
  data: string;
  value: string;
  tokenIn: string;
  tokenOut: string;
  bridge: string;
  amountIn: string;
  minOut: string;
  /**
   * The asset PAY_PORTION actually moves, which is NOT always `feeAsset`: selling for ETH
   * reports the native side for display while the command pays WETH. The fork gate has to
   * measure the asset that really moves or a paid fee reads as an unpaid one.
   */
  feePaidAsset: string;
  /** Input-side fees are exactly bips of amountIn, so the gate can assert the figure. */
  feeOnInput: boolean;
  /** Permit2 for this venue's family. Uniswap's approval does not fund Pancake's. */
  permit2: string;
  router: string;
  /** True when the floor is deliberately unreachable, so the call MUST revert. */
  expectRevert: boolean;
  commands: string[];
}

function plan(
  name: string,
  opts: {
    profile: typeof UNISWAP_UR;
    tokenIn: Address;
    tokenOut: Address;
    amountIn: bigint;
    feeTier: number;
    multihop?: { bridge: Address; leg1FeeTier: number; leg2FeeTier: number };
    minOut: bigint;
    expectRevert?: boolean;
  },
): FixturePlan {
  const built = buildUrPlan(
    {
      profile: opts.profile,
      leg: { protocol: "v3", feeTier: opts.feeTier },
      ...(opts.multihop ? { multihop: opts.multihop } : {}),
      tokenIn: opts.tokenIn,
      tokenOut: opts.tokenOut,
      amountIn: opts.amountIn,
      minOut: opts.minOut,
      // Only used to state the fee for display; it never sizes a swap (L181).
      expectedOut: opts.minOut > 0n ? opts.minOut : 1n,
      feeBps: FEE_BPS,
      feeRecipient: FEE_RECIPIENT,
      deadline: DEADLINE,
    },
    USDG,
  );
  const feeOnInput = isQuoteAsset(opts.tokenIn, opts.profile, USDG);
  return {
    name,
    to: built.to,
    data: built.data,
    value: built.value.toString(),
    tokenIn: opts.tokenIn,
    tokenOut: opts.tokenOut,
    bridge: opts.multihop?.bridge ?? NATIVE,
    amountIn: opts.amountIn.toString(),
    minOut: opts.minOut.toString(),
    feePaidAsset: built.feePaidAsset,
    feeOnInput,
    permit2: opts.profile.permit2,
    router: opts.profile.router,
    expectRevert: opts.expectRevert ?? false,
    commands: built.commandNames,
  };
}

function v4Plan(
  name: string,
  opts: {
    tokenIn: Address;
    tokenOut: Address;
    amountIn: bigint;
    minOut: bigint;
    v4Key: {
      currency0: Address;
      currency1: Address;
      fee: number;
      tickSpacing: number;
      hooks: Address;
    };
    expectRevert?: boolean;
  },
): FixturePlan {
  const built = buildV4Plan(
    {
      profile: UNISWAP_UR,
      leg: { protocol: "v4", v4Key: opts.v4Key },
      tokenIn: opts.tokenIn,
      tokenOut: opts.tokenOut,
      amountIn: opts.amountIn,
      minOut: opts.minOut,
      expectedOut: opts.minOut > 0n ? opts.minOut : 1n,
      feeBps: FEE_BPS,
      feeRecipient: FEE_RECIPIENT,
      deadline: DEADLINE,
    },
    USDG,
    opts.v4Key.hooks === NATIVE ? undefined : opts.v4Key,
  );
  const feeOnInput = isQuoteAsset(opts.tokenIn, UNISWAP_UR, USDG);
  return {
    name,
    to: built.to,
    data: built.data,
    value: built.value.toString(),
    tokenIn: opts.tokenIn,
    tokenOut: opts.tokenOut,
    bridge: NATIVE,
    amountIn: opts.amountIn.toString(),
    minOut: opts.minOut.toString(),
    feePaidAsset: built.feePaidAsset,
    feeOnInput,
    permit2: UNISWAP_UR.permit2,
    router: UNISWAP_UR.router,
    expectRevert: opts.expectRevert ?? false,
    commands: built.commandNames,
  };
}

const plans: FixturePlan[] = [
  plan("uniswap-buy-native", {
    profile: UNISWAP_UR,
    tokenIn: NATIVE as Address,
    tokenOut: MKT,
    amountIn: BUY_ETH,
    feeTier: 100,
    minOut: 1n,
  }),
  plan("uniswap-sell-to-native", {
    profile: UNISWAP_UR,
    tokenIn: MKT,
    tokenOut: NATIVE as Address,
    amountIn: SELL_MKT,
    feeTier: 100,
    minOut: 1n,
  }),
  // The floor must be enforced by the chain, not by our arithmetic. An unreachable
  // minimum that still succeeds would mean the user has no protection at all.
  plan("uniswap-buy-floor-unreachable", {
    profile: UNISWAP_UR,
    tokenIn: NATIVE as Address,
    tokenOut: MKT,
    amountIn: BUY_ETH,
    feeTier: 100,
    minOut: 10n ** 30n,
    expectRevert: true,
  }),
  // Pancake's five-field V3 leg, its own Permit2, and mask 0x3f. Read off its verified
  // source; this is the only thing that proves the encode against the deployed bytecode.
  plan("pancake-usdg-to-united", {
    profile: PANCAKE_V3_UR,
    tokenIn: USDG,
    tokenOut: UNITED,
    amountIn: SWAP_USDG,
    feeTier: 100,
    minOut: 1n,
  }),
  v4Plan("uniswap-v4-buy-native-crwd", {
    tokenIn: NATIVE,
    tokenOut: CRWD,
    amountIn: BUY_ETH,
    minOut: 1n,
    v4Key: V4_ETH_CRWD_KEY,
  }),
  v4Plan("uniswap-v4-buy-usdg-crwd", {
    tokenIn: USDG,
    tokenOut: CRWD,
    amountIn: SWAP_USDG,
    minOut: 1n,
    v4Key: V4_USDG_CRWD_KEY,
  }),
  v4Plan("uniswap-v4-sell-crwd-to-native", {
    tokenIn: CRWD,
    tokenOut: NATIVE,
    amountIn: SELL_CRWD,
    minOut: 1n,
    v4Key: V4_ETH_CRWD_KEY,
  }),
  v4Plan("uniswap-v4-buy-floor-unreachable", {
    tokenIn: NATIVE,
    tokenOut: CRWD,
    amountIn: BUY_ETH,
    minOut: 10n ** 30n,
    v4Key: V4_ETH_CRWD_KEY,
    expectRevert: true,
  }),
  v4Plan("pons-v2-hook-buy-hydx", {
    tokenIn: NATIVE,
    tokenOut: HYDX,
    amountIn: 1_000_000_000_000_000n,
    minOut: 1n,
    v4Key: V4_PONS_HYDX_KEY,
  }),
  v4Plan("pons-v2-hook-sell-hydx", {
    tokenIn: HYDX,
    tokenOut: NATIVE,
    amountIn: 1_000n * 10n ** 18n,
    minOut: 1n,
    v4Key: V4_PONS_HYDX_KEY,
  }),
  plan("uniswap-buy-native-aapl", {
    profile: UNISWAP_UR,
    tokenIn: NATIVE,
    tokenOut: AAPL,
    amountIn: BUY_ETH,
    feeTier: 500,
    minOut: 1n,
  }),
  plan("uniswap-buy-native-tsla", {
    profile: UNISWAP_UR,
    tokenIn: NATIVE,
    tokenOut: TSLA,
    amountIn: BUY_ETH,
    feeTier: 3000,
    minOut: 1n,
  }),
  plan("uniswap-two-hop-native-usdg-aapl", {
    profile: UNISWAP_UR,
    tokenIn: NATIVE,
    tokenOut: AAPL,
    amountIn: BUY_ETH,
    feeTier: 100,
    multihop: { bridge: USDG, leg1FeeTier: 100, leg2FeeTier: 500 },
    minOut: 1n,
  }),
  plan("uniswap-two-hop-floor-unreachable", {
    profile: UNISWAP_UR,
    tokenIn: NATIVE,
    tokenOut: AAPL,
    amountIn: BUY_ETH,
    feeTier: 100,
    multihop: { bridge: USDG, leg1FeeTier: 100, leg2FeeTier: 500 },
    minOut: 10n ** 30n,
    expectRevert: true,
  }),
];

const out = {
  note: "Generated by scripts/swap-fork-fixture.ts. Do not hand edit.",
  weth: WETH,
  feeRecipient: FEE_RECIPIENT,
  feeBps: FEE_BPS,
  count: plans.length,
  plans,
};

const dir = join(import.meta.dirname, "..", "contracts", "test", "fixtures");
mkdirSync(dir, { recursive: true });
const path = join(dir, "swap-plans.json");
writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);

for (const p of plans) {
  console.log(`${p.name}: ${p.commands.join(" -> ")}`);
  console.log(`  to=${p.to} value=${p.value} bytes=${(p.data.length - 2) / 2}`);
}
console.log(`\nwrote ${plans.length} plans to ${path}`);
