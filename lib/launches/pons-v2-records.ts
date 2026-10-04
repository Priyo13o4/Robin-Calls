// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { parseAbi, type Abi, type Address } from "viem";

import { batchRead } from "@/lib/rpc/multicall";

export interface PonsV2LaunchRecord {
  curve: Address;
  pairToken: Address;
  graduationThreshold: bigint;
  phase: number;
  exists: boolean;
  /** L97: the human the factory pays. `TokenLaunched.deployer` is whoever sent the call. */
  creatorFeeRecipient: Address;
  /** The call's sender, kept only to tell the two apart. Never the subject. */
  deployer: Address;
}

export async function readLaunchRecords(factory: Address, tokens: string[]): Promise<Map<string, PonsV2LaunchRecord>> {
  throw new NotImplementedInPublicBuild("lib/launches/pons-v2-records.ts#readLaunchRecords");
}