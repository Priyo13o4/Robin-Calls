// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";
import type { PublicClient } from "viem";

export const DOPPLER_HOOK_INITIALIZERS: ReadonlySet<string> = new Set([
  "0x4e3468951d49f2eea976ed0d6e75ffcb44a9a544",
]);

export type DopplerLockRead =
  | { read: "ok"; status: number; poolId: string }
  | { read: "not-this-launch" }
  | { read: "unread" };

export function dopplerStatusLocksCurve(status: number): boolean {
  throw new NotImplementedInPublicBuild("lib/dex/doppler-lock.ts#dopplerStatusLocksCurve");
}

export async function readDopplerLock(
  client: Pick<PublicClient, "call">,
  hook: string | null,
  asset: string,
  poolId: string | null,
): Promise<DopplerLockRead | null> {
  throw new NotImplementedInPublicBuild("lib/dex/doppler-lock.ts#readDopplerLock");
}
