// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { decodeAbiParameters, toFunctionSelector, type Hex } from "viem";

export type RetryAdvice =
  /** The user's own tolerance was the binding constraint. */
  | "raise-slippage"
  /** Transient: the price moved, the deadline passed, the nonce was stale. */
  | "retry"
  /** Nothing the user can change from the panel. */
  | "no"
  /** We do not know, and guessing would be advice. */
  | "unknown";

interface KnownRevert {
  readonly signature: string;
  readonly sentence: string;
  readonly advice: RetryAdvice;
}

export type RevertReason =
  | { kind: "known"; selector: Hex; sentence: string; advice: RetryAdvice }
  | { kind: "error-string"; sentence: string; message: string; advice: RetryAdvice }
  | { kind: "panic"; selector: Hex; sentence: string; code: string; advice: RetryAdvice }
  /** Recognised as a revert, not recognised as a reason. States the failure, advises nothing. */
  | { kind: "unrecognised"; selector: Hex | null; sentence: string; advice: RetryAdvice };

export function decodeRevertReason(data: Hex | null | undefined): RevertReason {
  throw new NotImplementedInPublicBuild("lib/swap/revert-reasons.ts#decodeRevertReason");
}

export const CATALOGUE_SIGNATURES: readonly string[] = [];