// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";
import type { PublicClient } from "viem";
import type { AuditClient } from "./read-context";
import type { ArtifactCacheDeps } from "./artifact-cache";
import type { AuditSmartContract } from "../explorer/types";
import type { ContractAuditResult } from "./types";

export type SourceFetcher = (address: string) => Promise<AuditSmartContract | null>;
export type BrowserAuditClient = AuditClient & Pick<PublicClient, "getBlock">;

export function browserSourceFetcher(_explorerApiUrl: string): SourceFetcher {
  throw new NotImplementedInPublicBuild("lib/audit/client-run.ts#browserSourceFetcher");
}

export function browserArtifactDeps(_fetchArtifact: SourceFetcher): ArtifactCacheDeps {
  throw new NotImplementedInPublicBuild("lib/audit/client-run.ts#browserArtifactDeps");
}

export const CLIENT_ARTIFACT_ID = "client-side:not-persisted";

export async function runBrowserContractAudit(
  _address: string,
  _args: {
    client: BrowserAuditClient;
    explorerApiUrl: string;
    fetchSource?: SourceFetcher;
  },
): Promise<ContractAuditResult> {
  throw new NotImplementedInPublicBuild("lib/audit/client-run.ts#runBrowserContractAudit");
}
