// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { parse } from "@solidity-parser/parser";

import type { Capability, CapabilityConfidence, CapabilityFinding } from "../types";

import { detectLivenessPreconditions, soladyInitializerSlot } from "./liveness";

export type Node = Record<string, unknown> & { type: string };

export function isNode(x: unknown): x is Node {
  throw new NotImplementedInPublicBuild("lib/audit/capabilities/ast-walker.ts#isNode");
}

export function walk(node: unknown, visitFn: (n: Node) => boolean | void): void {
  throw new NotImplementedInPublicBuild("lib/audit/capabilities/ast-walker.ts#walk");
}

interface ContractSymbols {
  stateVarNames: Set<string>;
  functionsByName: Map<string, Node[]>;
  /**
   * State vars declared `constant` or `immutable`. KNOWN-PROBLEMS L53: a
   * `.call{value: v}("")` to one of these is a fee or payout to an address
   * fixed at deployment — it cannot be redirected, so it is not a rescue path.
   */
  fixedDestinationNames: Set<string>;
}

interface FunctionEvidence {
  /** Names of state vars written directly, reachable without crossing an unresolved call. */
  writes: Set<string>;
  /** Names (write targets we couldn't attribute to a local state var, or unresolved call targets). */
  unresolvedNameHints: Set<string>;
  directCalls: Array<"call" | "delegatecall">;
  /** `x.call{value: v}("")` — empty-calldata value sends, the canonical ETH-rescue idiom. Never delegatecall. */
  ethSends: number;
  /** L53: value sends whose destination is fixed at deployment. Counted apart
   *  from `ethSends` so a function doing both still accuses on the redirectable
   *  one — narrowing an accusation must never widen an all-clear (§8 #13). */
  fixedEthSends: number;
  selfdestructOrCreate: boolean;
  upgradeCalls: boolean;
  roleAdminCalls: number;
  mintCalls: number;
  /** An assembly block we didn't specifically pattern-match (create/create2/selfdestruct). */
  hasUnresolvedAssembly: boolean;
}

export function subtreeReverts(node: unknown): boolean {
  throw new NotImplementedInPublicBuild("lib/audit/capabilities/ast-walker.ts#subtreeReverts");
}

export function subtreeReturns(node: unknown): boolean {
  throw new NotImplementedInPublicBuild("lib/audit/capabilities/ast-walker.ts#subtreeReturns");
}

export function transferGatingStateVars(contract: Node, symbols: ContractSymbols): Set<string> {
  throw new NotImplementedInPublicBuild("lib/audit/capabilities/ast-walker.ts#transferGatingStateVars");
}

export function forgedTransferEvents(contract: Node, symbols: ContractSymbols): CapabilityFinding | null {
  throw new NotImplementedInPublicBuild("lib/audit/capabilities/ast-walker.ts#forgedTransferEvents");
}

export function classifyFromSource(normalizedSource: string, targetContractName?: string | null): CapabilityFinding[] {
  throw new NotImplementedInPublicBuild("lib/audit/capabilities/ast-walker.ts#classifyFromSource");
}