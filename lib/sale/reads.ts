import type { Abi, Address, Chain, PublicClient } from "viem";
import { createPublicClient, http } from "viem";
import { isTransientRpcError } from "@/lib/rpc/fault";
import { erc20MetaAbi, tokenSaleAbi } from "./abi";

/**
 * The single contract-read path for every TokenSale surface (admin cockpit and
 * the public /token-sale page), shared by the two transports: the browser's
 * viem multicall and the server's `batchRead` through the provider pool.
 * Forking these reads a second time is how the two pages drift into
 * disagreeing about what state the sale is in.
 *
 * The `faults` list is the point: a field that could not be read is `undefined`
 * AND named, so callers render "—" rather than a coerced zero (§4 — an empty
 * result is not a fact; a dead RPC must never be able to publish "no
 * contributions").
 */

export interface SaleView {
  state?: number;
  token?: Address;
  tokensForSale?: bigint;
  totalRaised?: bigint;
  contributorCount?: bigint;
  owner?: Address;
  feeAddress1?: Address;
  feeAddress2?: Address;
  feeAddress3?: Address;
  feeAddress1Bps?: number;
  feeAddress2Bps?: number;
  feeAddress3Bps?: number;
  /** Owner-side lifecycle flags. `withdrawProceeds` reverts on a second call,
   *  and `distribute` is a cursor — both gate admin buttons. */
  proceedsWithdrawn?: boolean;
  /** Admission rules, READ from the contract — never a UI literal. A form that
   *  hardcodes them disagrees with the chain the moment either constant moves,
   *  and the disagreement surfaces as an unexplained revert (§8 #11). */
  minInitialContribution?: bigint;
  contributionStep?: bigint;
  distributionCursor?: bigint;
  distributionComplete?: boolean;
  /** Fee legs the owner has switched off. Keyed 1/2/3. */
  feeDisabled1?: boolean;
  feeDisabled2?: boolean;
  feeDisabled3?: boolean;
  referralBps?: number;
  /** Zero address means the scoop goes to `owner()`, which is a valid configuration. */
  referralPotRecipient?: Address;
  /** When `close()` ran. Zero until then; the burn clock starts here. */
  closedAt?: bigint;
  unclaimedBurned?: boolean;
  burnDelay?: bigint;
  totalStray?: bigint;
  straySwept?: boolean;
  /** Ownable2Step. Non-zero means an ownership rotation is half-finished — a
   *  fact the owner surface must show even though it never drives one. */
  pendingOwner?: Address;
  /** The sale token the contract actually holds. `start()` demands this equal
   *  `tokensForSale` EXACTLY, and over is unrecoverable, so this is the number
   *  the funding step is judged on — not a decoration. */
  saleTokenBalance?: bigint;
  mine?: {
    contributed?: bigint;
    claimed?: boolean;
    refunded?: boolean;
    allocation?: bigint;
    stray?: bigint;
  };
  tokenMeta?: { name?: string; symbol?: string; decimals?: number };
  /** Read labels that FAULTED this pass. */
  faults: string[];
}

/** Server-rendered reads handed to the client before its own poll answers. */
export interface SaleSnapshot {
  view: SaleView;
  /** Chain block the reads were pinned to; null when that read faulted. */
  blockNumber: bigint | null;
  /** Server clock when the snapshot was taken (ms epoch). */
  takenAt: number;
}

export interface SaleCall {
  label: string;
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
}

export type ReadOutcome = { ok: true; value: unknown } | { ok: false };

/**
 * One round of reads: exactly one outcome per input call, in input order —
 * view fields are assigned BY INDEX, so a short or reordered array would
 * misattribute values rather than throw. Both transports guarantee this
 * (viem's allowFailure result is 1:1; batchRead asserts length and falls back).
 */
export type ReadMany = (calls: readonly SaleCall[]) => Promise<ReadOutcome[]>;

function baseCalls(addr: Address, wallet: Address | null): SaleCall[] {
  const calls: SaleCall[] = [
    { label: "state", address: addr, abi: tokenSaleAbi, functionName: "state" },
    { label: "token", address: addr, abi: tokenSaleAbi, functionName: "token" },
    { label: "tokensForSale", address: addr, abi: tokenSaleAbi, functionName: "tokensForSale" },
    { label: "totalRaised", address: addr, abi: tokenSaleAbi, functionName: "totalRaised" },
    { label: "contributorCount", address: addr, abi: tokenSaleAbi, functionName: "contributorCount" },
    { label: "owner", address: addr, abi: tokenSaleAbi, functionName: "owner" },
    { label: "feeAddress1", address: addr, abi: tokenSaleAbi, functionName: "feeAddress1" },
    { label: "feeAddress2", address: addr, abi: tokenSaleAbi, functionName: "feeAddress2" },
    { label: "feeAddress3", address: addr, abi: tokenSaleAbi, functionName: "feeAddress3" },
    { label: "feeAddress1Bps", address: addr, abi: tokenSaleAbi, functionName: "feeAddress1Bps" },
    { label: "feeAddress2Bps", address: addr, abi: tokenSaleAbi, functionName: "feeAddress2Bps" },
    { label: "feeAddress3Bps", address: addr, abi: tokenSaleAbi, functionName: "feeAddress3Bps" },
    { label: "proceedsWithdrawn", address: addr, abi: tokenSaleAbi, functionName: "proceedsWithdrawn" },
    { label: "minInitialContribution", address: addr, abi: tokenSaleAbi, functionName: "minInitialContribution" },
    { label: "contributionStep", address: addr, abi: tokenSaleAbi, functionName: "contributionStep" },
    { label: "distributionCursor", address: addr, abi: tokenSaleAbi, functionName: "distributionCursor" },
    { label: "distributionComplete", address: addr, abi: tokenSaleAbi, functionName: "distributionComplete" },
    { label: "feeDisabled1", address: addr, abi: tokenSaleAbi, functionName: "feeDisabled", args: [1] },
    { label: "feeDisabled2", address: addr, abi: tokenSaleAbi, functionName: "feeDisabled", args: [2] },
    { label: "feeDisabled3", address: addr, abi: tokenSaleAbi, functionName: "feeDisabled", args: [3] },
    { label: "referralBps", address: addr, abi: tokenSaleAbi, functionName: "referralBps" },
    { label: "referralPotRecipient", address: addr, abi: tokenSaleAbi, functionName: "referralPotRecipient" },
    { label: "closedAt", address: addr, abi: tokenSaleAbi, functionName: "closedAt" },
    { label: "unclaimedBurned", address: addr, abi: tokenSaleAbi, functionName: "unclaimedBurned" },
    { label: "burnDelay", address: addr, abi: tokenSaleAbi, functionName: "BURN_DELAY" },
    { label: "totalStray", address: addr, abi: tokenSaleAbi, functionName: "totalStray" },
    { label: "straySwept", address: addr, abi: tokenSaleAbi, functionName: "straySwept" },
    { label: "pendingOwner", address: addr, abi: tokenSaleAbi, functionName: "pendingOwner" },
  ];
  if (wallet) {
    calls.push(
      { label: "contributed", address: addr, abi: tokenSaleAbi, functionName: "contributed", args: [wallet] },
      { label: "claimed", address: addr, abi: tokenSaleAbi, functionName: "claimed", args: [wallet] },
      { label: "refunded", address: addr, abi: tokenSaleAbi, functionName: "refunded", args: [wallet] },
      { label: "allocationOf", address: addr, abi: tokenSaleAbi, functionName: "allocationOf", args: [wallet] },
      { label: "strayOf", address: addr, abi: tokenSaleAbi, functionName: "strayOf", args: [wallet] },
    );
  }
  return calls;
}

function tokenCalls(token: Address, sale: Address): SaleCall[] {
  return [
    { label: "token.balanceOf", address: token, abi: erc20MetaAbi, functionName: "balanceOf", args: [sale] },
    { label: "token.name", address: token, abi: erc20MetaAbi, functionName: "name" },
    { label: "token.symbol", address: token, abi: erc20MetaAbi, functionName: "symbol" },
    { label: "token.decimals", address: token, abi: erc20MetaAbi, functionName: "decimals" },
  ];
}

/**
 * Two rounds — the token-dependent reads need `token` out of the first. When
 * `token` faulted, the token.* fields go undefined WITHOUT four extra fault
 * labels: they would all restate the one fault already named (and "token
 * faulted" must not read as "the token has no name").
 */
export async function buildSaleView(
  readMany: ReadMany,
  addr: Address,
  wallet: Address | null,
): Promise<SaleView> {
  const faults: string[] = [];
  const view: SaleView = { faults };

  const calls1 = baseCalls(addr, wallet);
  const round1 = await readMany(calls1);
  let i = 0;
  const take = <T>(): T | undefined => {
    const idx = i++;
    const r = round1[idx];
    if (r?.ok) return r.value as T;
    faults.push(calls1[idx].label);
    return undefined;
  };

  view.state = take<number>();
  view.token = take<Address>();
  view.tokensForSale = take<bigint>();
  view.totalRaised = take<bigint>();
  view.contributorCount = take<bigint>();
  view.owner = take<Address>();
  view.feeAddress1 = take<Address>();
  view.feeAddress2 = take<Address>();
  view.feeAddress3 = take<Address>();
  view.feeAddress1Bps = take<number>();
  view.feeAddress2Bps = take<number>();
  view.feeAddress3Bps = take<number>();
  view.proceedsWithdrawn = take<boolean>();
  view.minInitialContribution = take<bigint>();
  view.contributionStep = take<bigint>();
  view.distributionCursor = take<bigint>();
  view.distributionComplete = take<boolean>();
  // Order below MUST mirror baseCalls exactly — `take` walks the result array
  // by index, so a call added in one place and not the other misattributes
  // every field after it rather than throwing.
  view.feeDisabled1 = take<boolean>();
  view.feeDisabled2 = take<boolean>();
  view.feeDisabled3 = take<boolean>();
  view.referralBps = take<number>();
  view.referralPotRecipient = take<Address>();
  view.closedAt = take<bigint>();
  view.unclaimedBurned = take<boolean>();
  view.burnDelay = take<bigint>();
  view.totalStray = take<bigint>();
  view.straySwept = take<boolean>();
  view.pendingOwner = take<Address>();
  if (wallet) {
    view.mine = {
      contributed: take<bigint>(),
      claimed: take<boolean>(),
      refunded: take<boolean>(),
      allocation: take<bigint>(),
      stray: take<bigint>(),
    };
  }

  const token = view.token;
  if (token) {
    const calls2 = tokenCalls(token, addr);
    const round2 = await readMany(calls2);
    let j = 0;
    const take2 = <T>(): T | undefined => {
      const idx = j++;
      const r = round2[idx];
      if (r?.ok) return r.value as T;
      faults.push(calls2[idx].label);
      return undefined;
    };
    view.saleTokenBalance = take2<bigint>();
    view.tokenMeta = {
      name: take2<string>(),
      symbol: take2<string>(),
      decimals: take2<number>(),
    };
  }

  return view;
}

export function makeReadMany(
  client: Pick<PublicClient, "multicall" | "readContract">,
): ReadMany {
  return async (calls) => {
    if (calls.length === 0) return [];
    try {
      // `allowFailure: true` is mandatory: it returns per-call results, which is
      // what keeps the faults list alive. A reverting subcall must not void the
      // batch (lib/rpc/multicall.ts rule 1).
      const results = (await client.multicall({
        contracts: calls.map((c) => ({
          address: c.address,
          abi: c.abi,
          functionName: c.functionName,
          args: c.args,
        })),
        allowFailure: true,
        batchSize: 0,
        // The cast is on the RESULT, not the payload: viem infers the return
        // type from a const-typed contracts tuple, which a runtime-built array
        // cannot satisfy (same precedent as lib/rpc/multicall.ts).
      })) as ReadonlyArray<{ status: "success"; result: unknown } | { status: "failure" }>;
      return results.map((r) => (r.status === "success" ? { ok: true as const, value: r.result } : { ok: false as const }));
    } catch (error) {
      if (!isMulticallUnsupported(error) && isTransientRpcError(error)) throw error;
      return perCallReadMany(client)(calls);
    }
  };
}

/** Last resort for chains without Multicall3: one read per call, old behavior. */
function perCallReadMany(client: Pick<PublicClient, "readContract">): ReadMany {
  return async (calls) =>
    Promise.all(
      calls.map(async (c) => {
        try {
          const value = await client.readContract({
            address: c.address,
            abi: c.abi,
            functionName: c.functionName,
            args: c.args,
          } as never);
          return { ok: true as const, value };
        } catch {
          return { ok: false as const };
        }
      }),
    );
}

/** viem refuses the batch when the chain carries no `contracts.multicall3`.
 *  A configuration fact, never a transport fault — it must degrade, not throw. */
const isMulticallUnsupported = (error: unknown): boolean =>
  error instanceof Error && error.name === "ChainDoesNotSupportContract";

/**
 * Browser path — ONE multicall. Being one network event means a transport
 * failure blanks the whole batch rather than yielding partial data; the caller
 * keeps the last snapshot and labels it, and the copy says "couldn't reach the
 * chain", never sixteen individual faults.
 */
export async function fetchSaleViewLive(
  client: Pick<PublicClient, "multicall" | "readContract">,
  addr: Address,
  wallet: Address | null,
): Promise<SaleView> {
  return buildSaleView(makeReadMany(client), addr, wallet);
}

/** `call` is in the pick because the admin panel preflights every write through
 *  this same client (lib/sale/preflight.ts) — one client, one view of the chain. */
export function makeSaleClient(chain: Chain): Pick<PublicClient, "multicall" | "readContract" | "waitForTransactionReceipt" | "call"> {
  return createPublicClient({ chain, transport: http() });
}

/**
 * The honest contribution quote: your tokens and your share of the pool IF the
 * sale closed at this instant, mirroring `allocationOf`'s one-line math
 * (`TOKENS_FOR_SALE * contributed / totalRaised`, multiply before divide —
 * contracts/README.md §TokenSale). At `v = 0n` this reduces exactly to
 * `allocationOf(contributed)`; denom-0 is answered null ("unknown"), never a
 * division. Tests live in tests/sale-abi-and-quote.test.ts.
 */
export function allocationQuote(opts: {
  extra: bigint;
  contributed: bigint;
  totalRaised: bigint;
  tokensForSale: bigint;
}): { shareBps: bigint; tokens: bigint } | null {
  const denom = opts.totalRaised + opts.extra;
  if (denom === 0n) return null;
  const held = opts.contributed + opts.extra;
  return {
    shareBps: (held * 10_000n) / denom,
    tokens: (opts.tokensForSale * held) / denom,
  };
}

/**
 * Where the funding stands against what `start()` demands.
 *
 * `start()` requires the held balance to equal `tokensForSale` EXACTLY, and the
 * two failures are not symmetric: short is a top-up away from fixed, over is
 * terminal. `recoverERC20` refuses the sale token, `withdrawUnsoldTokens` is
 * unreachable from Pending, and the documented remedy — abandon() then
 * withdraw — leaves the sale in a state it can never open from. So an
 * overfunded contract is a redeploy, and the operator has to learn that BEFORE
 * they send tokens, not from a reverted start().
 *
 * "unknown" is its own state and never collapses into "short": an unread
 * balance must not render as a funding gap (§4).
 */
export type FundingStatus =
  | { state: "unknown" }
  | { state: "short"; held: bigint; required: bigint; missing: bigint }
  | { state: "exact"; held: bigint; required: bigint }
  | { state: "over"; held: bigint; required: bigint; excess: bigint };

export function fundingStatus(view: Pick<SaleView, "saleTokenBalance" | "tokensForSale">): FundingStatus {
  const held = view.saleTokenBalance;
  const required = view.tokensForSale;
  if (held === undefined || required === undefined) return { state: "unknown" };
  if (held < required) return { state: "short", held, required, missing: required - held };
  if (held > required) return { state: "over", held, required, excess: held - required };
  return { state: "exact", held, required };
}
