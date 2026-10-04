// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { unclassifiedWriteFunctions } from "../audit/inventory";

import type { AuthorityKind, Capability, CapabilityFinding, ContractAuditResult } from "../audit/types";

export type WhaleAuthority =
  | {
      verdict: "CONTROLLABLE";
      capability: Capability;
      /**
       * Named in the accusation. Null only if the ABI gave no signature.
       * KNOWN-PROBLEMS L53: this was `functionSignatures[0]` — whichever
       * signature happened to sort first — so NOCK's sentence named `lock()`,
       * the permissionless DEPOSIT entrypoint, over the genuine candidates.
       * §8 #18 again: a list is ranked before anything is taken off it.
       */
      functionSignature: string | null;
      /** How many carry the capability. >1 means the named one is an example. */
      functionSignatureCount: number;
      controller: string | null;
      controllerKind: AuthorityKind;
      /**
       * L53 — did we establish that THIS controller gates THAT function?
       * `AuthorityResolution` carries no capability for most producers, so the
       * join is often unverifiable; false means the two halves were resolved
       * independently and the sentence must say so rather than assert a link
       * (§8 #15: every clause of a guard must be about the claim it protects).
       */
      joinVerified: boolean;
    }
  | {
      verdict: "INERT";
      surfaceSource: "abi";
      /**
       * How many write functions were checked for recognition to reach this
       * all-clear. Present ONLY because a sweep cannot otherwise tell an INERT
       * that passed the interpretation gate from one written before the gate
       * existed — an invariant that can never return a row is a dead tripwire.
       */
      writeFunctionsUnderstood: number;
    }
  | {
      verdict: "INCONCLUSIVE";
      why: string;
      /** `unclassified-mutating-surface` only: the write functions nothing recognised. */
      unclassified?: string[];
    };

export const LP_MOVING_CAPABILITIES = [] as any;

export function rankLpMovingSignatures(signatures: readonly string[]): string[] {
  throw new NotImplementedInPublicBuild("lib/dex/whale-authority.ts#rankLpMovingSignatures");
}

export function isEthPayoutOnly(finding: CapabilityFinding, all: readonly CapabilityFinding[]): boolean {
  throw new NotImplementedInPublicBuild("lib/dex/whale-authority.ts#isEthPayoutOnly");
}

export const KNOWN_LP_CARVEOUTS: ReadonlyArray<{
  address: string;
  pattern: RegExp;
  capability: Capability;
}> = {} as any;

export function isCarvedOutLpCapability(finding: CapabilityFinding, all: readonly CapabilityFinding[], holderAddress?: string | null): boolean {
  throw new NotImplementedInPublicBuild("lib/dex/whale-authority.ts#isCarvedOutLpCapability");
}

export function classifyWhaleAuthority(audit: ContractAuditResult | null, holderAddress?: string | null): WhaleAuthority {
  throw new NotImplementedInPublicBuild("lib/dex/whale-authority.ts#classifyWhaleAuthority");
}