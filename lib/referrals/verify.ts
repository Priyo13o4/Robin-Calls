import { ContractFunctionZeroDataError, hashMessage, recoverAddress } from "viem";
import type { Address, Client } from "viem";
import { readContract } from "viem/actions";
import { erc1271Abi, ERC1271_MAGIC_VALUE } from "./erc1271-abi";
import { isTransientRpcError } from "@/lib/rpc/fault";
import { rpc } from "@/lib/rpc/client";
import { FRESHNESS_MS, referralMessage, type ReferralAction } from "./proof";

/**
 * SERVER ONLY. The chain-backed half of the wallet-control proof; the message
 * builder it shares with the browser lives in `proof.ts`, which imports nothing
 * from here. A static `rpc` import is safe in this file because no "use client"
 * module imports it — tests/referral-wiring.test.ts pins that.
 */

/**
 * Distinct sentence for "the chain read failed". A 503, never a 401: a Safe
 * user signing during an RPC blip must be asked to retry, not told their
 * signature is wrong — a refusal here is permanent (no code after the first
 * contribution), so a wrong "no" is the expensive direction.
 */
export const UNAVAILABLE_SENTENCE =
  "We could not reach the chain to check that signature. Please try again in a moment.";

/** null when the proof is good; otherwise the sentence to show the user. */
export async function verifyReferralProof(
  walletLower: string,
  action: ReferralAction,
  issuedAt: unknown,
  signature: unknown,
): Promise<string | null> {
  if (typeof issuedAt !== "string" || typeof signature !== "string") {
    return "Missing signature.";
  }
  const issuedMs = Date.parse(issuedAt);
  if (!Number.isFinite(issuedMs)) return "Invalid timestamp on the signature.";
  if (Math.abs(Date.now() - issuedMs) > FRESHNESS_MS) {
    return "That signature has expired. Please sign again.";
  }
  try {
    const verdict = await verifyWalletSignature(walletLower, referralMessage(walletLower, action, issuedAt), signature);
    if (verdict === "verified") return null;
    if (verdict === "unavailable") {
      return UNAVAILABLE_SENTENCE;
    }
    return "That signature does not match this wallet.";
  } catch {
    // A malformed signature throws rather than returning false. It is a bad
    // request, not an outage, so it must not read as one.
    return "That signature could not be read.";
  }
}

/** A narrowed client that can read wallet code — the seam tests inject. */
type CodeReader = { getCode(args: { address: Address }): Promise<string> };

/**
 * Three answers, because two collapse a chain fault into "invalid".
 *
 *   verified     the wallet signed it — EOA recovery or ERC-1271 magic value
 *   invalid      the chain ran the check and said no, or there is no code and
 *                ECDSA recovery failed. A definitive answer.
 *   unavailable  a transport fault stopped the ERC-1271 read. NOT an answer.
 *
 * Smart contract wallets (Safe, Coinbase Smart Wallet) sign under ERC-1271, so
 * offline ECDSA recovery fails for them and the chain read is the only proof
 * there is. Until this ran against deployed code, every Safe user was told
 * their signature was wrong — for a decision this surface makes permanent.
 *
 * The `client` parameter is a test seam. Production callers pass none, so the
 * shipped path is the pooled `rpc()` client below — the test that covers THIS
 * path is the one that omits the argument.
 */
export async function verifyWalletSignature(
  walletLower: string,
  message: string,
  signature: string,
  client?: Client,
): Promise<"verified" | "invalid" | "unavailable"> {
  // Fast path, free and offline. Covers every plain wallet, which is nearly
  // everyone, with no RPC call.
  try {
    const recovered = await recoverAddress({ hash: hashMessage(message), signature: signature as `0x${string}` });
    if (recovered.toLowerCase() === walletLower.toLowerCase()) return "verified";
  } catch {
    // Not an ECDSA-shaped signature (e.g. an ERC-1271 dynamic byte string).
    // Falls through to the wallet's code.
  }

  // A malformed hex signature cannot be either kind — refuse without RPC.
  if (!/^0x[0-9a-fA-F]*$/.test(signature) || signature.length < 3) return "invalid";

  // Production passes NO client, so the pooled client is the shipped path. The
  // parameter exists only so tests can inject a fake (and must never be relied
  // on by a caller that production runs).
  const chainClient = (client ?? rpc()) as Client & CodeReader;
  return verifyWithClient(chainClient, walletLower, message, signature);
}

async function verifyWithClient(
  chainClient: Client & CodeReader,
  walletLower: string,
  message: string,
  signature: string,
): Promise<"verified" | "invalid" | "unavailable"> {
  let code: string | null;
  try {
    code = await chainClient.getCode({ address: walletLower as Address });
  } catch {
    // Cannot tell whether the wallet has code, so the 1271 path is unreachable
    // and ECDSA already failed. Unknown, not invalid (§4).
    return "unavailable";
  }
  if (!code || code === "0x") return "invalid";

  try {
    const magic = await readContract(chainClient, {
      address: walletLower as Address,
      abi: erc1271Abi,
      functionName: "isValidSignature",
      args: [hashMessage(message), signature as `0x${string}`],
    });
    return magic.toLowerCase() === ERC1271_MAGIC_VALUE ? "verified" : "invalid";
  } catch (err) {
    // A wallet that reverts the check (no 1271 support, or its owner state
    // rejects) has ANSWERED. Only a transport fault is "we could not look".
    // "Returned no data" is in between: on this node a raw revert with no
    // reason surfaces as empty 0x (viem's ZeroDataError, matched by NAME
    // because the class can fail instanceof across the dual CJS/ESM builds).
    // The chain executed the wallet's code, so it is an answer — not an outage.
    const shape = `${(err as Error)?.name ?? ""} ${(err as Error)?.message ?? ""}`;
    if (err instanceof ContractFunctionZeroDataError || /ZeroDataError|returned no data/i.test(shape)) return "invalid";
    if (isTransientRpcError(err)) return "unavailable";
    return "invalid";
  }
}
