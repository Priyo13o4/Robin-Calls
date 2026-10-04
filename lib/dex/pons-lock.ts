// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";
import type { PublicClient } from "viem";

export const PONS_LAUNCH_LOCKERS: ReadonlySet<string> = new Set([
  "0x267444d099b10fb5ed7c3cc7b7c767adca574952",
]);

export type PonsLockRead =
  | { read: "ok"; locker: string; tokenId: bigint }
  | { read: "not-locked" }
  | { read: "unread" };

export async function readPonsLock(
  client: Pick<PublicClient, "call">,
  token: string,
  positionManager: string | null,
  lockers: Iterable<string> = PONS_LAUNCH_LOCKERS,
): Promise<PonsLockRead | null> {
  throw new NotImplementedInPublicBuild("lib/dex/pons-lock.ts#readPonsLock");
}
