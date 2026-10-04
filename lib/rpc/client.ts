import { createPublicClient, custom, type PublicClient } from "viem";

/**
 * The narrow slice of a viem client that a chain READ needs.
 *
 * Structural rather than `PublicClient` so the same logic can run against a
 * transport we did not build — the server's pooled provider, or a browser's own
 * client during a client-side contract audit. That is what lets the audit ship
 * ONE implementation with two transports instead of two implementations that
 * drift (CLAUDE.md §1, the same reason the AI plane has no second Drizzle
 * layer).
 *
 * Keep it narrow. Widening this to `PublicClient` is exactly how the seam
 * closes again by accident.
 */
export type ChainReader = Pick<
  PublicClient,
  "readContract" | "getCode" | "getStorageAt" | "call" | "simulateContract"
>;
import { robinhoodChain } from "../config/chain";
import { poolRequest } from "./provider-pool";

/**
 * Shared read client for Robinhood Chain.
 *
 * Every JSON-RPC request flows through the ordered provider pool
 * (lib/rpc/provider-pool.ts): sequential failover with per-provider circuit
 * breakers, scan-deadline preservation, wrong-chain endpoint rejection, and
 * per-attempt instrumentation into the active scan context (PRD §11).
 *
 * viem-level retries are disabled — retry and failover policy live in one
 * place, the pool, so a transport fault is never replayed twice per layer.
 */

let client: PublicClient | undefined;
let testClient: PublicClient | undefined;

/** Test seam for end-to-end scans; reset with no argument after the test. */
export function _mockRpcClient(value?: PublicClient): void {
  testClient = value;
}

export function rpc(): PublicClient {
  if (testClient) return testClient;
  if (client) return client;
  client = createPublicClient({
    chain: robinhoodChain,
    transport: custom({ request: poolRequest }, { retryCount: 0 }),
  });
  return client;
}
