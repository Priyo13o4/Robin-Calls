// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { isNode, subtreeReverts, walk, type Node } from "./ast-walker";

import type { LivenessPrecondition } from "../types";

interface VarFacts {
  /** Declared `immutable`/`constant`, so no writer exists at all. */
  frozenByDeclaration: Set<string>;
  /** Has a public getter — the only handle a chain read has on it. */
  readable: Set<string>;
  all: Set<string>;
}

export const SOLADY_INITIALIZABLE_SLOT = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffbf601132" as const;

export function soladyInitializerSlot(contracts: readonly Node[]): typeof SOLADY_INITIALIZABLE_SLOT | null {
  throw new NotImplementedInPublicBuild("lib/audit/capabilities/liveness.ts#soladyInitializerSlot");
}

export function detectLivenessPreconditions(contract: Node, initializerSlot: `0x${string}` | null = undefined as any): LivenessPrecondition[] {
  throw new NotImplementedInPublicBuild("lib/audit/capabilities/liveness.ts#detectLivenessPreconditions");
}