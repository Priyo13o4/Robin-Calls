// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import type { Abi } from "viem";

import { batchRead, type BatchResult } from "../rpc/multicall";

import { ownableAbi, safeAbi, timelockAbi } from "../rpc/abis";

import { classifyAddresses, type EntityKind } from "../scanner/entity";

export interface HolderController {
  owner: string;
  ownerKind: EntityKind | null;
  /** Null unless getThreshold AND getOwners both answered. */
  safe: { threshold: number; owners: string[]; ownerKinds: (EntityKind | null)[] } | null;
  /** Null unless getMinDelay answered. */
  timelockDelaySeconds: number | null;
  /** Null when there is no hook or its owner() did not answer. */
  alsoOwnsHook: boolean | null;
}

export interface ControllerGrade {
  status: "FAIL" | "WARN";
  controllerClass: "wallet" | "wallet-multisig" | "timelock";
  tail: string;
}

export const SAFE_SIGNER_READ_MAX = 16;

export async function readHolderController(holder: string, hook: string | null): Promise<HolderController | null> {
  throw new NotImplementedInPublicBuild("lib/dex/holder-controller.ts#readHolderController");
}

export function gradeHolderController(c: HolderController | null): ControllerGrade | null {
  throw new NotImplementedInPublicBuild("lib/dex/holder-controller.ts#gradeHolderController");
}