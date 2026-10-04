// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { rpc } from "../rpc/client";

import { currentScanContext } from "../observability/context";

export type EntityKind = "EOA" | "WALLET_7702" | "CONTRACT";

export function codeKind(code: string | null | undefined): EntityKind {
  throw new NotImplementedInPublicBuild("lib/scanner/entity.ts#codeKind");
}

export const isWalletKind = (kind: EntityKind): boolean => {
  throw new NotImplementedInPublicBuild("lib/scanner/entity.ts#isWalletKind");
};

export function subjectNoun(kind: EntityKind | null): string {
  throw new NotImplementedInPublicBuild("lib/scanner/entity.ts#subjectNoun");
}

type GetCodeReader = (address: `0x${string}`) => Promise<string | null | undefined>;

export function _mockGetCode(reader: GetCodeReader | null): void {
  throw new NotImplementedInPublicBuild("lib/scanner/entity.ts#_mockGetCode");
}

export async function classifyAddress(addr: string): Promise<EntityKind | null> {
  throw new NotImplementedInPublicBuild("lib/scanner/entity.ts#classifyAddress");
}

export const CODE_PROBE_RUNTIME = "0x60005b368110600d57366000f35b8035803b60181b82526003600083601d01833c50602001600256" as const;

export function probeWordKind(word: bigint): EntityKind {
  throw new NotImplementedInPublicBuild("lib/scanner/entity.ts#probeWordKind");
}

type CodeBatchReader = (addrs: readonly `0x${string}`[]) => Promise<`0x${string}` | undefined>;

export function _mockCodeBatch(reader: CodeBatchReader | null): void {
  throw new NotImplementedInPublicBuild("lib/scanner/entity.ts#_mockCodeBatch");
}

export async function classifyAddresses(addrs: readonly string[]): Promise<Record<string, EntityKind>> {
  throw new NotImplementedInPublicBuild("lib/scanner/entity.ts#classifyAddresses");
}

export async function filterPoolCandidates(addrs: readonly string[]): Promise<string[]> {
  throw new NotImplementedInPublicBuild("lib/scanner/entity.ts#filterPoolCandidates");
}

export interface Subject {
  readonly address: string;
  readonly kind: EntityKind | null;
}

export function subjectFrom(address: string, kind: EntityKind | "UNREADABLE" | null | undefined): Subject {
  throw new NotImplementedInPublicBuild("lib/scanner/entity.ts#subjectFrom");
}

export async function classifySubject(address: string): Promise<Subject> {
  throw new NotImplementedInPublicBuild("lib/scanner/entity.ts#classifySubject");
}

export function subjectNounOf(subject: Subject): string {
  throw new NotImplementedInPublicBuild("lib/scanner/entity.ts#subjectNounOf");
}