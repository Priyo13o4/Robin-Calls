// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";
import type { PublicClient } from "viem";
import type { AuditClient } from "./read-context";
import type { ProxyKind } from "./types";

export type SourceTargetClient = AuditClient & Pick<PublicClient, "getBlock">;

export interface SourceTarget {
  target: string;
  proxyKind: ProxyKind;
  unresolved: boolean;
}

export async function resolveSourceTarget(
  _client: SourceTargetClient,
  _address: string,
): Promise<SourceTarget> {
  throw new NotImplementedInPublicBuild("lib/audit/source-target.ts#resolveSourceTarget");
}
