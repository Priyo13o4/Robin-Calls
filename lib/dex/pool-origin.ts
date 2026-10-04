// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";

export type PoolOpenerVia = "launchpad-factory" | "launchpad-hook" | "direct" | "unknown";

export const KNOWN_BATCHERS: ReadonlySet<string> = new Set([
  "0xca11bde05977b3631167028862be2a173976ca11",
  "0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789",
  "0x0000000071727de22e5e9d8baf0edac6f37da032",
  "0x4337084d9e255ff0702461cf8895ce9e3b5ff108",
]);

export interface PoolOrigin {
  openedBy: string | null;
  openedThrough: string | null;
  via: PoolOpenerVia;
  thirdParty: boolean;
  senderComparable: boolean;
}

export const UNKNOWN_ORIGIN: PoolOrigin = {
  openedBy: null,
  openedThrough: null,
  via: "unknown",
  thirdParty: false,
  senderComparable: false,
};

export type LaunchSideSenders = ReadonlySet<string>;

export function launchFactorySet(): Set<string> {
  throw new NotImplementedInPublicBuild("lib/dex/pool-origin.ts#launchFactorySet");
}

export function launchHookSet(): Set<string> {
  throw new NotImplementedInPublicBuild("lib/dex/pool-origin.ts#launchHookSet");
}

export function classifyByHook(
  hooks: string | null | undefined,
  padHooks: ReadonlySet<string>,
): PoolOrigin | null {
  throw new NotImplementedInPublicBuild("lib/dex/pool-origin.ts#classifyByHook");
}

export function classifyOrigin(
  tx: { from?: string | null; to?: string | null } | null,
  launchSide: LaunchSideSenders,
  factories: ReadonlySet<string>,
): PoolOrigin {
  throw new NotImplementedInPublicBuild("lib/dex/pool-origin.ts#classifyOrigin");
}

export async function resolvePoolOrigin(
  initTxHash: string | null | undefined,
  launchSide: LaunchSideSenders,
  deps: { getTx?: (h: `0x${string}`) => Promise<{ from?: string | null; to?: string | null } | null> } = {},
): Promise<PoolOrigin> {
  throw new NotImplementedInPublicBuild("lib/dex/pool-origin.ts#resolvePoolOrigin");
}
