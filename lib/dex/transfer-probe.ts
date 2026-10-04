// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { decodeFunctionResult, encodeFunctionData, numberToHex, parseEther } from "viem";

import { rpc } from "../rpc/client";

import { erc20Abi } from "../rpc/abis";

import { addresses, isAddressConfigured } from "../config/chain";

import { randomSimWallet, tokenUnit, findBalanceSlot, mappingSlot } from "./erc20-sim";

import {
  differentialSell,
  isInsufficientFundsError,
  resolveSimEnv,
  txFields,
  type GasSensitivity,
  type SimEnv,
} from "./sim-env";

export type TransferProbeStatus = "OK" | "BLOCKED" | "INCONCLUSIVE";

export interface TransferProbe {
  status: TransferProbeStatus;
  detail: string;
  balanceSlot?: string;
  /**
   * The V4 path reaches a verdict through the quoter, which supplies neither a
   * sender nor a gas price — so this probe is the ONLY place a V4-only token
   * meets a realistic transaction. It runs the same differential as the V2/V3
   * sells (lib/dex/sim-env.ts).
   */
  gasSensitivity?: GasSensitivity;
  /**
   * Set only on a BLOCKED venue-bound probe. `venue-bound-only` is the sell-gate
   * shape: wallet-to-wallet clears while the transfer a seller makes does not.
   */
  blockedScope?: "venue-bound-only" | "all-transfers";
}

export async function probeTokenTransfer(token: `0x${string}`, decimals?: number | null): Promise<TransferProbe> {
  throw new NotImplementedInPublicBuild("lib/dex/transfer-probe.ts#probeTokenTransfer");
}

export function applyV4TransferResidual(baseReason: string, probe: TransferProbe): { status: "PASS" | "WARN" | "SKIP"; reason: string } {
  throw new NotImplementedInPublicBuild("lib/dex/transfer-probe.ts#applyV4TransferResidual");
}