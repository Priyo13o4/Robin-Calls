import type {
  ExplorerAddressInfo,
  ExplorerTokenInfo,
  ExplorerHolder,
  ExplorerTx,
  ExplorerTxHistory,
  ExplorerVerificationDetail,
  AuditSmartContract,
} from "./types";

export type ExplorerMethod =
  | "addressInfo"
  | "tokenInfo"
  | "tokenHolders"
  | "addressTxs"
  | "addressTxHistory"
  | "addressTxWindowAsc"
  | "addressInternalTxWindowAsc"
  | "smartContract"
  | "verificationDetail"
  | "smartContractFull"
  | "transaction";

export interface ExplorerCapabilities {
  /** The methods this adapter is capable of handling. */
  methods: ExplorerMethod[];
}

export interface ExplorerAdapter {
  id: string;
  capabilities: ExplorerCapabilities;

  addressInfo(address: string): Promise<ExplorerAddressInfo | null>;
  tokenInfo(address: string): Promise<ExplorerTokenInfo | null>;
  tokenHolders(address: string): Promise<{ items: ExplorerHolder[] } | null>;
  addressTxs(address: string): Promise<{ items: ExplorerTx[] } | null>;
  addressTxHistory(address: string, filter: "to" | "from", maxPages?: number): Promise<ExplorerTxHistory | null>;
  /**
   * Oldest-first transaction window, both directions, in ONE request.
   * `sawWholeHistory` is true only when the response was SHORT of `limit` — the
   * only proof nothing older exists beyond the window.
   */
  addressTxWindowAsc(
    address: string,
    limit?: number
  ): Promise<{ items: ExplorerTx[]; sawWholeHistory: boolean } | null>;
  /** Oldest-first internal value transfers; `hash` is the parent transaction. */
  addressInternalTxWindowAsc(
    address: string,
    limit?: number
  ): Promise<{ items: ExplorerTx[]; sawWholeHistory: boolean } | null>;
  smartContract(address: string): Promise<{ is_verified?: boolean; source_code?: string | null } | null>;
  verificationDetail(address: string): Promise<ExplorerVerificationDetail | null>;
  smartContractFull(address: string): Promise<AuditSmartContract | null>;
  /**
   * `from` is the sender. Declared optional because robinscan's `/txs/:hash`
   * has no such field — an adapter that cannot answer must leave it undefined
   * rather than null, so the router can tell "no sender" from "not asked".
   */
  transaction(hash: string): Promise<{ timestamp?: string; from?: { hash?: string } | null } | null>;
}
