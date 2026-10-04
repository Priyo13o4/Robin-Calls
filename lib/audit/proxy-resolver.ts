// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";
import type { AuditReadContext } from "./read-context";
import type { Completeness, ProxyFacet, ProxyResolution } from "./types";

export { matchClone1167 } from "../rpc/clone";

export interface DiamondFacetsRead {
  facets: ProxyFacet[];
  totalCount: number;
}

export type DiamondProbe =
  | { status: "diamond"; read: DiamondFacetsRead }
  | { status: "absent" }
  | { status: "faulted" };

export interface ProxyPrimitives {
  slots: { implementation: string | null; admin: string | null; beacon: string | null };
  beaconImpl: string | null;
  code: string | null;
  diamondProbe: DiamondProbe;
  facetCap: number;
  safeMasterCopy?: string | null;
}

export function scanDelegatecall(_codeHex: string | null): boolean | null {
  throw new NotImplementedInPublicBuild("lib/audit/proxy-resolver.ts#scanDelegatecall");
}

export function hasDelegatecallOpcode(_codeHex: string | null): boolean {
  throw new NotImplementedInPublicBuild("lib/audit/proxy-resolver.ts#hasDelegatecallOpcode");
}

export function classifyProxyPrimitives(_p: ProxyPrimitives): Omit<ProxyResolution, "depth"> {
  throw new NotImplementedInPublicBuild("lib/audit/proxy-resolver.ts#classifyProxyPrimitives");
}

export type OneHopResult =
  | { status: "not-proxy" }
  | { status: "proxy"; implementation: string; completeness: Completeness; truncationReason: string | null }
  | { status: "fault" };

export interface ChainWalkResult {
  implementation: string;
  depth: number;
  completeness: Completeness;
  truncationReason: string | null;
}

export async function walkProxyChain(
  _start: { implementation: string; completeness: Completeness; truncationReason: string | null },
  _maxDepth: number,
  _resolveOneHop: (address: string) => Promise<OneHopResult>,
): Promise<ChainWalkResult> {
  throw new NotImplementedInPublicBuild("lib/audit/proxy-resolver.ts#walkProxyChain");
}

export async function resolveProxyGraph(
  _ctx: AuditReadContext,
  _address: string,
): Promise<ProxyResolution> {
  throw new NotImplementedInPublicBuild("lib/audit/proxy-resolver.ts#resolveProxyGraph");
}
