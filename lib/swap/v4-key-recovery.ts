// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { runSharedRpcWork } from "../observability/context";

import { UNISWAP_V4_POOL_MANAGER } from "./venues";

import type { PublicClient } from "viem";

import { v4InitializeEvent } from "../rpc/abis";

import { rpc } from "../rpc/client";

import { writeV4Pools } from "../data/launches";

import { explorerGetLogs } from "../explorer/logs";

import { reportError } from "../observability/reporter";

import type { V4PoolDraft } from "../launches/types";

import { computeV4PoolId } from "./hook-admission";

import type { Hex } from "./types";

type RecoveryHead = { number: bigint; timestamp: bigint };

export interface RecoveryResult { pools: V4PoolDraft[]; faulted: boolean }

type InitLog = { args: { currency0?: Hex; currency1?: Hex; fee?: number; tickSpacing?: number; hooks?: Hex }; blockNumber: bigint; transactionHash: Hex };

export async function recoverV4PoolKeys(wanted: readonly { poolId: string; createdAt: number }[], deps: { client?: PublicClient; write?: typeof writeV4Pools; explorerLogs?: typeof explorerGetLogs } = undefined as any): Promise<RecoveryResult> {
  throw new NotImplementedInPublicBuild("lib/swap/v4-key-recovery.ts#recoverV4PoolKeys");
}

export function _resetV4KeyRecoveryForTests(): any {
  throw new NotImplementedInPublicBuild("lib/swap/v4-key-recovery.ts#_resetV4KeyRecoveryForTests");
}