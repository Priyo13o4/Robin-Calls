// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



export interface RpcSpendRow {
  job: string;
  calls: number;
  errors: number;
  /** Null until the window holds an `rpc_cu` row: a job recorded before CU accounting reads "—", never 0. */
  cu: number | null;
  providers: { id: string; calls: number }[];
}

type MetricRow = { provider: string; event: string; reason: string; count: number; credits: number };

export function summarizeRpcSpend(rows: readonly MetricRow[]): RpcSpendRow[] {
  throw new NotImplementedInPublicBuild("lib/sequencer/spend-summary.ts#summarizeRpcSpend");
}