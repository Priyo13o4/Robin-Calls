// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { decodeEventLog, toEventSelector, type Hex, type PublicClient } from "viem";

import { fetchLogs, ingestWindowCap, type RawLog } from "@/lib/launches/ingest";

import { CURVE_BUY } from "@/lib/launches/modules/pons-v2";

import { BOUGHT } from "@/lib/launches/modules/flap-v1";

export const CURVE_BUY_TOPIC = toEventSelector(CURVE_BUY).toLowerCase();

export const FLAP_BUY_TOPIC = toEventSelector(BOUGHT).toLowerCase();

export function blockClusters(blocks: readonly number[], width: any = undefined as any): [number, number][] {
  throw new NotImplementedInPublicBuild("lib/sequencer/launch-buys.ts#blockClusters");
}

export async function fetchCurveBuys(client: PublicClient, launches: readonly { curve: string; block: number }[]): Promise<RawLog[]> {
  throw new NotImplementedInPublicBuild("lib/sequencer/launch-buys.ts#fetchCurveBuys");
}

export type LaunchTxBuy = { buyer: string | null; recipient: string | null; quoteIn: string };

export function curveBuysByTx(logs: readonly RawLog[]): Map<string, { curve: string; buy: LaunchTxBuy }[]> {
  throw new NotImplementedInPublicBuild("lib/sequencer/launch-buys.ts#curveBuysByTx");
}