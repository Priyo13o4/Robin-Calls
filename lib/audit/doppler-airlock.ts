// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";
import type { AuditReadContext } from "./read-context";
import type { AuthorityResolution } from "./types";

export const DOPPLER_AIRLOCK = "0xeb7c034704ef8dcd2d32324c1545f62fb4ad0862";

export const isDeadOrZero = (_a: string | null | undefined): boolean => {
  throw new NotImplementedInPublicBuild("lib/audit/doppler-airlock.ts#isDeadOrZero");
};

export async function refineAirlockAuthority(
  _ctx: AuditReadContext,
  _token: string,
  _authorities: AuthorityResolution[],
): Promise<AuthorityResolution[]> {
  throw new NotImplementedInPublicBuild("lib/audit/doppler-airlock.ts#refineAirlockAuthority");
}
