// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import {
  decodeEventLog,
  encodeAbiParameters,
  keccak256,
  toEventSelector,
  type AbiEvent,
  type Hex,
} from "viem";

import { LAUNCHER_MODULES } from "@/lib/launches/modules";

import { DEFAULT_V4_POOL_MANAGER } from "@/lib/launches/modules/v4-pools";

import type {
  ChainContracts,
  ChainLog,
  DecodeResult,
  IngestContext,
  KnownLaunch,
  LaunchDraft,
  LauncherFamily,
  LauncherInstance,
  LogSubscription,
  V4PoolDraft,
} from "@/lib/launches/types";

export function knownFromDraft(d: LaunchDraft): KnownLaunch {
  throw new NotImplementedInPublicBuild("lib/sequencer/confirmed-events.ts#knownFromDraft");
}

export interface ExecutionLog {
  address: string;
  topics: string[];
  data: string;
  logIndex: number;
}

export interface ExecutionEvidence {
  hash: string;
  blockNumber: number;
  timestamp: number | null;
  status: "success" | "reverted";
  logs: ExecutionLog[];
  source: "robinscan" | "blockscout";
  complete: boolean;
}

export const V4_POOL_KEY_ABI = [
  {
    name: "key",
    type: "tuple",
    components: [
      { name: "currency0", type: "address" },
      { name: "currency1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "tickSpacing", type: "int24" },
      { name: "hooks", type: "address" },
    ],
  },
] as const;

export function computeV4PoolId(key: {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
}): `0x${string}` {
  throw new NotImplementedInPublicBuild("lib/sequencer/confirmed-events.ts#computeV4PoolId");
}

export function decodeConfirmedExecution(evidence: ExecutionEvidence, instances: readonly LauncherInstance[], chain: ChainContracts, known: readonly KnownLaunch[]): DecodeResult {
  throw new NotImplementedInPublicBuild("lib/sequencer/confirmed-events.ts#decodeConfirmedExecution");
}