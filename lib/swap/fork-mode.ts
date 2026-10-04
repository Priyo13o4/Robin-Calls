// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



export type ForkVerdict =
  | { kind: "off" }
  | { kind: "on"; rpcUrl: string; client: string }
  /** The env says one thing and the node says another. Never trade under this. */
  | { kind: "mismatch"; detail: string }
  /** We could not ask the node what it is. Not evidence that it is real (§4). */
  | { kind: "unknown"; detail: string };

export interface ForkEnv {
  enabled?: string;
  rpcUrl?: string;
  nodeEnv?: string;
  /** The ORDINARY RPC, so the off-path can notice it pointing somewhere local. */
  configuredRpcUrl?: string;
}

export function readForkEnv(env: NodeJS.ProcessEnv = undefined as any): ForkEnv {
  throw new NotImplementedInPublicBuild("lib/swap/fork-mode.ts#readForkEnv");
}

export function isLocalHost(url: string | undefined): boolean {
  throw new NotImplementedInPublicBuild("lib/swap/fork-mode.ts#isLocalHost");
}

export function forkModeRequested(env: ForkEnv): boolean {
  throw new NotImplementedInPublicBuild("lib/swap/fork-mode.ts#forkModeRequested");
}

export function assertForkModeAllowed(env: ForkEnv): void {
  throw new NotImplementedInPublicBuild("lib/swap/fork-mode.ts#assertForkModeAllowed");
}

export function isForkClient(clientVersion: string): boolean {
  throw new NotImplementedInPublicBuild("lib/swap/fork-mode.ts#isForkClient");
}

export async function resolveForkMode(env: ForkEnv, probe: (url: string) => Promise<string>): Promise<ForkVerdict> {
  throw new NotImplementedInPublicBuild("lib/swap/fork-mode.ts#resolveForkMode");
}

export function forkBannerSentence(verdict: ForkVerdict): string | null {
  throw new NotImplementedInPublicBuild("lib/swap/fork-mode.ts#forkBannerSentence");
}

export function forkModeBlocksTrading(verdict: ForkVerdict): boolean {
  throw new NotImplementedInPublicBuild("lib/swap/fork-mode.ts#forkModeBlocksTrading");
}

export async function forkMode(): Promise<ForkVerdict> {
  throw new NotImplementedInPublicBuild("lib/swap/fork-mode.ts#forkMode");
}