import {
  BaseError,
  ContractFunctionRevertedError,
  ExecutionRevertedError,
  HttpRequestError,
  LimitExceededRpcError,
  RpcRequestError,
  TimeoutError,
} from "viem";

/**
 * Transport fault vs. genuine EVM revert — the distinction the honeypot
 * simulators were missing.
 *
 * viem throws for both "the node is unreachable" and "the contract reverted".
 * A bare `catch` cannot tell them apart, so a rate-limited node looked exactly
 * like a blocked sell, and the scanner published CRITICAL on a tradeable token.
 * That is the worst failure this product can produce: it defames a real project
 * on the strength of an infrastructure hiccup (§4, "never launder unknown into
 * no").
 *
 * A revert is a real answer from the chain — the contract ran and refused.
 * Anything else (timeout, 429, 5xx, socket reset, malformed JSON-RPC envelope)
 * means we never got an answer at all.
 *
 * **Defaults to transient on an unrecognized error.** An unknown fault must
 * degrade to "we don't know", never to a confident accusation. The cost of a
 * wrong `true` is a SKIP; the cost of a wrong `false` is a false CRITICAL.
 */
/** JSON-RPC "Internal error": the node failed, so nothing about the contract was learned. */
const INTERNAL_RPC_ERROR_CODE = -32603;

export function isTransientRpcError(error: unknown): boolean {
  if (!(error instanceof Error)) return true;

  // Walk the whole cause chain: viem nests the real reason several layers deep
  // (ContractFunctionExecutionError → CallExecutionError → ExecutionRevertedError).
  const chain: Error[] = [];
  let cursor: unknown = error;
  while (cursor instanceof Error && chain.length < 10) {
    chain.push(cursor);
    cursor =
      (cursor as { cause?: unknown }).cause ??
      (cursor instanceof BaseError ? cursor.walk() : undefined);
    if (cursor === chain[chain.length - 1]) break; // walk() self-reference guard
  }

  // Read BEFORE the revert links, because the wrapper sits nearer the surface
  // than the truth: viem calls EVERY failed eth_call a revert, including one the
  // node never executed. An anvil fork that cannot fetch upstream state answers
  // -32603 and viem still builds a ContractFunctionRevertedError over it, so the
  // loop below returned "the pool said no" about a pool nobody read (L201).
  // A genuine revert on this chain carries code 3 / ExecutionRevertedError, so
  // requiring its absence keeps real reverts definitive; `shouldFailover` below
  // already treats -32603 as the node's own failure.
  if (
    chain.some((link) => (link as { code?: unknown }).code === INTERNAL_RPC_ERROR_CODE) &&
    !chain.some((link) => link instanceof ExecutionRevertedError)
  ) {
    return true;
  }

  for (const link of chain) {
    // A revert is a definitive on-chain answer, not a fault.
    if (
      link instanceof ContractFunctionRevertedError ||
      link instanceof ExecutionRevertedError
    ) {
      return false;
    }
    // Unambiguous transport faults.
    if (
      link instanceof HttpRequestError ||
      link instanceof TimeoutError ||
      link instanceof LimitExceededRpcError ||
      link instanceof RpcRequestError
    ) {
      return true;
    }
  }

  // Fall back to the message only when no typed link matched. Some providers
  // return reverts as plain JSON-RPC errors without viem's wrapper class.
  const message = chain.map((e) => e.message).join(" ").toLowerCase();
  if (EVM_EXECUTION_MARKERS.some((marker) => marker.test(message))) {
    return false;
  }

  return true;
}

/**
 * Phrases that can only come from the EVM executing code. Tested against the
 * already-lowercased chain, so no `i` flag.
 *
 * A bare "revert" is deliberately absent: this runs over the WHOLE concatenated
 * cause chain, so infrastructure prose ("the gateway is reverting to a backup
 * pool") matched it and turned an outage into sell-blocking evidence. Anything
 * short of these stays transient, per the module default above — so a phrasing
 * missing here costs a SKIP, never a false accusation.
 */
const EVM_EXECUTION_MARKERS: readonly RegExp[] = [
  /execution reverted/,
  /transaction reverted/,
  /contract reverted/,
  /call reverted/,
  /function ".*?" reverted/, // viem's own prose, when its wrapper class is lost
  /reverted with (?:reason|panic|custom error)/,
  /vm exception/,
  /invalid opcode/,
  /out of gas/,
  /always failing transaction/,
];

/**
 * Inverse helper for call sites that read better as "this was a real answer".
 * A revert IS evidence — a blocked sell is exactly what a honeypot looks like.
 */
export function isDefinitiveRevert(error: unknown): boolean {
  return !isTransientRpcError(error);
}

// ── the pool's own classifiers ──────────────────────────────────────────────
//
// These two lived in `provider-pool.ts` until the audit needed one of them.
// `provider-pool.ts` opens sockets, reads the environment and writes to the
// observability context, so importing it drags a transport implementation in
// behind a pure predicate — and `lib/audit/read-context.ts` did exactly that,
// which is what kept the contract audit from ever running anywhere but this
// server. Both are pure functions over an error object; they belong with the
// other error classification, not with the pool that happens to call them.
//
// `provider-pool.ts` re-exports them, so every existing caller and every test
// still names the same symbol from the same place.

/** JSON-RPC error code 3 = execution reverted — a chain fact, not an outage. */
export function isExecutionRevert(error: unknown): boolean {
  let cursor: unknown = error;
  for (let hops = 0; cursor && hops < 8; hops++) {
    const e = cursor as { code?: number; message?: string; cause?: unknown };
    if (e.code === 3) return true;
    if (typeof e.message === "string" && /execution reverted|revert/i.test(e.message)) {
      return true;
    }
    cursor = e.cause;
  }
  return false;
}

/**
 * Deterministic JSON-RPC errors that a different provider cannot change.
 * -32000 is deliberately absent: providers use it for varied server-side
 * conditions (some transient), so it stays failover-eligible.
 *
 * -32600 (Invalid Request) is here specifically for Alchemy's free-tier
 * `eth_getLogs` rejection ("you can make eth_getLogs requests with up to a
 * 10 block range... Upgrade to PAYG"): a fixed, permanent per-account limit,
 * not a transient fault. Without this, `shouldFailover` fell through to its
 * unknown-shape default of `true`, treating the rejection as retryable
 * transport trouble and needlessly opening Alchemy's circuit breaker on a
 * request no retry could ever satisfy.
 */
const DETERMINISTIC_RPC_CODES = new Set([
  -32600, // invalid request (e.g. Alchemy free-tier eth_getLogs range cap)
  -32601, // method not found
  -32602, // invalid params
]);

/**
 * Failover helps only for transport-class faults: timeouts, connection
 * failures, HTTP 429/5xx, malformed responses. Everything deterministic is
 * thrown as-is so quota is never burned replaying a fixed outcome.
 */
export function shouldFailover(error: unknown): boolean {
  if (isExecutionRevert(error)) return false;
  let cursor: unknown = error;
  for (let hops = 0; cursor && hops < 8; hops++) {
    const e = cursor as {
      name?: string;
      code?: number;
      status?: number;
      cause?: unknown;
    };
    // The sender's balance is chain state every provider shares. Retrying only burned
    // simulateV1 on each one and counted a user's empty wallet against our circuits.
    if (typeof (e as { message?: unknown }).message === "string" && /insufficient funds/i.test((e as { message: string }).message)) return false;
    if (e.name === "TimeoutError" || e.name === "HttpRequestError") return true;
    if (
      typeof e.status === "number" &&
      (e.status === 401 || e.status === 403 || e.status === 413 || e.status === 429 || e.status >= 500)
    ) {
      return true;
    }
    if (typeof e.code === "number") {
      if (DETERMINISTIC_RPC_CODES.has(e.code)) return false;
      if (e.code === -32603) return true; // provider-internal error
    }
    // fetch/undici network failures surface as TypeError
    if (e.name === "TypeError") return true;
    cursor = e.cause;
  }
  // Unknown shape: treat as transport trouble so one flaky provider
  // cannot hard-fail a scan the next provider could serve.
  return true;
}

/**
 * Does this error mean "I do not have state for that block" rather than "the
 * contract said no"?
 *
 * Narrow ON PURPOSE, and the direction is the safe one. An unrecognised error
 * propagates unchanged, so the audit sees a fault and stands down (§4). If this
 * ever misfires on a genuine revert the retry hits the same revert at `latest`
 * and nothing is invented. Widening it is what would be dangerous: a revert
 * quietly re-run at `latest` is a different question being answered.
 *
 * `metadata is not found` is what Robinhood Chain's public RPC returns past its
 * ~6,200-block window (measured 2026-09-09, 2026-09-15); the rest are the usual
 * spellings from other clients, kept so a provider swap does not disable the pin.
 */
/**
 * A provider saying it does not offer this method (-32601). A fact about that
 * provider, not the chain: OrbitFlare Free answers trace methods "method not
 * available on this plan" (2026-09-15) while another provider may serve them.
 */
export function isMethodUnavailableError(err: unknown): boolean {
  let cursor: unknown = err;
  for (let hops = 0; cursor && hops < 8; hops++) {
    const e = cursor as { code?: number; cause?: unknown };
    if (e.code === -32601) return true;
    cursor = e.cause;
  }
  return false;
}

export function isMissingBlockStateError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /metadata is not found|missing trie node|header not found|state (?:at block .* )?(?:is )?not available|block not found|missing or invalid parameters.*block/i.test(
    msg,
  );
}
