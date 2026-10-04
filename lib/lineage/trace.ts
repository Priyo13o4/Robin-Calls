// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { explorer, type ExplorerTx } from "../explorer/blockscout";

import { lineageConfig, MIN_FUNDING_WEI } from "../config/lineage";

import type { LineageEdge } from "../types";

import { SHARED_FUNDER_MAX_FUNDEES } from "../scanner/checks/subject-origin";

import type { LineageAssessment } from "../scanner/checks";

import {
  cacheEdgeRecord,
  readActiveStainFor,
  readWalletFanOut,
  isConfirmedRuggerRecord,
  type ActiveStainRow,
} from "../data/lineage";

export interface FunderInfo {
  funder: string;
  txHash: string;
  block: number | null;
  valueEth: number | null;
  /**
   * WHICH inference named this address (L71). `gas-parent` is the strong claim:
   * the earliest qualifying inbound BEFORE the wallet's first outbound, i.e. the
   * money that bankrolled everything it went on to do. `largest-inbound` is the
   * fallback and carries no time discipline at all — the transfer it picks may
   * have arrived long AFTER the contracts were deployed, so it is evidence of a
   * counterparty, not of who funded the launch.
   *
   * The Wanted board renders this as "FUNDED BY" against a named third party.
   * Two claims of different strength must not reach a reader looking identical
   * (§9 — label the layer).
   */
  via: "gas-parent" | "largest-inbound";
}

export async function findFunder(address: string): Promise<FunderInfo | null> {
  throw new NotImplementedInPublicBuild("lib/lineage/trace.ts#findFunder");
}

export async function resolveSelfPayingConstructor(found: FunderInfo, internalInbound: ExplorerTx[], addressInfo: (a: string) => Promise<{ creation_tx_hash?: string; creation_transaction_hash?: string; creator_address_hash?: string } | null> = undefined as any): Promise<FunderInfo> {
  throw new NotImplementedInPublicBuild("lib/lineage/trace.ts#resolveSelfPayingConstructor");
}

export function selectFunder(incomingItems: ExplorerTx[], outgoingItems: ExplorerTx[], address: string): FunderInfo | null {
  throw new NotImplementedInPublicBuild("lib/lineage/trace.ts#selectFunder");
}

export function selectEarliestFunder(incomingItems: ExplorerTx[], outgoingItems: ExplorerTx[], address: string): FunderInfo | null {
  throw new NotImplementedInPublicBuild("lib/lineage/trace.ts#selectEarliestFunder");
}

export async function cacheEdge(funder: string, fundee: string, info: { txHash: string; block: number | null; valueEth: number | null }): Promise<void> {
  throw new NotImplementedInPublicBuild("lib/lineage/trace.ts#cacheEdge");
}

interface LineageTraceDeps {
  activeStainFor: (addresses: string[]) => Promise<ActiveStainRow | null>;
  walletFanOut: (address: string) => Promise<number | null>;
  isConfirmedRugger: (address: string) => Promise<boolean>;
  findFunder: (address: string) => Promise<FunderInfo | null>;
  cacheEdge: (
    funder: string,
    fundee: string,
    info: { txHash: string; block: number | null; valueEth: number | null }
  ) => Promise<void>;
  looksFresh: (address: string) => Promise<boolean>;
}

export interface LineageTrace {
  /** False when NOTHING was read: no subject, or the feature is off. */
  traced: boolean;
  lineage: LineageAssessment | null;
}

export async function traceDeployerLineage(deployer: string | null, opts: { liveTrace: boolean } = undefined as any, _deps: Partial<LineageTraceDeps> = undefined as any): Promise<LineageTrace> {
  throw new NotImplementedInPublicBuild("lib/lineage/trace.ts#traceDeployerLineage");
}