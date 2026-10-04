// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { currentGasPrice } from "../rpc/gas-price";

export interface SimEnv {
  /**
   * null means the chain's gas price could not be read, NOT that it is zero.
   * A caller that collapses those two re-creates L14 (§4).
   */
  gasPrice: bigint | null;
  source: "eth_gasPrice" | "baseFeePerGas" | "baseFeeHeadroom" | "unreadable" | "forced-zero";
}

export const ZERO_GAS_ENV: SimEnv = {} as any;

export async function resolveSimEnv(): Promise<SimEnv> {
  throw new NotImplementedInPublicBuild("lib/dex/sim-env.ts#resolveSimEnv");
}

export function txFields(env: SimEnv): { gasPrice?: bigint } {
  throw new NotImplementedInPublicBuild("lib/dex/sim-env.ts#txFields");
}

export function isInsufficientFundsError(error: unknown): boolean {
  throw new NotImplementedInPublicBuild("lib/dex/sim-env.ts#isInsufficientFundsError");
}

export type GasSensitivity =
  | { state: "not-sensitive" }
  /** Sells work at gasprice 0 and fail at the real one — a gas-keyed sell gate. */
  | { state: "gas-conditional"; gasPriceWei: string }
  /** Failed both ways: a real block, and gas price is not what is doing it. */
  | { state: "blocked-either-way" }
  | { state: "unknown"; why: string };

export async function differentialSell<T>(env: SimEnv, classify: (result: T) => "ok" | "failed" | "faulted", run: (env: SimEnv) => Promise<T>): Promise<{ result: T; sensitivity: GasSensitivity }> {
  throw new NotImplementedInPublicBuild("lib/dex/sim-env.ts#differentialSell");
}

export function worstSensitivity(all: readonly GasSensitivity[]): GasSensitivity {
  throw new NotImplementedInPublicBuild("lib/dex/sim-env.ts#worstSensitivity");
}