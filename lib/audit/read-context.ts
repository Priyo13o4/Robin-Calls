// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";
import type { ChainReader } from "../rpc/client";

export { isMissingBlockStateError } from "../rpc/fault";

export interface PinnedBlock {
  number: bigint;
  hash: `0x${string}`;
}

export interface PinState {
  active: boolean;
  degradedReason: string | null;
}

export interface AuditReadContext {
  block: PinnedBlock;
  pin: PinState;
  ruleVersion: string;
  call<T>(key: string, fn: () => Promise<T>): Promise<T>;
  client: AuditClient;
}

export type AuditClient = ChainReader;

export function auditCallKey(
  _method: string,
  _target: string,
  _extra?: string | number | bigint,
): string {
  throw new NotImplementedInPublicBuild("lib/audit/read-context.ts#auditCallKey");
}

export function pinReads(
  _client: AuditClient,
  _block: PinnedBlock,
  _pin: PinState,
): AuditClient {
  throw new NotImplementedInPublicBuild("lib/audit/read-context.ts#pinReads");
}

export function buildReadContext(
  _ruleVersion: string,
  _block: PinnedBlock,
  _client: AuditClient,
): AuditReadContext {
  throw new NotImplementedInPublicBuild("lib/audit/read-context.ts#buildReadContext");
}
