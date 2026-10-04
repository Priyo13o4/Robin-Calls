// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";
import type { ContractIdentity, FunctionInventory } from "./types";

export const MAX_INVENTORY_FUNCTIONS = 120;

export function enumerateDispatcherSelectors(
  _runtimeCode: string | null,
): { selectors: string[]; complete: boolean } {
  throw new NotImplementedInPublicBuild("lib/audit/inventory.ts#enumerateDispatcherSelectors");
}

export function unknownInventory(): FunctionInventory {
  throw new NotImplementedInPublicBuild("lib/audit/inventory.ts#unknownInventory");
}

export function unknownIdentity(): ContractIdentity {
  throw new NotImplementedInPublicBuild("lib/audit/inventory.ts#unknownIdentity");
}

export function canonicalSignature(_item: unknown): string | null {
  throw new NotImplementedInPublicBuild("lib/audit/inventory.ts#canonicalSignature");
}

export function abiFunctionSignatures(_abi: unknown[] | null): string[] {
  throw new NotImplementedInPublicBuild("lib/audit/inventory.ts#abiFunctionSignatures");
}

export function buildFunctionInventory(_input: {
  abi: unknown[] | null;
  runtimeCode: string | null;
}): FunctionInventory {
  throw new NotImplementedInPublicBuild("lib/audit/inventory.ts#buildFunctionInventory");
}

export function sourceMatchOf(
  _raw: {
    is_verified: boolean;
    is_partially_verified?: boolean | null;
    is_fully_verified?: boolean | null;
  } | null,
): ContractIdentity["sourceMatch"] {
  throw new NotImplementedInPublicBuild("lib/audit/inventory.ts#sourceMatchOf");
}

export function buildContractIdentity(_input: {
  raw: {
    is_verified: boolean;
    is_partially_verified?: boolean | null;
    is_fully_verified?: boolean | null;
    abi: unknown[] | null;
    compiler_version: string | null;
    name: string | null;
  } | null;
  runtimeCode: string | null;
}): ContractIdentity {
  throw new NotImplementedInPublicBuild("lib/audit/inventory.ts#buildContractIdentity");
}

export function decodeIdentity(_value: unknown): ContractIdentity {
  throw new NotImplementedInPublicBuild("lib/audit/inventory.ts#decodeIdentity");
}

export const BENIGN_WRITE_FUNCTION_NAMES: ReadonlySet<string> = new Set([
  "onERC721Received",
  "onERC1155Received",
  "onERC1155BatchReceived",
  "renounceOwnership",
]);

export function unclassifiedWriteFunctions(
  _inventory: FunctionInventory,
  _capabilities: readonly { functionSignatures: readonly string[] }[],
): string[] | null {
  throw new NotImplementedInPublicBuild("lib/audit/inventory.ts#unclassifiedWriteFunctions");
}
