// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import type { OriginVia } from "../launch-origin";

import { ScanContext } from "./shared";

import { SHARED_LAUNCHER_MAX_LAUNCHES } from "../launch-origin";

export const NPM_ENUM_BUDGET = 12n;

export const LAUNCHPAD_BOOK_SIZE = 50n;

export function deployerIsShared(ctx: Pick<ScanContext, "deployerKind">): boolean {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/subject-origin.ts#deployerIsShared");
}

export function historySubject(ctx: Pick<ScanContext, "deployerAddress" | "deployerKind" | "launchOrigin" | "creatorLaunchCount">): { address: string; via: "creator" | OriginVia } | null {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/subject-origin.ts#historySubject");
}

export function launchSideSenders(ctx: Pick<ScanContext, "deployerAddress" | "deployerKind" | "launchOrigin">): Set<string> {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/subject-origin.ts#launchSideSenders");
}

export function pullLaunchSender(ctx: Pick<ScanContext, "launchOrigin">): string | null {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/subject-origin.ts#pullLaunchSender");
}

export function subjectEvidence(ctx: ScanContext, subject: { address: string; via: string }): Record<string, unknown> {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/subject-origin.ts#subjectEvidence");
}

export const INAPPLICABLE_SKIP = { skipKind: "inapplicable" } as const;

export { SHARED_FUNDER_MAX_FUNDEES } from "../../config/lineage";

export function noSubjectEvidence(ctx: ScanContext): Record<string, unknown> {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/subject-origin.ts#noSubjectEvidence");
}

export function unattributedOriginNote(ctx: ScanContext): string {
  throw new NotImplementedInPublicBuild("lib/scanner/checks/subject-origin.ts#unattributedOriginNote");
}