import { parseAbi, type PublicClient } from "viem";
import type { LedgerPools, LedgerPoolTarget } from "./ledger-pools";

/**
 * Live pool depth and price for ledger rows, read on chain in the visitor's
 * browser (two Multicall3 rounds per page). Not DexScreener: it keeps showing a
 * pool's last liquidity after a pull, and drops tokens that go quiet.
 *
 * Amounts are in the pool's own quote asset. `empty` is a measured zero; any
 * failed or unjudgeable read is `failed` and renders "—", never a zero (§4).
 */
export type LedgerMarket =
  | { status: "ok"; quoteSymbol: string; quoteAmount: number; priceInQuote: number | null; approx: boolean; otherPools: number }
  /** `activeOnly`: a V4 zero, which is "nothing at the current price", not "nothing anywhere". */
  | { status: "empty"; activeOnly: boolean; otherPools: number }
  | { status: "no-pool" }
  | { status: "failed" };

const NATIVE = "0x0000000000000000000000000000000000000000";
const Q96 = BigInt(2) ** BigInt(96);

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);
const pairAbi = parseAbi(["function token0() view returns (address)", "function token1() view returns (address)"]);
// Only the first two words: Slipstream's slot0 has a different tail than Uniswap V3's.
const slot0Abi = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick)",
  "function liquidity() view returns (uint128)",
]);
const stateViewAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
]);

type Reader = Pick<PublicClient, "multicall">;
type Call = { address: `0x${string}`; abi: readonly unknown[]; functionName: string; args?: readonly unknown[] };
type Got = { status: "success"; result: unknown } | { status: "failure" };

/** Same rule as lensCannotJudge (lib/dex/v4-reserves.ts): a return-delta hook keeps its own balance. */
const hookHoldsOwnBalance = (hooks: string) => (Number.parseInt(hooks.slice(-4), 16) & 0xf) !== 0;

async function run(client: Reader, calls: Call[]): Promise<Got[]> {
  if (calls.length === 0) return [];
  const res = await client.multicall({ contracts: calls as never, allowFailure: true });
  return res as Got[];
}

const ok = (g: Got | undefined): unknown => (g && g.status === "success" ? g.result : undefined);

export async function readLedgerMarkets(
  client: Reader,
  stateView: string | null,
  pools: Record<string, LedgerPools>,
): Promise<Map<string, LedgerMarket>> {
  const out = new Map<string, LedgerMarket>();
  const jobs: { token: string; target: LedgerPoolTarget; otherPools: number }[] = [];
  for (const [token, p] of Object.entries(pools)) {
    if (!p.target) out.set(token, { status: "no-pool" });
    else if (p.target.kind === "v4" && !stateView) out.set(token, { status: "failed" });
    else jobs.push({ token, target: p.target, otherPools: p.otherPools });
  }
  if (jobs.length === 0) return out;

  // Round 1: pool heads and the scanned token's decimals.
  const r1: Call[] = [];
  const idx1 = jobs.map((j) => {
    const at = r1.length;
    r1.push({ address: j.token as `0x${string}`, abi: erc20, functionName: "decimals" });
    if (j.target.kind === "v4") {
      const id = j.target.poolId as `0x${string}`;
      r1.push({ address: stateView as `0x${string}`, abi: stateViewAbi, functionName: "getSlot0", args: [id] });
      r1.push({ address: stateView as `0x${string}`, abi: stateViewAbi, functionName: "getLiquidity", args: [id] });
    } else {
      const a = j.target.address as `0x${string}`;
      r1.push({ address: a, abi: pairAbi, functionName: "token0" });
      r1.push({ address: a, abi: pairAbi, functionName: "token1" });
      if (j.target.kind === "v3") {
        r1.push({ address: a, abi: slot0Abi, functionName: "slot0" });
        r1.push({ address: a, abi: slot0Abi, functionName: "liquidity" });
      }
    }
    return at;
  });
  const g1 = await run(client, r1);

  // Round 2: balances (V2/V3) and the quote asset's decimals and symbol.
  interface Plan { token0: string; token1: string; quote: string; tokenIs0: boolean; at: number }
  const plans: (Plan | null)[] = [];
  const r2: Call[] = [];
  jobs.forEach((j, i) => {
    const at = idx1[i];
    let token0: string | undefined;
    let token1: string | undefined;
    if (j.target.kind === "v4") {
      token0 = j.target.currency0;
      token1 = j.target.currency1;
    } else {
      token0 = (ok(g1[at + 1]) as string | undefined)?.toLowerCase();
      token1 = (ok(g1[at + 2]) as string | undefined)?.toLowerCase();
    }
    // A pool that does not hold the scanned token on either side is the wrong subject (§8 #21).
    if (!token0 || !token1 || (token0 !== j.token && token1 !== j.token)) {
      plans.push(null);
      return;
    }
    const tokenIs0 = token0 === j.token;
    const quote = tokenIs0 ? token1 : token0;
    const start = r2.length;
    if (j.target.kind !== "v4") {
      r2.push({ address: token0 as `0x${string}`, abi: erc20, functionName: "balanceOf", args: [j.target.address] });
      r2.push({ address: token1 as `0x${string}`, abi: erc20, functionName: "balanceOf", args: [j.target.address] });
    }
    if (quote !== NATIVE) {
      r2.push({ address: quote as `0x${string}`, abi: erc20, functionName: "decimals" });
      r2.push({ address: quote as `0x${string}`, abi: erc20, functionName: "symbol" });
    }
    plans.push({ token0, token1, quote, tokenIs0, at: start });
  });
  const g2 = await run(client, r2);

  jobs.forEach((j, i) => {
    const plan = plans[i];
    if (!plan) return out.set(j.token, { status: "failed" });
    const at1 = idx1[i];
    const tokenDecimals = ok(g1[at1]);
    let q = plan.at;
    let bal0: bigint | undefined;
    let bal1: bigint | undefined;
    if (j.target.kind !== "v4") {
      bal0 = ok(g2[q++]) as bigint | undefined;
      bal1 = ok(g2[q++]) as bigint | undefined;
    }
    const native = plan.quote === NATIVE;
    const quoteDecimals = native ? 18 : ok(g2[q++]);
    const quoteSymbol = native ? "ETH" : ok(g2[q++]);
    if (typeof quoteDecimals !== "number" || typeof quoteSymbol !== "string") return out.set(j.token, { status: "failed" });

    const scale = (raw: bigint, d: number) => Number(raw) / 10 ** d;
    const td = typeof tokenDecimals === "number" ? tokenDecimals : null;
    // Human price of the token in quote units from a Q96 sqrt price.
    const fromSqrt = (sqrtP: bigint): number | null => {
      if (td === null || sqrtP === BigInt(0)) return null;
      const p = (Number(sqrtP) / Number(Q96)) ** 2;
      const raw = plan.tokenIs0 ? p : 1 / p;
      return raw * 10 ** (td - quoteDecimals);
    };

    if (j.target.kind === "v4") {
      const slot = ok(g1[at1 + 1]) as readonly [bigint, number, number, number] | undefined;
      const liquidity = ok(g1[at1 + 2]) as bigint | undefined;
      if (!slot || liquidity === undefined) return out.set(j.token, { status: "failed" });
      if (liquidity === BigInt(0)) {
        return out.set(j.token, hookHoldsOwnBalance(j.target.hooks) ? { status: "failed" } : { status: "empty", activeOnly: true, otherPools: j.otherPools });
      }
      const sqrtP = slot[0];
      // Active liquidity at the current price, as the quote side it could pay out.
      const quoteRaw = plan.tokenIs0 ? (liquidity * sqrtP) / Q96 : (liquidity * Q96) / sqrtP;
      return out.set(j.token, {
        status: "ok",
        quoteSymbol,
        quoteAmount: scale(quoteRaw, quoteDecimals),
        priceInQuote: fromSqrt(sqrtP),
        approx: true,
        otherPools: j.otherPools,
      });
    }

    if (bal0 === undefined || bal1 === undefined) return out.set(j.token, { status: "failed" });
    const quoteRaw = plan.tokenIs0 ? bal1 : bal0;
    const tokenRaw = plan.tokenIs0 ? bal0 : bal1;
    if (quoteRaw === BigInt(0)) return out.set(j.token, { status: "empty", activeOnly: false, otherPools: j.otherPools });
    let priceInQuote: number | null = null;
    if (j.target.kind === "v3") {
      const slot = ok(g1[at1 + 3]) as readonly [bigint, number] | undefined;
      // Dust left behind a full withdrawal still has a balance; active liquidity says it cannot trade.
      if (ok(g1[at1 + 4]) === BigInt(0)) return out.set(j.token, { status: "empty", activeOnly: true, otherPools: j.otherPools });
      priceInQuote = slot ? fromSqrt(slot[0]) : null;
    } else if (td !== null && tokenRaw > BigInt(0)) {
      priceInQuote = scale(quoteRaw, quoteDecimals) / scale(tokenRaw, td);
    }
    out.set(j.token, { status: "ok", quoteSymbol, quoteAmount: scale(quoteRaw, quoteDecimals), priceInQuote, approx: false, otherPools: j.otherPools });
  });
  return out;
}

const SUBSCRIPT = "₀₁₂₃₄₅₆₇₈₉";

/** Pool depth: dust reads as "<0.0001" rather than an exponent. */
export function formatAmount(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  if (v === 0) return "0";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  if (v >= 1) return v.toFixed(2);
  if (v >= 1e-4) return v.toPrecision(3);
  return "<0.0001";
}

/** Token price: 0.0₈8877 style for tiny values, four significant digits. */
export function formatPrice(v: number | null): string {
  if (v === null || !Number.isFinite(v) || v <= 0) return "—";
  if (v >= 1e-4) return formatAmount(v);
  const zeros = Math.floor(-Math.log10(v));
  // Subscript counts the zeros after the point: 0.0₈8877 is 0.000000008877.
  const digits = Math.round(v * 10 ** (zeros + 4)).toString().replace(/0+$/, "");
  return `0.0${String(zeros).split("").map((d) => SUBSCRIPT[Number(d)]).join("")}${digits}`;
}
