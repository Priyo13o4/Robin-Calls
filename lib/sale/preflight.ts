import type { Address, Hex, PublicClient } from "viem";
import { isTransientRpcError } from "@/lib/rpc/fault";
import { describeSaleRevert, type SaleRevert } from "./errors";

/**
 * Runs a sale write as an `eth_call` first, so a rejection is a sentence BEFORE
 * the operator signs, instead of a reverted transaction they paid gas for.
 *
 * Three outcomes, and keeping them three is the whole point (§4):
 *
 *   ok       — the call would succeed from this account, right now.
 *   rejected — the contract answered no, and named the reason.
 *   unknown  — we could not ask. NOT a rejection.
 *
 * `unknown` must never block the send. A dead RPC deciding that a legal owner
 * action is forbidden is the same failure as a dead RPC deciding a token is a
 * honeypot: an infrastructure fault wearing a verdict's clothes. The contract
 * is the enforcer; this is only the early warning.
 */

export type Preflight =
  | { status: "ok" }
  | { status: "rejected"; revert: SaleRevert; sentence: string }
  | { status: "unknown"; sentence: string };

export interface PreflightRequest {
  to: Address;
  from: Address;
  data: Hex;
  value?: bigint;
}

export async function preflightSaleCall(
  client: Pick<PublicClient, "call">,
  req: PreflightRequest,
): Promise<Preflight> {
  try {
    await client.call({
      account: req.from,
      to: req.to,
      data: req.data,
      value: req.value ?? 0n,
    });
    return { status: "ok" };
  } catch (error) {
    const revert = describeSaleRevert(error);
    if (revert) return { status: "rejected", revert, sentence: revert.sentence };

    // Undecodable. It could be a revert from a contract that is not this one
    // (wrong address), or the node never answered. Either way we do not know,
    // and we say so rather than inventing a rejection.
    return {
      status: "unknown",
      sentence: isTransientRpcError(error)
        ? "We could not check this call first because the network did not answer. You can still send it, and the contract decides."
        : "We could not check this call against the chain first. You can still send it, and the contract decides.",
    };
  }
}

/** True when the preflight positively says the contract would refuse. Only a
 *  `rejected` blocks — `unknown` deliberately does not. */
export const preflightBlocks = (p: Preflight | null): p is Extract<Preflight, { status: "rejected" }> =>
  p?.status === "rejected";
