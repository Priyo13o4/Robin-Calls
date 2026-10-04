#!/usr/bin/env node
/**
 * Read-only Uniswap V4 hook and directional quote probe for Robinhood Chain.
 *
 * This is an evidence collector, not a token-level honeypot oracle. V4Quoter
 * does not settle real token transfers, and StateView liquidity is raw L, not
 * a comparable USD value across pools.
 *
 * Usage: npx tsx scripts/v4-hook-check.ts <token-address> [--buy-amount <counter-token-units>] [--reference-pool <pool-id>] [--dexscreener]
 * Pools come from every Initialize since block 0, which also finds pools DexScreener does not list
 * (L205 decoys). When the node refuses that census (10,000-log cap on popular tokens such as NVDA),
 * or with --dexscreener, pool ids come from DexScreener instead and the output says so.
 */

import {
  createPublicClient,
  decodeEventLog,
  formatUnits,
  http,
  parseAbi,
  parseAbiItem,
  parseUnits,
  toFunctionSelector,
  type Address,
  type Hex,
} from "viem";
import { robinhoodChain } from "../lib/config/chain";
import { v4StateViewAbi, V4_HOOK_FLAGS } from "../lib/rpc/abis";
import { isTransientRpcError } from "../lib/rpc/fault";

export const DEFAULTS = {
  // Official Robinhood Chain (4663) deployment addresses. Override with the
  // matching V4_* env var if the deployment changes. Source: Uniswap deployments docs.
  poolManager: "0x8366a39cc670b4001a1121b8f6a443a643e40951",
  stateView: "0xf3334192d15450cdd385c8b70e03f9a6bd9e673b",
  quoter: "0x8dc178efb8111bb0973dd9d722ebeff267c98f94",
} as const satisfies Record<string, Address>;

const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const RPC_URL = process.env.ROBINHOOD_RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || "https://rpc.mainnet.chain.robinhood.com";
const INITIALIZE = parseAbiItem(
  "event Initialize(bytes32 indexed id,address indexed currency0,address indexed currency1,uint24 fee,int24 tickSpacing,address hooks,uint160 sqrtPriceX96,int24 tick)",
);
export const QUOTE_ABI = parseAbi([
  "struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }",
  "struct QuoteExactSingleParams { PoolKey poolKey; bool zeroForOne; uint128 exactAmount; bytes hookData; }",
  "function quoteExactInputSingle(QuoteExactSingleParams params) returns (uint256 amountOut,uint256 gasEstimate)",
]);
const TOKEN_META_ABI = parseAbi(["function decimals() view returns (uint8)", "function symbol() view returns (string)"]);

const RECOGNIZED_SIGNATURES = [
  "SellNotAllowed(address)",
  "Blacklisted(address)",
  "ContractPaused()",
  "Unauthorized()",
  "authorizedRouters(address)",
  "setAuthorizedRouter(address,bool)",
  "liquidityOperators(address)",
  "setLiquidityOperators(address[],bool)",
  "blacklist(address)",
  "setBlacklist(address[],bool)",
  "setPaused(bool)",
] as const;
const RECOGNIZED_SELECTORS = Object.fromEntries(
  RECOGNIZED_SIGNATURES.map((signature) => [toFunctionSelector(signature), signature]),
) as Record<string, string>;

export interface HookBytecodeAudit {
  state: "hookless" | "code-present" | "code-missing" | "read-failed";
  permissions: { beforeSwap: boolean; afterSwap: boolean; beforeAddLiquidity: boolean; beforeRemoveLiquidity: boolean };
  push4Selectors: string[];
  recognizedSelectors: { selector: string; name: string }[];
}

export interface QuoteObservation {
  state: "quoted" | "zero-output" | "reverted" | "unknown" | "not-run";
  amountIn?: string;
  amountInHuman?: string;
  amountOut?: string;
  amountOutHuman?: string;
  reason?: string;
}

export interface PoolAssessment {
  poolId: Hex;
  currency0: Address;
  currency1: Address;
  currency0Symbol?: string;
  currency1Symbol?: string;
  fee: number;
  tickSpacing: number;
  hooks: Address;
  activeLiquidity: string | null;
  liquidityRead: "measured" | "failed";
  liquidityError?: string;
  hook: HookBytecodeAudit;
  buy: QuoteObservation;
  sell: QuoteObservation;
  referenceSell?: QuoteObservation;
  referenceSellCurrency?: { address: Address; symbol: string; decimals: number } | null;
  evidence: "buy-only-quote-failure" | "asymmetric-quote-observation" | "sell-quote-returns-output" | "sell-quote-zero-output" | "inconclusive";
  roundTripRecoveryBps: string | null;
}


/** Read PUSH4 operands while skipping immediate bytes for every PUSHn. */
export function extractPush4Selectors(bytecode: Hex): string[] {
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(bytecode)) return [];
  const bytes = Buffer.from(bytecode.slice(2), "hex");
  const selectors = new Set<string>();
  for (let pc = 0; pc < bytes.length; ) {
    const opcode = bytes[pc];
    pc++;
    if (opcode >= 0x60 && opcode <= 0x7f) {
      const size = opcode - 0x5f;
      if (opcode === 0x63 && pc + 4 <= bytes.length) {
        selectors.add(`0x${bytes.subarray(pc, pc + 4).toString("hex")}`);
      }
      pc += size;
    }
  }
  return [...selectors];
}

export function auditHookBytecode(hookAddress: Address, bytecode: Hex | null, readFailed = false): HookBytecodeAudit {
  const permissions = {
    beforeSwap: false,
    afterSwap: false,
    beforeAddLiquidity: false,
    beforeRemoveLiquidity: false,
  };
  if (hookAddress.toLowerCase() === ZERO) {
    return { state: "hookless", permissions, push4Selectors: [], recognizedSelectors: [] };
  }
  if (readFailed) return { state: "read-failed", permissions, push4Selectors: [], recognizedSelectors: [] };
  if (!bytecode || bytecode === "0x") {
    return { state: "code-missing", permissions, push4Selectors: [], recognizedSelectors: [] };
  }

  const flags = BigInt(hookAddress) & 0x3fffn;
  permissions.beforeSwap = (flags & BigInt(V4_HOOK_FLAGS.BEFORE_SWAP)) !== 0n;
  permissions.afterSwap = (flags & BigInt(V4_HOOK_FLAGS.AFTER_SWAP)) !== 0n;
  permissions.beforeAddLiquidity = (flags & (1n << 9n)) !== 0n;
  permissions.beforeRemoveLiquidity = (flags & (1n << 11n)) !== 0n;
  const push4Selectors = extractPush4Selectors(bytecode);
  const recognizedSelectors = push4Selectors.flatMap((selector) =>
    RECOGNIZED_SELECTORS[selector] ? [{ selector, name: RECOGNIZED_SELECTORS[selector] }] : [],
  );
  return { state: "code-present", permissions, push4Selectors, recognizedSelectors };
}

export function classifyPoolEvidence(input: {
  buy: QuoteObservation;
  sell: QuoteObservation;
  liquidity: bigint | null;
  hook: HookBytecodeAudit["state"];
}): PoolAssessment["evidence"] {
  // A buy quote plus a sell revert is only a directional observation until
  // StateView independently reports active liquidity. Quoter output alone does
  // not prove the route is live/executable (L98).
  if (input.buy.state === "quoted" && input.sell.state === "reverted") {
    if (input.liquidity !== null && input.liquidity > 0n) return "buy-only-quote-failure";
    return "asymmetric-quote-observation";
  }
  if (input.liquidity === null || input.hook === "read-failed" || input.hook === "code-missing") return "inconclusive";
  if (input.liquidity === 0n) return "inconclusive";
  if (input.sell.state === "quoted") return "sell-quote-returns-output";
  if (input.sell.state === "zero-output") return "sell-quote-zero-output";
  return "inconclusive";
}

function configuredAddress(envName: string, fallback: Address): Address {
  const value = process.env[envName]?.trim();
  return (value && /^0x[0-9a-fA-F]{40}$/.test(value) ? value.toLowerCase() : fallback) as Address;
}

export interface CliOptions {
  token: Address | null;
  buyAmount: string | null;
  referencePoolId: Hex | null;
  /** Skip the block-0 census and take pool ids from DexScreener only. */
  dexscreenerOnly: boolean;
  error: string | null;
}

export function parseCliArgs(args: readonly string[]): CliOptions {
  const tokenArg = args[0]?.trim();
  if (!tokenArg || !/^0x[0-9a-fA-F]{40}$/.test(tokenArg)) {
    return { token: null, buyAmount: null, referencePoolId: null, dexscreenerOnly: false, error: "A token address is required." };
  }
  let buyAmount: string | null = null;
  let referencePoolId: Hex | null = null;
  let dexscreenerOnly = false;
  for (let index = 1; index < args.length; index++) {
    if (args[index] === "--dexscreener") {
      dexscreenerOnly = true;
    } else if (args[index] === "--buy-amount") {
      const value = args[++index];
      if (!value || !/^\d+(?:\.\d+)?$/.test(value)) {
        return { token: tokenArg.toLowerCase() as Address, buyAmount: null, referencePoolId, dexscreenerOnly, error: "--buy-amount must be a decimal counter-token amount." };
      }
      buyAmount = value;
    } else if (args[index] === "--reference-pool") {
      const value = args[++index];
      if (!value || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
        return { token: tokenArg.toLowerCase() as Address, buyAmount, referencePoolId: null, dexscreenerOnly, error: "--reference-pool must be a 32-byte V4 pool ID." };
      }
      referencePoolId = value.toLowerCase() as Hex;
    } else {
      return { token: tokenArg.toLowerCase() as Address, buyAmount, referencePoolId, dexscreenerOnly, error: `Unknown option: ${args[index]}` };
    }
  }
  return { token: tokenArg.toLowerCase() as Address, buyAmount, referencePoolId, dexscreenerOnly, error: null };
}

function asErrorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function collectErrorData(error: unknown): string {
  const seen = new Set<object>();
  const visit = (value: unknown, depth: number): string[] => {
    if (depth > 5 || value == null) return [];
    if (typeof value === "string") return [value];
    if (typeof value !== "object" || seen.has(value)) return [];
    seen.add(value);
    const record = value as Record<string, unknown>;
    return ["message", "shortMessage", "details", "data", "raw", "cause", "metaMessages"]
      .flatMap((key) => visit(record[key], depth + 1));
  };
  return visit(error, 0).join(" ").slice(0, 6000);
}

function decodeInnerHookError(error: unknown): string {
  const text = collectErrorData(error) || asErrorText(error);
  const lower = text.toLowerCase();
  for (const [selector, name] of Object.entries(RECOGNIZED_SELECTORS)) {
    if (lower.includes(selector.slice(2))) return name;
  }
  return text.split("\n")[0].slice(0, 180);
}

export function quoteStatus(amountOut: bigint): QuoteObservation["state"] {
  return amountOut > 0n ? "quoted" : "zero-output";
}

/** Relative same-pool recovery only; this is quote-value context, not a security verdict. */
export function roundTripLabel(recoveryBps: string | null): "POOR RETURN / EXIT VALUE NOT ESTABLISHED" | "NONZERO RETURN QUOTE" | "UNAVAILABLE" {
  if (recoveryBps === null) return "UNAVAILABLE";
  return BigInt(recoveryBps) < 5000n ? "POOR RETURN / EXIT VALUE NOT ESTABLISHED" : "NONZERO RETURN QUOTE";
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      output[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return output;
}

const useColor = process.stdout.isTTY !== false && !process.env.NO_COLOR;
const color = {
  reset: (s: string) => (useColor ? `\x1b[0m${s}\x1b[0m` : s),
  bold: (s: string) => (useColor ? `\x1b[1m${s}\x1b[0m` : s),
  dim: (s: string) => (useColor ? `\x1b[2m${s}\x1b[0m` : s),
  red: (s: string) => (useColor ? `\x1b[31m${s}\x1b[0m` : s),
  green: (s: string) => (useColor ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s: string) => (useColor ? `\x1b[33m${s}\x1b[0m` : s),
  blue: (s: string) => (useColor ? `\x1b[34m${s}\x1b[0m` : s),
  magenta: (s: string) => (useColor ? `\x1b[35m${s}\x1b[0m` : s),
  cyan: (s: string) => (useColor ? `\x1b[36m${s}\x1b[0m` : s),
  gray: (s: string) => (useColor ? `\x1b[90m${s}\x1b[0m` : s),
};

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function pad(str: string, width: number, align: "left" | "right" | "center" = "left"): string {
  const visible = stripAnsi(str).length;
  if (visible >= width) return str;
  const diff = width - visible;
  if (align === "right") return " ".repeat(diff) + str;
  if (align === "center") {
    const left = Math.floor(diff / 2);
    const right = diff - left;
    return " ".repeat(left) + str + " ".repeat(right);
  }
  return str + " ".repeat(diff);
}

function shortHash(hash: string): string {
  if (hash.length <= 14) return hash;
  return `${hash.slice(0, 6)}..${hash.slice(-4)}`;
}

function shortAddr(addr: string): string {
  if (addr.toLowerCase() === ZERO) return "ETH (native)";
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatV4Fee(fee: number): { short: string; detailed: string } {
  if (fee === 0) return { short: "0%", detailed: "0% (fee=0)" };
  const isDynamic = (fee & 0x800000) !== 0;
  if (isDynamic) {
    const staticPart = fee & 0x7fffff;
    const pct = (staticPart / 10000).toFixed(2);
    return { short: `Dyn (${pct}%)`, detailed: `Dynamic [${pct}%] (fee=${fee})` };
  }
  const pct = fee / 10000;
  const pctStr = pct % 1 === 0 ? `${pct.toFixed(0)}%` : `${pct.toFixed(pct * 10 % 1 === 0 ? 1 : 2)}%`;
  return { short: pctStr, detailed: `${pctStr} (${fee.toLocaleString("en-US")})` };
}

function formatLiquidity(liquidity: bigint | null, error?: string): { compact: string; detailed: string } {
  if (liquidity === null) {
    const errText = error ? `failed: ${error}` : "RPC failed";
    return { compact: color.red("UNKNOWN"), detailed: `${color.red("UNKNOWN")} (${errText})` };
  }
  if (liquidity === 0n) {
    return { compact: color.gray("0 (empty)"), detailed: `${color.gray("0")} (empty / no active liquidity)` };
  }
  const str = liquidity.toString();
  const num = Number(liquidity);
  let compact = "";
  if (liquidity >= 10n ** 15n) {
    const exp = str.length - 1;
    const mantissa = (Number(str.slice(0, 4)) / 1000).toFixed(2);
    compact = `${mantissa}e${exp}`;
  } else if (num >= 1e12) {
    compact = `${(num / 1e12).toFixed(2)}T`;
  } else if (num >= 1e9) {
    compact = `${(num / 1e9).toFixed(2)}B`;
  } else if (num >= 1e6) {
    compact = `${(num / 1e6).toFixed(2)}M`;
  } else if (num >= 1e3) {
    compact = `${(num / 1e3).toFixed(2)}K`;
  } else {
    compact = num.toString();
  }
  const fullFormatted = BigInt(str).toLocaleString("en-US");
  return { compact, detailed: `${fullFormatted} (~${compact}) [measured]` };
}

function formatHumanNumber(val: string | undefined): string {
  if (!val) return "";
  const parts = val.split(".");
  const intPart = BigInt(parts[0] || "0");
  if (parts.length === 1) {
    return intPart.toLocaleString("en-US");
  }
  const frac = parts[1];
  const n = parseFloat(val);
  if (isNaN(n) || n === 0) return "0";
  if (n >= 1000) {
    return `${intPart.toLocaleString("en-US")}.${frac.slice(0, 2)}`;
  }
  if (n >= 1) {
    return `${intPart.toLocaleString("en-US")}.${frac.slice(0, 4)}`;
  }
  let firstNonZero = 0;
  while (firstNonZero < frac.length && frac[firstNonZero] === "0") {
    firstNonZero++;
  }
  const end = Math.min(frac.length, Math.max(6, firstNonZero + 4));
  return `0.${frac.slice(0, end)}`;
}

function formatHookPermissions(permissions: HookBytecodeAudit["permissions"]): string[] {
  const active: string[] = [];
  if (permissions.beforeSwap) active.push("beforeSwap");
  if (permissions.afterSwap) active.push("afterSwap");
  if (permissions.beforeAddLiquidity) active.push("beforeAddLiquidity");
  if (permissions.beforeRemoveLiquidity) active.push("beforeRemoveLiquidity");
  return active;
}

async function readMetadata(client: ReturnType<typeof createPublicClient>, address: Address, blockNumber: bigint) {
  try {
    const [decimals, symbol] = await Promise.all([
      client.readContract({ address, abi: TOKEN_META_ABI, functionName: "decimals", blockNumber }),
      client.readContract({ address, abi: TOKEN_META_ABI, functionName: "symbol", blockNumber }),
    ]);
    return { decimals: Number(decimals), symbol };
  } catch {
    return null;
  }
}

/** The public node refuses an eth_getLogs span over 10M blocks (measured 2026-09-28). */
export const LOG_SPAN = 10_000_000n;
const MIN_SPLIT_SPAN = 100_000n;

/** Pools the per-pool checks can finish in a few minutes. NVDA's census alone returns 15,769. */
const MAX_CENSUS_POOLS = 300;

/** [from, to] windows walking back from head to block 0, newest first. No later floor: NVDA has pools below local v4_pools' earliest row. */
export function spanWindows(head: bigint): [bigint, bigint][] {
  const out: [bigint, bigint][] = [];
  for (let to = head; ; to -= LOG_SPAN) {
    const from = to >= LOG_SPAN ? to - LOG_SPAN + 1n : 0n;
    out.push([from, to]);
    if (from === 0n) return out;
  }
}

/** The public node times out and 429s on old windows that answer on a second try. */
async function retried<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (error) {
      // The public node also answers a transient refusal as "Missing or invalid parameters" (L213 #23).
      if (i >= tries || !/timed out|too many requests|429|missing or invalid parameters|header not found/i.test(asErrorText(error))) throw error;
      await new Promise((r) => setTimeout(r, 3_000 * i));
    }
  }
}

/**
 * Pool ids from DexScreener, each confirmed by its own Initialize log, searched newest window
 * first so a young pool costs one query. The census by currency hits the node's 10,000-log cap
 * on popular tokens (NVDA). Blind to pools DexScreener does not list.
 */
async function dexScreenerCensus(client: ReturnType<typeof createPublicClient>, poolManager: Address, token: Address, head: bigint) {
  const res = await fetch(`https://api.dexscreener.com/token-pairs/v1/robinhood/${token}`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`DexScreener ${res.status}`);
  const ids = ((await res.json()) as { pairAddress?: string }[])
    .map((p) => p.pairAddress)
    .filter((id): id is string => typeof id === "string" && id.length === 66);
  const missing: string[] = [];
  const found = await mapLimit(ids, 4, async (id) => {
    for (const [fromBlock, toBlock] of spanWindows(head)) {
      const logs = await retried(() => client.getLogs({ address: poolManager, event: INITIALIZE, args: { id: id as Hex }, fromBlock, toBlock }));
      if (logs.length) return logs;
    }
    missing.push(id);
    return [];
  });
  return { logs: found.flat(), listed: ids.length, missing };
}

export interface HookCheckResult {
  assessments: PoolAssessment[];
  census: string;
  /** False when the chain census was refused or too large and DexScreener's list stood in for it. */
  censusComplete: boolean;
}

/**
 * Exit code: 0 no buy-only failure, 1 inconclusive or error, 2 asymmetric (buy works, sell fails).
 * `quiet` prints nothing and `onResult` receives the per-pool facts (scripts/pre-trade-check.ts).
 */
export async function main(
  args: readonly string[] = process.argv.slice(2),
  opts: { quiet?: boolean; onResult?: (result: HookCheckResult) => void } = {},
): Promise<number> {
  const log: (...parts: unknown[]) => void = opts.quiet ? () => {} : console.log;
  const options = parseCliArgs(args);
  if (options.error || !options.token) {
    console.error(`${options.error ?? "A token address is required."}\nUsage: npx tsx scripts/v4-hook-check.ts <token-address> [--buy-amount <counter-token-units>] [--reference-pool <pool-id>] [--dexscreener]`);
    return 1;
  }
  const token = options.token;
  const requestedBuyAmount = options.buyAmount;
  const referencePoolId = options.referencePoolId;
  const poolManager = configuredAddress("V4_POOL_MANAGER_ADDRESS", DEFAULTS.poolManager);
  const stateView = configuredAddress("V4_STATE_VIEW_ADDRESS", DEFAULTS.stateView);
  const quoter = configuredAddress("V4_QUOTER_ADDRESS", DEFAULTS.quoter);
  const client = createPublicClient({
    chain: robinhoodChain,
    transport: http(RPC_URL, {
      fetchOptions: { headers: { "user-agent": "curl/8.4" } },
      timeout: 25_000,
      retryCount: 3,
      retryDelay: 400,
    }),
  });

  log(color.bold("═".repeat(84)));
  log(color.bold(color.cyan("       Robinhood Chain (4663) — Uniswap V4 Pool & Hook Diagnostic Analyzer         ")));
  log(color.bold("═".repeat(84)));
  log(` Target Address:  ${color.bold(token)}`);
  log(` RPC Endpoint:    ${RPC_URL === "https://rpc.mainnet.chain.robinhood.com" ? "public Robinhood endpoint" : "configured endpoint (credentials hidden)"}`);

  let blockNumber: bigint;
  try {
    blockNumber = await client.getBlockNumber();
  } catch (error) {
    console.error(color.red(`HEAD UNKNOWN: could not pin a block: ${asErrorText(error).slice(0, 200)}`));
    return 1;
  }
  log(` Pinned Block:    ${color.bold(blockNumber.toString())}`);

  const metadata = await readMetadata(client, token, blockNumber);
  log(` Target Token:    ${metadata ? `${color.bold(color.green(metadata.symbol))} (${metadata.decimals} decimals)` : color.yellow("metadata unavailable")}`);
  log(` Buy Probe Sizing:${color.bold(` ${requestedBuyAmount ?? "0.001"}`)} counter-token units (exact same-pool return leg)`);
  if (referencePoolId) {
    log(` Reference Pool:  ${referencePoolId}`);
  }

  let initLogs: Awaited<ReturnType<typeof dexScreenerCensus>>["logs"] = [];
  let censusNote = "";
  let censusComplete = false;
  // A refused window is halved before the whole census falls back to DexScreener's list.
  const censusWindow = async (fromBlock: bigint, toBlock: bigint): Promise<Awaited<ReturnType<typeof client.getLogs<typeof INITIALIZE>>>> => {
    try {
      return [
        ...(await retried(() => client.getLogs({ address: poolManager, event: INITIALIZE, args: { currency0: token }, fromBlock, toBlock }))),
        ...(await retried(() => client.getLogs({ address: poolManager, event: INITIALIZE, args: { currency1: token }, fromBlock, toBlock }))),
      ];
    } catch (error) {
      if (toBlock - fromBlock < MIN_SPLIT_SPAN) throw error;
      const mid = fromBlock + (toBlock - fromBlock) / 2n;
      return [...(await censusWindow(fromBlock, mid)), ...(await censusWindow(mid + 1n, toBlock))];
    }
  };
  const fromDexScreener = async (why: string) => {
    const census = await dexScreenerCensus(client, poolManager, token, blockNumber);
    initLogs = census.logs;
    censusNote = `DexScreener's ${census.listed} listed V4 pool(s) (${why})` +
      (census.missing.length ? `, ${census.missing.length} not found on chain (${census.missing.map(shortHash).join(", ")})` : "") +
      "; pools DexScreener does not list are NOT checked";
  };
  try {
    if (options.dexscreenerOnly) {
      await fromDexScreener("--dexscreener");
    } else {
      try {
        const windows = await mapLimit(spanWindows(blockNumber), 1, ([fromBlock, toBlock]) => censusWindow(fromBlock, toBlock));
        const all = windows.flat();
        if (all.length > MAX_CENSUS_POOLS) {
          await fromDexScreener(`the full census found ${all.length} pools, too many to check one by one`);
        } else {
          initLogs = all;
          censusNote = "every Initialize from block 0";
          censusComplete = true;
        }
      } catch (error) {
        await fromDexScreener(`the block-0 census was refused: ${asErrorText(error).slice(0, 60)}`);
      }
    }
  } catch (error) {
    console.error(color.red(`DISCOVERY UNKNOWN: Initialize census failed: ${asErrorText(error).slice(0, 220)}`));
    return 1;
  }

  const pools = new Map<Hex, { poolId: Hex; currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address }>();
  try {
    for (const log of initLogs) {
      const decoded = decodeEventLog({ abi: [INITIALIZE], data: log.data, topics: log.topics });
      const args = decoded.args;
      pools.set(args.id, {
        poolId: args.id,
        currency0: args.currency0,
        currency1: args.currency1,
        fee: Number(args.fee),
        tickSpacing: Number(args.tickSpacing),
        hooks: args.hooks,
      });
    }
  } catch (error) {
    console.error(color.red(`DISCOVERY UNKNOWN: could not decode a returned Initialize log: ${asErrorText(error).slice(0, 220)}`));
    return 1;
  }
  log(` V4 Pool Census:  ${color.bold(color.green(`${pools.size} unique pool(s)`))} from ${censusNote}`);
  log(color.dim("─".repeat(84)));

  if (pools.size === 0) {
    log(color.yellow("No initialized Uniswap V4 pools found in the completed census."));
    return 0;
  }
  if (referencePoolId && ![...pools.keys()].some((poolId) => poolId.toLowerCase() === referencePoolId.toLowerCase())) {
    console.error(color.red(`Reference pool ${referencePoolId} is not present in the completed Initialize census for this token.`));
    return 1;
  }

  const rows = [...pools.values()];

  // Cache for metadata of counter tokens
  const metadataCache = new Map<string, { decimals: number; symbol: string } | null>();
  if (metadata) {
    metadataCache.set(token.toLowerCase(), metadata);
  }
  async function getCachedMetadata(addr: Address): Promise<{ decimals: number; symbol: string } | null> {
    const key = addr.toLowerCase();
    if (key === ZERO) return { decimals: 18, symbol: "ETH" };
    if (metadataCache.has(key)) return metadataCache.get(key)!;
    const meta = await readMetadata(client, addr, blockNumber);
    metadataCache.set(key, meta);
    return meta;
  }

  // Pre-fetch metadata for all unique currencies in pools
  const uniqueCurrencies = [...new Set(rows.flatMap((p) => [p.currency0, p.currency1]))];
  await mapLimit(uniqueCurrencies, 3, async (addr) => {
    await getCachedMetadata(addr);
  });

  // Query liquidity with batch multicall, then fallback with retry
  const liquidityResults: { value: bigint | null; error?: string }[] = rows.map(() => ({ value: null, error: "unread" }));
  let fallbackIndices = rows.map((_, index) => index);
  try {
    const batchResults = await client.multicall({
      contracts: rows.map((pool) => ({ address: stateView, abi: v4StateViewAbi, functionName: "getLiquidity", args: [pool.poolId] })),
      allowFailure: true,
      blockNumber,
    });
    fallbackIndices = [];
    for (let index = 0; index < batchResults.length; index++) {
      const result = batchResults[index];
      if (result.status === "success") liquidityResults[index] = { value: result.result };
      else fallbackIndices.push(index);
    }
  } catch {
    // Retry each pool individually below
  }

  await mapLimit(fallbackIndices, 2, async (index) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const val = await client.readContract({
          address: stateView,
          abi: v4StateViewAbi,
          functionName: "getLiquidity",
          args: [rows[index].poolId],
          blockNumber,
        });
        liquidityResults[index] = { value: val };
        return;
      } catch (error) {
        lastError = error;
        if (!isTransientRpcError(error)) break;
        await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
      }
    }
    liquidityResults[index] = { value: null, error: asErrorText(lastError).split("\n")[0].slice(0, 160) };
  });

  const hookAddresses = [...new Set(rows.map((pool) => pool.hooks.toLowerCase()).filter((hook) => hook !== ZERO))] as Address[];
  const hookCode = new Map<string, { bytecode: Hex | null; failed: boolean }>();
  await mapLimit(hookAddresses, 3, async (hook) => {
    try {
      hookCode.set(hook.toLowerCase(), { bytecode: (await client.getBytecode({ address: hook, blockNumber })) ?? null, failed: false });
    } catch {
      hookCode.set(hook.toLowerCase(), { bytecode: null, failed: true });
    }
  });

  const assessments: PoolAssessment[] = await mapLimit(rows, 3, async (pool, index) => {
    const liquidityObservation = liquidityResults[index];
    const liquidity = liquidityObservation.value;
    const hookCodeResult = pool.hooks.toLowerCase() === ZERO ? null : hookCode.get(pool.hooks.toLowerCase());
    const hook = auditHookBytecode(pool.hooks, hookCodeResult?.bytecode ?? null, hookCodeResult?.failed ?? false);
    const inertHookless = liquidity === 0n && hook.state === "hookless";
    let buy: QuoteObservation = { state: "not-run" };
    let sell: QuoteObservation = { state: "not-run" };
    let roundTripRecoveryBps: string | null = null;

    const c0Meta = await getCachedMetadata(pool.currency0);
    const c1Meta = await getCachedMetadata(pool.currency1);
    const currency0Symbol = c0Meta?.symbol ?? shortAddr(pool.currency0);
    const currency1Symbol = c1Meta?.symbol ?? shortAddr(pool.currency1);

    if (!inertHookless && metadata) {
      const counter = pool.currency0.toLowerCase() === token ? pool.currency1 : pool.currency0;
      const counterMeta = await getCachedMetadata(counter);
      let buyInput = 0n;
      try {
        if (counterMeta) buyInput = parseUnits(requestedBuyAmount ?? "0.001", counterMeta.decimals);
      } catch {
        buyInput = 0n;
      }
      if (counterMeta && buyInput > 0n && buyInput <= (1n << 128n) - 1n) {
        const zeroForOneSell = pool.currency0.toLowerCase() === token;
        try {
          const [amountOut] = await client.simulateContract({
            address: quoter,
            abi: QUOTE_ABI,
            functionName: "quoteExactInputSingle",
            args: [{ poolKey: pool, zeroForOne: !zeroForOneSell, exactAmount: buyInput, hookData: "0x" }],
            blockNumber,
          }).then((result) => result.result);
          buy = {
            state: quoteStatus(amountOut),
            amountIn: buyInput.toString(),
            amountInHuman: `${requestedBuyAmount ?? "0.001"} ${counterMeta.symbol}`,
            amountOut: amountOut.toString(),
            amountOutHuman: formatUnits(amountOut, metadata.decimals),
          };
        } catch (error) {
          buy = {
            state: isTransientRpcError(error) ? "unknown" : "reverted",
            amountIn: buyInput.toString(),
            amountInHuman: `${requestedBuyAmount ?? "0.001"} ${counterMeta.symbol}`,
            reason: isTransientRpcError(error) ? `RPC fault: ${decodeInnerHookError(error)}` : decodeInnerHookError(error),
          };
        }
        const returnInput = buy.amountOut ? BigInt(buy.amountOut) : 0n;
        if (buy.state === "quoted" && returnInput > 0n && returnInput <= (1n << 128n) - 1n) {
          try {
            const [amountOut] = await client.simulateContract({
              address: quoter,
              abi: QUOTE_ABI,
              functionName: "quoteExactInputSingle",
              args: [{ poolKey: pool, zeroForOne: zeroForOneSell, exactAmount: returnInput, hookData: "0x" }],
              blockNumber,
            }).then((result) => result.result);
            sell = {
              state: quoteStatus(amountOut),
              amountIn: returnInput.toString(),
              amountInHuman: `${buy.amountOutHuman} ${metadata.symbol}`,
              amountOut: amountOut.toString(),
              amountOutHuman: formatUnits(amountOut, counterMeta.decimals),
            };
            roundTripRecoveryBps = ((amountOut * 10000n) / buyInput).toString();
          } catch (error) {
            sell = {
              state: isTransientRpcError(error) ? "unknown" : "reverted",
              amountIn: returnInput.toString(),
              amountInHuman: `${buy.amountOutHuman} ${metadata.symbol}`,
              reason: isTransientRpcError(error) ? `RPC fault: ${decodeInnerHookError(error)}` : decodeInnerHookError(error),
            };
          }
        } else if (buy.state === "quoted" && returnInput > (1n << 128n) - 1n) {
          sell = { state: "unknown", reason: "buy output exceeds V4 exact-input uint128 limit" };
        } else {
          sell = { state: "not-run", reason: "return leg requires a positive, reportable buy quote" };
        }
      } else {
        buy = { state: "unknown", reason: "counter-token decimals unavailable or requested amount cannot be represented" };
        sell = { state: "unknown", reason: "same-pool return leg could not be sized" };
      }
    } else if (!metadata) {
      buy = { state: "unknown", reason: "target token decimals unavailable" };
      sell = { state: "unknown", reason: "target token decimals unavailable" };
    }

    return {
      ...pool,
      currency0Symbol,
      currency1Symbol,
      activeLiquidity: liquidity?.toString() ?? null,
      liquidityRead: liquidity === null ? "failed" : "measured",
      ...(liquidityObservation.error ? { liquidityError: liquidityObservation.error } : {}),
      hook,
      buy,
      sell,
      evidence: classifyPoolEvidence({ buy, sell, liquidity, hook: hook.state }),
      roundTripRecoveryBps,
    };
  });

  if (referencePoolId) {
    const reference = assessments.find((pool) => pool.poolId.toLowerCase() === referencePoolId.toLowerCase());
    const referenceAmount = reference?.buy.state === "quoted" && reference.buy.amountOut
      ? BigInt(reference.buy.amountOut)
      : null;
    await mapLimit(assessments, 3, async (pool) => {
      const counter = pool.currency0.toLowerCase() === token ? pool.currency1 : pool.currency0;
      const counterMeta = await getCachedMetadata(counter);
      pool.referenceSellCurrency = counterMeta ? { address: counter, ...counterMeta } : null;
      if (referenceAmount === null) {
        pool.referenceSell = { state: "unknown", reason: "reference pool did not produce a positive reportable buy quote" };
        return;
      }
      if (!counterMeta) {
        pool.referenceSell = { state: "unknown", reason: "this pool's counter-token decimals are unavailable" };
        return;
      }
      if (referenceAmount > (1n << 128n) - 1n) {
        pool.referenceSell = { state: "unknown", reason: "reference buy output exceeds V4 exact-input uint128 limit" };
        return;
      }
      try {
        const amountInHuman = `${formatUnits(referenceAmount, metadata?.decimals ?? 18)} ${metadata?.symbol ?? "target token"}`;
        const zeroForOne = pool.currency0.toLowerCase() === token;
        const [amountOut] = await client.simulateContract({
          address: quoter,
          abi: QUOTE_ABI,
          functionName: "quoteExactInputSingle",
          args: [{ poolKey: pool, zeroForOne, exactAmount: referenceAmount, hookData: "0x" }],
          blockNumber,
        }).then((result) => result.result);
        pool.referenceSell = {
          state: quoteStatus(amountOut),
          amountIn: referenceAmount.toString(),
          amountInHuman,
          amountOut: amountOut.toString(),
          amountOutHuman: formatUnits(amountOut, counterMeta.decimals),
        };
      } catch (error) {
        pool.referenceSell = {
          state: isTransientRpcError(error) ? "unknown" : "reverted",
          amountIn: referenceAmount.toString(),
          reason: isTransientRpcError(error) ? `RPC fault: ${decodeInnerHookError(error)}` : decodeInnerHookError(error),
        };
      }
    });
  }

  opts.onResult?.({ assessments, census: censusNote, censusComplete });

  // 1. Render ASCII Overview Table
  log("\n" + color.bold(color.cyan("■ UNISWAP V4 POOLS OVERVIEW TABLE:")));
  const colW = { idx: 3, id: 13, pair: 15, fee: 18, hook: 14, liq: 13, buy: 15, rec: 10, verdict: 20 };
  const borderTop = `┌${"─".repeat(colW.idx + 2)}┬${"─".repeat(colW.id + 2)}┬${"─".repeat(colW.pair + 2)}┬${"─".repeat(colW.fee + 2)}┬${"─".repeat(colW.hook + 2)}┬${"─".repeat(colW.liq + 2)}┬${"─".repeat(colW.buy + 2)}┬${"─".repeat(colW.rec + 2)}┬${"─".repeat(colW.verdict + 2)}┐`;
  const borderMid = `├${"─".repeat(colW.idx + 2)}┼${"─".repeat(colW.id + 2)}┼${"─".repeat(colW.pair + 2)}┼${"─".repeat(colW.fee + 2)}┼${"─".repeat(colW.hook + 2)}┼${"─".repeat(colW.liq + 2)}┼${"─".repeat(colW.buy + 2)}┼${"─".repeat(colW.rec + 2)}┼${"─".repeat(colW.verdict + 2)}┤`;
  const borderBot = `└${"─".repeat(colW.idx + 2)}┴${"─".repeat(colW.id + 2)}┴${"─".repeat(colW.pair + 2)}┴${"─".repeat(colW.fee + 2)}┴${"─".repeat(colW.hook + 2)}┴${"─".repeat(colW.liq + 2)}┴${"─".repeat(colW.buy + 2)}┴${"─".repeat(colW.rec + 2)}┴${"─".repeat(colW.verdict + 2)}┘`;

  log(color.dim(borderTop));
  log(
    `│ ${pad("#", colW.idx, "center")} │ ${pad("Pool ID", colW.id, "left")} │ ${pad("Pair", colW.pair, "left")} │ ${pad("Fee (pips)", colW.fee, "left")} │ ${pad("Hook", colW.hook, "left")} │ ${pad("Active L", colW.liq, "left")} │ ${pad("Buy Output", colW.buy, "left")} │ ${pad("Recovery", colW.rec, "right")} │ ${pad("Verdict", colW.verdict, "left")} │`,
  );
  log(color.dim(borderMid));

  for (let i = 0; i < assessments.length; i++) {
    const p = assessments[i];
    const idxStr = pad((i + 1).toString(), colW.idx, "center");
    const idStr = pad(shortHash(p.poolId), colW.id, "left");

    const pairRaw = `${p.currency0Symbol ?? "?"} / ${p.currency1Symbol ?? "?"}`;
    const pairStr = pad(pairRaw.length > colW.pair ? `${pairRaw.slice(0, colW.pair - 1)}…` : pairRaw, colW.pair, "left");

    const feeInfo = formatV4Fee(p.fee);
    const feeStr = pad(feeInfo.detailed.length > colW.fee ? feeInfo.short : feeInfo.detailed, colW.fee, "left");

    let hookCompact = "None";
    if (p.hooks.toLowerCase() !== ZERO) {
      const perms = formatHookPermissions(p.hook.permissions);
      hookCompact = perms.length > 0 ? `[${perms.join(",")}]` : "Hook (code)";
    }
    const hookStr = pad(hookCompact.length > colW.hook ? `${hookCompact.slice(0, colW.hook - 1)}…` : hookCompact, colW.hook, "left");

    const liqInfo = formatLiquidity(p.activeLiquidity ? BigInt(p.activeLiquidity) : null, p.liquidityError);
    const liqStr = pad(liqInfo.compact, colW.liq, "left");

    let buyOutStr = "(not run)";
    if (p.buy.state === "quoted") {
      const sym = metadata?.symbol ?? "";
      const numFormatted = formatHumanNumber(p.buy.amountOutHuman);
      const full = `${numFormatted} ${sym}`;
      buyOutStr = full.length > colW.buy ? `${numFormatted.slice(0, colW.buy - sym.length - 2)}… ${sym}` : full;
    } else if (p.buy.state === "reverted") {
      buyOutStr = color.red("Reverted");
    } else if (p.buy.state === "zero-output") {
      buyOutStr = color.red("0 out");
    }
    const buyStr = pad(buyOutStr, colW.buy, "left");

    let recStr = color.gray("N/A");
    if (p.roundTripRecoveryBps !== null) {
      const recPct = (Number(p.roundTripRecoveryBps) / 100).toFixed(2) + "%";
      if (Number(p.roundTripRecoveryBps) >= 5000) {
        recStr = color.green(recPct);
      } else if (Number(p.roundTripRecoveryBps) > 0) {
        recStr = color.yellow(recPct);
      } else {
        recStr = color.red(recPct);
      }
    }
    const recPadded = pad(recStr, colW.rec, "right");

    let verdictStr = "";
    if (p.evidence === "buy-only-quote-failure") {
      verdictStr = color.red("✖ HONEYPOT / BLOCKED");
    } else if (p.evidence === "asymmetric-quote-observation") {
      verdictStr = color.yellow("⚠ MISMATCH (UNCONF)");
    } else if (p.evidence === "sell-quote-returns-output") {
      if (roundTripLabel(p.roundTripRecoveryBps) === "NONZERO RETURN QUOTE") {
        verdictStr = color.green("✔ OK (HEALTHY)");
      } else {
        verdictStr = color.yellow("⚠ POOR RETURN");
      }
    } else if (p.evidence === "sell-quote-zero-output") {
      verdictStr = color.red("✖ ZERO OUTPUT");
    } else {
      if (p.activeLiquidity === "0") {
        verdictStr = color.gray("○ EMPTY (NO LIQ)");
      } else {
        verdictStr = color.yellow("? INCONCLUSIVE");
      }
    }
    const verdictPadded = pad(verdictStr, colW.verdict, "left");

    log(`│ ${idxStr} │ ${idStr} │ ${pairStr} │ ${feeStr} │ ${hookStr} │ ${liqStr} │ ${buyStr} │ ${recPadded} │ ${verdictPadded} │`);
  }
  log(color.dim(borderBot));

  // 2. Render Detailed Cards
  log("\n" + color.bold(color.cyan("■ DETAILED POOL OBSERVATIONS:")));
  log(color.dim("─".repeat(84)));

  for (let i = 0; i < assessments.length; i++) {
    const pool = assessments[i];
    const indexStr = `[${i + 1}/${assessments.length}]`;
    const feeInfo = formatV4Fee(pool.fee);
    const liqInfo = formatLiquidity(pool.activeLiquidity ? BigInt(pool.activeLiquidity) : null, pool.liquidityError);
    const hookPerms = formatHookPermissions(pool.hook.permissions);
    const recoveryPct = pool.roundTripRecoveryBps !== null ? (Number(pool.roundTripRecoveryBps) / 100).toFixed(2) + "%" : null;

    let statusFormatted = "";
    if (pool.evidence === "buy-only-quote-failure") {
      statusFormatted = color.red(color.bold("✖ BUY QUOTED / RETURN LEG REVERTS (POTENTIAL HONEYPOT)"));
    } else if (pool.evidence === "asymmetric-quote-observation") {
      statusFormatted = color.yellow(color.bold("⚠ DIRECTIONAL QUOTE MISMATCH; LIVE STATUS UNCONFIRMED"));
    } else if (pool.evidence === "sell-quote-returns-output") {
      if (roundTripLabel(pool.roundTripRecoveryBps) === "NONZERO RETURN QUOTE") {
        statusFormatted = color.green(color.bold(`✔ SELL QUOTE RETURNS OUTPUT (${recoveryPct} recovery)`));
      } else {
        statusFormatted = color.yellow(color.bold(`⚠ POOR RETURN / EXIT VALUE NOT ESTABLISHED (${recoveryPct} recovery)`));
      }
    } else if (pool.evidence === "sell-quote-zero-output") {
      statusFormatted = color.red(color.bold("✖ SELL QUOTE OUTPUT IS ZERO (100% LOSS)"));
    } else {
      if (pool.activeLiquidity === "0") {
        statusFormatted = color.gray("○ INCONCLUSIVE: EMPTY POOL (0 active liquidity)");
      } else {
        statusFormatted = color.yellow("? INCONCLUSIVE: probes could not establish quote");
      }
    }

    const c0Sym = pool.currency0Symbol ?? (pool.currency0.toLowerCase() === ZERO ? "ETH" : shortAddr(pool.currency0));
    const c1Sym = pool.currency1Symbol ?? (pool.currency1.toLowerCase() === ZERO ? "ETH" : shortAddr(pool.currency1));

    log(`\n${color.bold(color.cyan(`┌─ Pool ${indexStr}:`))} ${color.bold(pool.poolId)}`);
    log(`│ ${color.bold("Status:")}       ${statusFormatted}`);
    log(`│ ${color.bold("Pair:")}         ${color.bold(`${c0Sym} / ${c1Sym}`)}`);
    log(`│               ${color.dim("• currency0:")} ${pool.currency0} ${color.dim(`(${c0Sym})`)}`);
    log(`│               ${color.dim("• currency1:")} ${pool.currency1} ${color.dim(`(${c1Sym})`)}`);
    log(`│ ${color.bold("Fee & Tick:")}   ${feeInfo.detailed} ${color.dim(`| tickSpacing: ${pool.tickSpacing}`)}`);

    if (pool.hooks.toLowerCase() === ZERO) {
      log(`│ ${color.bold("Hook:")}         ${color.gray("None (hookless pool)")}`);
    } else {
      const permsStr = hookPerms.length > 0 ? color.yellow(`[${hookPerms.join(", ")}]`) : color.gray("[none]");
      log(`│ ${color.bold("Hook:")}         ${pool.hooks} ${color.dim(`(${pool.hook.state})`)}`);
      log(`│               ${color.bold("Permissions:")} ${permsStr}`);
      if (pool.hook.recognizedSelectors.length > 0) {
        log(`│               ${color.bold("Selector Hints:")} ${color.yellow(pool.hook.recognizedSelectors.map((s) => s.name).join(", "))} ${color.dim("(informational only)")}`);
      }
    }

    log(`│ ${color.bold("Active L:")}     ${liqInfo.detailed}`);

    if (pool.buy.state === "not-run") {
      log(`│ ${color.bold("Quotes:")}       ${color.gray("Not run (empty pool with 0 active liquidity)")}`);
    } else {
      if (pool.buy.state === "quoted") {
        const inFormatted = formatHumanNumber(pool.buy.amountInHuman?.split(" ")[0]) + " " + (pool.buy.amountInHuman?.split(" ")[1] ?? "");
        const outFormatted = formatHumanNumber(pool.buy.amountOutHuman) + " " + (metadata?.symbol ?? "target");
        log(`│ ${color.bold("Buy Probe:")}    ${inFormatted}  ${color.cyan("──>")}  ${color.bold(outFormatted)}`);
      } else {
        log(`│ ${color.bold("Buy Probe:")}    ${color.red(pool.buy.state)}${pool.buy.reason ? ` (${pool.buy.reason})` : ""}`);
      }

      if (pool.sell.state === "quoted") {
        const inFormatted = formatHumanNumber(pool.sell.amountInHuman?.split(" ")[0]) + " " + (pool.sell.amountInHuman?.split(" ")[1] ?? "");
        const outFormatted = formatHumanNumber(pool.sell.amountOutHuman) + " " + (pool.buy.amountInHuman?.split(" ")[1] ?? "");
        const recFormatted = recoveryPct ? ` (${recoveryPct} recovery)` : "";
        log(`│ ${color.bold("Return Sell:")}  ${inFormatted}  ${color.cyan("──>")}  ${color.bold(outFormatted)}${recoveryPct ? (Number(pool.roundTripRecoveryBps) >= 5000 ? color.green(recFormatted) : color.yellow(recFormatted)) : ""}`);
      } else if (pool.sell.state === "zero-output") {
        const inFormatted = formatHumanNumber(pool.sell.amountInHuman?.split(" ")[0]) + " " + (pool.sell.amountInHuman?.split(" ")[1] ?? "");
        const counterUnit = pool.buy.amountInHuman?.split(" ")[1] ?? "";
        log(`│ ${color.bold("Return Sell:")}  ${inFormatted}  ${color.cyan("──>")}  ${color.red(`0 ${counterUnit}`.trim())} ${color.red("(0.00% recovery — ZERO OUTPUT)")}`);
      } else if (pool.sell.state === "reverted") {

        log(`│ ${color.bold("Return Sell:")}  ${color.red(color.bold("REVERTED"))}${pool.sell.reason ? `: ${color.red(pool.sell.reason)}` : ""}`);
      } else {
        log(`│ ${color.bold("Return Sell:")}  ${color.gray(pool.sell.state)}${pool.sell.reason ? ` (${pool.sell.reason})` : ""}`);
      }
    }

    if (pool.referenceSell) {
      const counterAddress = pool.currency0.toLowerCase() === token ? pool.currency1 : pool.currency0;
      const counterSym = pool.referenceSellCurrency ? pool.referenceSellCurrency.symbol : shortAddr(counterAddress);
      if (pool.referenceSell.state === "quoted") {
        const inFormatted = formatHumanNumber(pool.referenceSell.amountInHuman?.split(" ")[0]) + " " + (metadata?.symbol ?? "target");
        const outFormatted = formatHumanNumber(pool.referenceSell.amountOutHuman) + " " + counterSym;
        log(`│ ${color.bold("Ref-Amount Sell:")} ${inFormatted}  ${color.cyan("──>")}  ${outFormatted}`);
      } else {
        log(`│ ${color.bold("Ref-Amount Sell:")} ${pool.referenceSell.state}${pool.referenceSell.reason ? ` (${pool.referenceSell.reason})` : ""}`);
      }
    }

    log(`└${"─".repeat(82)}`);
  }

  // 3. Render Executive Verdict & Summary
  const blocked = assessments.filter((pool) => pool.evidence === "buy-only-quote-failure");
  const unconfirmedDirectional = assessments.filter((pool) => pool.evidence === "asymmetric-quote-observation");
  const positiveReturnQuotes = assessments.filter((pool) => pool.evidence === "sell-quote-returns-output");
  const adequateRecoveryQuotes = positiveReturnQuotes.filter((pool) => roundTripLabel(pool.roundTripRecoveryBps) === "NONZERO RETURN QUOTE");
  const poorRecoveryQuotes = positiveReturnQuotes.length - adequateRecoveryQuotes.length;
  const zeroOutputQuotes = assessments.filter((pool) => pool.evidence === "sell-quote-zero-output");
  const emptyPools = assessments.filter((pool) => pool.activeLiquidity === "0");

  log("\n" + color.bold("═".repeat(84)));
  log(color.bold(color.cyan("                             EXECUTIVE VERDICT & SUMMARY                            ")));
  log(color.bold("═".repeat(84)));
  log(`  Total Pools Census:         ${color.bold(assessments.length.toString())}`);
  log(`  ✔ Healthy Exit Quotes:      ${adequateRecoveryQuotes.length > 0 ? color.green(color.bold(`${adequateRecoveryQuotes.length} pool(s) (>= 50% round-trip recovery)`)) : "0"}`);
  log(`  ⚠ High Fee / Poor Recovery: ${poorRecoveryQuotes > 0 ? color.yellow(`${poorRecoveryQuotes} pool(s) (< 50% recovery due to high pool swap fees)`) : "0"}`);
  log(`  ✖ Zero Output Sells:        ${zeroOutputQuotes.length > 0 ? color.red(color.bold(`${zeroOutputQuotes.length} pool(s) (100% loss)`)) : "0"}`);
  log(`  ○ Empty / Dormant Pools:    ${emptyPools.length > 0 ? color.gray(`${emptyPools.length} pool(s) (0 active liquidity)`) : "0"}`);
  log(`  ✖ Asymmetric Honeypots:     ${blocked.length > 0 ? color.red(color.bold(`${blocked.length} pool(s) (buy succeeds, sell reverts)`)) : "0"}`);
  log(color.dim("─".repeat(84)));

  if (blocked.length || unconfirmedDirectional.length) {
    log(color.red(color.bold(`\nALERT: ${blocked.length} live asymmetric pool(s), ${unconfirmedDirectional.length} unconfirmed directional mismatch(es), ${adequateRecoveryQuotes.length} same-pool quote(s) recover at least 50%, ${poorRecoveryQuotes} return less than 50% or lack a comparable recovery measurement.`)));
    log(color.yellow(`Low recovery is labeled POOR RETURN / EXIT VALUE NOT ESTABLISHED. The ${requestedBuyAmount ? `requested ${requestedBuyAmount}` : "default 0.001"} counter-token probe is small; material trade-size behavior and the economic primary pool remain unresolved. These per-pool Quoter observations are not a security verdict or proof a fresh wallet can or cannot transfer-sell. Reference-pool outputs remain unranked across counter assets.`));
    return 2;
  }


  if (assessments.some((pool) => pool.evidence === "inconclusive")) {
    const inconclusivePools = assessments.filter((pool) => pool.evidence === "inconclusive");
    const reasons = inconclusivePools.map((p) => {
      if (p.activeLiquidity === "0") return `${shortHash(p.poolId)} (0 liquidity)`;
      if (p.liquidityRead === "failed") return `${shortHash(p.poolId)} (L read failed)`;
      return `${shortHash(p.poolId)} (probe incomplete)`;
    }).join(", ");
    log(color.yellow(color.bold("\nINCONCLUSIVE: one or more pool reads or probes did not establish a positive sell quote.")));
    log(color.dim(`  Inconclusive pool(s): ${reasons}`));
    if (poorRecoveryQuotes > 0) {
      log(color.yellow(`  Note: ${poorRecoveryQuotes} pool(s) had poor recovery (< 50%) due to high creator-set swap fees (79% – 88%).`));
    }

    if (adequateRecoveryQuotes.length > 0) {
      log(color.green(`Note: ${adequateRecoveryQuotes.length} other pool(s) provided healthy positive sell quotes (e.g. up to ${Math.max(...adequateRecoveryQuotes.map(p => Number(p.roundTripRecoveryBps) / 100)).toFixed(2)}% recovery).`));
    }
    return 1;

  }

  log(color.green(color.bold("\nNo buy-only quote failure found in the completed pool census. This does not establish that real wallet transfers can sell.")));
  return 0;
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }).catch((error: unknown) => {
    console.error(`Probe failed: ${asErrorText(error).slice(0, 240)}`);
    process.exitCode = 1;
  });
}
