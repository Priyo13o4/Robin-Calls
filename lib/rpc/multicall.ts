import type { Abi } from "viem";
import type { PublicClient } from "viem";
import { rpc } from "./client";
import { addresses, isAddressConfigured } from "../config/chain";
import { isTransientRpcError } from "./fault";
import {
  recordBatchedSubcalls,
  recordMulticallBatch,
  recordMulticallFallback,
} from "../observability/context";

/**
 * Multicall3 batching for compatible view reads (implementation-plan
 * "Performance Optimization Order" step 3).
 *
 * The measured shape this exists for: a cold scan issues ~15 separate
 * `eth_call`s for ERC-20 metadata + V2 identity + LP balances, 32 for V4
 * StateView liquidity ranking, and up to 166 for V4 position ownership. Each
 * one is a billed provider call, and burst rate — not the monthly allowance —
 * is the launch constraint. Batching collapses each of those groups into one
 * physical `eth_call`.
 *
 * Four rules this module exists to enforce, all of them load-bearing:
 *
 * 1. **`allowFailure: true`, always.** One reverting subcall must not void the
 *    batch. The V4 ownership read specifically expects failures (burned//moved
 *    positions) and its 155-success/11-failure split is *evidence*, not noise.
 * 2. **A reverted subcall and a faulted batch are different facts.** A batch
 *    that throws never reached the chain, so every result is UNKNOWN. A subcall
 *    that returns `success: false` is classified `reverted`, but that is a
 *    DEFAULT, not a proof — see the mapping below (L99). This module never
 *    collapses the two — that is the §4 rule the honeypot path already learned
 *    the hard way.
 * 3. **One logical call per subcall.** Observability budgets (`rpcLogicalCalls`,
 *    `rpcCallBudget`) count the questions we asked, not the envelopes we sent.
 *    Batching must reduce physical attempts and CU spend without silently
 *    making the scan look cheaper than the work it did.
 * 4. **Degrade to individual calls.** Multicall3 is not deployed on every
 *    chain, and it is not verified on Robinhood Chain by assumption — the
 *    address is env-driven and probed for bytecode once per process. Missing
 *    or unprobeable means fall back, never means "the reads failed".
 */

/*
 * No local aggregate3 ABI: viem's `multicall` action encodes and decodes the
 * aggregate3 envelope itself, given only the address. A hand-rolled copy here
 * would be a second definition of the same contract with nothing keeping the
 * two in agreement.
 */

/**
 * Chunk bound. Multicall3 has no protocol limit, but providers cap response
 * size and a single oversized `eth_call` can exceed the node's gas ceiling —
 * which fails the WHOLE batch, including subcalls that would have succeeded.
 * 60 keeps the V4 ownership fan-out (166 reads) at three physical calls while
 * staying well inside typical limits.
 */
const MAX_CHUNK = 60;

export interface BatchCall {
  address: `0x${string}`;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
}

export type BatchResult<T = unknown> =
  | { status: "success"; value: T }
  /** The chain executed this call and it reverted — a real answer. */
  | { status: "reverted" }
  /**
   * We never got an answer: the batch (or the individual fallback) faulted.
   * `cause: "deadline"` = our own RPC_SCAN_DEADLINE_MS refused it, not a provider.
   */
  | { status: "faulted"; cause?: "deadline" };

let availability: Promise<`0x${string}` | null> | null = null;
let availabilityByClient = new WeakMap<object, Promise<`0x${string}` | null>>();

/**
 * Resolve the Multicall3 address once per process, verifying bytecode exists.
 *
 * A configured-but-undeployed address is exactly the trap `validateDexConfig`
 * was written for: the canonical 0xcA11...CA11 deployment is present on most
 * chains, which makes it tempting to hardcode, and a syntactically valid
 * address with no code would turn every batched read into a revert.
 */
export function multicallAddress(client?: PublicClient): Promise<`0x${string}` | null> {
  if (!client && availability) return availability;
  const targetClient = client ?? rpc();
  const cached = client ? availabilityByClient.get(client) : null;
  if (cached) return cached;
  const probe = (async () => {
    const configured = addresses.multicall3;
    if (!isAddressConfigured(configured)) return null;
    try {
      const code = await targetClient.getCode({ address: configured as `0x${string}` });
      if (!code || code === "0x") return null;
      return configured as `0x${string}`;
    } catch {
      // Unprobeable at startup — fall back to individual calls rather than
      // failing reads. Not memoized as a permanent "no": clear and re-probe.
      if (client) availabilityByClient.delete(client);
      else availability = null;
      return null;
    }
  })();
  if (client) availabilityByClient.set(client, probe);
  else availability = probe;
  return probe;
}

/** Test seam — resets the memoized availability probe. */
export function _resetMulticallAvailability(): void {
  availability = null;
  availabilityByClient = new WeakMap();
}

/**
 * Test seam for the single-read path (defaults to the real client, and must
 * never be set in production — same convention as `_mockWrite`/`_mockVerdict`).
 *
 * It exists because every consumer of `batchRead` — V4 owner attribution, V3
 * position pairing, the discovery offset split — maps results back onto inputs
 * by INDEX. That mapping is only sound if this module returns exactly one
 * result per input in input order, in every path including the fallback, and a
 * violation would misattribute one wallet's liquidity to another rather than
 * throwing. Untestable without a seam, and far too load-bearing to leave so.
 */
type SingleReader = (call: BatchCall, blockNumber?: bigint) => Promise<unknown>;
let readerOverride: SingleReader | null = null;

export function _mockSingleReader(reader: SingleReader | null): void {
  readerOverride = reader;
}

/**
 * Read many contracts in as few physical calls as possible.
 *
 * Returns one result per input call, in input order, always — a short or
 * reordered result array would silently misattribute values to the wrong
 * pool/token, so length is asserted rather than trusted.
 */
export async function batchRead<T = unknown>(
  calls: readonly BatchCall[],
  opts: { blockNumber?: bigint; forceIndividual?: boolean; client?: PublicClient } = {},
): Promise<BatchResult<T>[]> {
  if (calls.length === 0) return [];

  // L99. `readIndividually` is the only path that runs `isTransientRpcError`, so
  // re-asking a batched failure must be able to demand it — a plain re-call
  // re-batches and reproduces the phantom revert. Deliberately not counted as a
  // fallback: that counter means "Multicall was unavailable" and is the
  // telemetry that diagnosed L99.
  if (opts.forceIndividual) return readIndividually<T>(calls, opts);

  const client = opts.client ?? rpc();
  const target = await multicallAddress(opts.client);
  if (!target) {
    recordMulticallFallback();
    return readIndividually<T>(calls, opts);
  }

  const out: BatchResult<T>[] = [];

  for (let i = 0; i < calls.length; i += MAX_CHUNK) {
    const chunk = calls.slice(i, i + MAX_CHUNK);
    try {
      // The cast is on the RESULT, not the payload: viem's `multicall` return
      // type is inferred from a const-typed contracts tuple, which a
      // runtime-built array cannot satisfy. Casting the argument instead would
      // erase the return type into `never` and lose the success/failure
      // discriminant this whole module is built on.
      const results = (await client.multicall({
        contracts: chunk.map((c) => ({
          address: c.address,
          abi: c.abi,
          functionName: c.functionName,
          args: c.args,
        })),
        allowFailure: true,
        multicallAddress: target,
        // Disable viem's OWN calldata-size splitting (default 1024 bytes). We
        // already chunk at MAX_CHUNK, and a hidden second split breaks the
        // accounting contract below: `recordBatchedSubcalls` charges
        // `chunk.length - 1` on the assumption that the chunk cost exactly one
        // transport attempt, but each envelope viem sends records its own
        // logical call too. Measured on chain 4663: a 15-call chunk went out as
        // two envelopes and booked 16 logical calls for 15 questions. The error
        // is small and in the safe direction, but it makes `rpcLogicalCalls`
        // drift from the truth, and this counter gates the scan budget.
        batchSize: 0,
        ...(opts.blockNumber !== undefined ? { blockNumber: opts.blockNumber } : {}),
      })) as ReadonlyArray<
        { status: "success"; result: unknown } | { status: "failure"; error: unknown }
      >;

      if (results.length !== chunk.length) {
        // Never map a short array positionally — a value landing on the wrong
        // pool is worse than no value. Fall back for this chunk.
        recordMulticallFallback();
        out.push(...(await readIndividually<T>(chunk, opts)));
        continue;
      }

      // With allowFailure, viem turns a REJECTED envelope into one shared error on every slot instead of
      // throwing (viem multicall.js), so the catch below never sees it. Real subcall failures each get
      // their own error object. A shared one means nothing was answered: classify call by call.
      const shared = results[0]?.status === "failure" ? results[0].error : undefined;
      if (shared !== undefined && results.every((r) => r.status === "failure" && r.error === shared)) {
        recordMulticallFallback();
        out.push(...(await readIndividually<T>(chunk, opts)));
        continue;
      }

      // Rule 3: the batch landed, so every subcall in it is a question we
      // actually asked. Charge them to the scan's logical-call budget even
      // though one physical attempt carried them.
      recordBatchedSubcalls(chunk.length);

      let failures = 0;
      for (const r of results) {
        if (r.status === "success") {
          out.push({ status: "success", value: r.result as T });
        } else {
          // L99: a default, NOT proof of a revert. aggregate3 reports revert,
          // out-of-gas and decode failure identically, and the outcome tracks
          // which provider served the envelope (5.6% of subcalls "fail"
          // chain-wide). Kept because every consumer depends on the shape; a
          // caller feeding a verdict must re-ask with `forceIndividual`.
          out.push({ status: "reverted" });
          failures++;
        }
      }
      recordMulticallBatch(chunk.length, failures);
    } catch {
      // The whole batch never landed, so every subcall in it is UNKNOWN — not
      // reverted. Retry the chunk individually rather than inferring anything:
      // a gas ceiling or one bad target must not blank reads that would have
      // succeeded on their own, and the per-call path classifies each outcome
      // properly. Deliberately not branching on isTransientRpcError here — a
      // batch-level revert tells us nothing about which subcall caused it.
      recordMulticallFallback();
      out.push(...(await readIndividually<T>(chunk, opts)));
    }
  }

  return out;
}

/**
 * Fallback path — one `eth_call` per read, same result shape.
 *
 * Bounded concurrency on purpose: this runs precisely when Multicall is
 * unavailable, which often means the provider is already unhappy. Firing 166
 * parallel reads at it is how the earlier 25-way probe burst rate-limited
 * itself into false labels.
 */
async function readIndividually<T>(
  calls: readonly BatchCall[],
  opts: { blockNumber?: bigint; client?: PublicClient },
): Promise<BatchResult<T>[]> {
  // Not hoisted: with the reader seam set there is no transport to construct,
  // and building one would make this path depend on RPC config it never uses.
  const client = readerOverride ? null : opts.client ?? rpc();
  const out: BatchResult<T>[] = new Array(calls.length);
  const CONCURRENCY = 6;

  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < calls.length) {
      const index = cursor++;
      const c = calls[index];
      try {
        const value = readerOverride
          ? await readerOverride(c, opts.blockNumber)
          : await client!.readContract({
              address: c.address,
              abi: c.abi,
              functionName: c.functionName,
              args: c.args,
              ...(opts.blockNumber !== undefined ? { blockNumber: opts.blockNumber } : {}),
            } as never);
        out[index] = { status: "success", value: value as T };
      } catch (error) {
        out[index] = isTransientRpcError(error)
          ? isScanDeadlineError(error)
            ? { status: "faulted", cause: "deadline" }
            : { status: "faulted" }
          : { status: "reverted" };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, calls.length) }, worker));
  return out;
}

/**
 * Convenience: success value or null, for reads where a revert is a real "no".
 *
 * Takes the erased `BatchResult<unknown>` and narrows at the call site, because
 * a heterogeneous batch (name:string, decimals:number, totalSupply:bigint)
 * cannot carry one useful `T` across the whole array.
 *
 * Callers that must distinguish "reverted" from "never asked" — anything whose
 * answer feeds a verdict — should read `result.status` directly rather than
 * using this helper, which flattens both to null (§4).
 */
export function valueOrNull<T>(result: BatchResult<unknown> | undefined): T | null {
  return result?.status === "success" ? (result.value as T) : null;
}

/** The provider pool's own scan-deadline refusal (lib/rpc/provider-pool.ts), found anywhere in viem's cause chain. */
export function isScanDeadlineError(error: unknown): boolean {
  let e: unknown = error;
  for (let depth = 0; e && depth < 8; depth++) {
    if (e instanceof Error && /scan deadline exhausted/.test(e.message)) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}

/** True when the read never reached the chain — callers must not score this. */
export function isFaulted(result: BatchResult | undefined): boolean {
  return result === undefined || result.status === "faulted";
}
