// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { accessControlAbi, ownableAbi, timelockAbi } from "../rpc/abis";

import { auditCallKey, type AuditClient, type AuditReadContext } from "./read-context";

import type {
  AuthorityKind,
  AuthorityResolution,
  Capability,
  CapabilityFinding,
  SafeResolution,
} from "./types";

export interface OwnableRead {
  /** True only when `owner()` itself succeeded (no revert/timeout). */
  resolved: boolean;
  owner: string | null;
  pendingOwner: string | null;
}

export interface AccessControlRead {
  /** True only when `DEFAULT_ADMIN_ROLE()` succeeded. */
  resolved: boolean;
  defaultAdminRole: string | null;
  /** `getRoleAdmin(DEFAULT_ADMIN_ROLE)`; null if that specific call failed. */
  roleAdmin: string | null;
}

export interface TimelockRead {
  /** True only when `getMinDelay()` succeeded. */
  resolved: boolean;
  minDelaySeconds: number | null;
}

export interface AuthorityRawReads {
  ownable: OwnableRead;
  accessControl: AccessControlRead;
  /** `getMinDelay()` probed against whichever address `ownable.owner` resolved to; null if never attempted. */
  ownerTimelock: TimelockRead | null;
  /** `owner()`/`pendingOwner()` probed against the optional `beaconAddress`; null if never attempted. */
  beaconOwner: OwnableRead | null;
}

export function decideAuthorities(capabilities: readonly CapabilityFinding[], raw: AuthorityRawReads, proxyAdmin: string | null, safe: SafeResolution | null): AuthorityResolution[] {
  throw new NotImplementedInPublicBuild("lib/audit/authority-resolver.ts#decideAuthorities");
}

export async function resolveAuthority(ctx: AuditReadContext, address: string, capabilities: readonly CapabilityFinding[], proxyAdmin: string | null, safe: SafeResolution | null, beaconAddress?: string | null): Promise<AuthorityResolution[]> {
  throw new NotImplementedInPublicBuild("lib/audit/authority-resolver.ts#resolveAuthority");
}