export interface ExplorerTokenInfo {
  name?: string;
  symbol?: string;
  holders?: string;
  total_supply?: string;
  decimals?: string;
}

export interface ExplorerAddressInfo {
  is_contract?: boolean;
  is_verified?: boolean;
  is_scam?: boolean;
  creation_tx_hash?: string;
  /** Newer Blockscout versions renamed creation_tx_hash to this. */
  creation_transaction_hash?: string;
  creator_address_hash?: string;
  // Blockscout tags scams via public/private tags
  public_tags?: { display_name?: string; label?: string }[];
  private_tags?: unknown[];
  /**
   * Proxy standard Blockscout detected ("eip1167", "eip1967", "eip2535", …),
   * null for a plain contract. Already present in the cached payload — the
   * cache stores the raw response as jsonb, so this exposes data we hold
   * rather than costing a read.
   */
  proxy_type?: string | null;
  /** Implementation(s) behind a proxy. Absent is unknown, `[]` is "none". */
  implementations?: { address_hash?: string; name?: string | null }[];
}

export interface ExplorerVerificationDetail {
  isVerified: boolean;
  isFullyVerified: boolean;
  isPartiallyVerified: boolean;
  /**
   * True when Blockscout took this source from the shared Ethereum Bytecode
   * Database — i.e. from a DIFFERENT address that compiled to the same code.
   * Independent of full-vs-partial: a FULL match can still be borrowed
   * (LadyMarian, live 2026-08-17), and "exact match" said about borrowed source
   * overstates what was proven about THIS address (§9).
   *
   * REST `/smart-contracts` answers it (`is_verified_via_eth_bytecode_db`);
   * `undefined` means the explorer did not say, which is not the same as `false`.
   */
  viaBytecodeDb?: boolean;
  viaSourcify?: boolean;
}

export interface AuditSmartContract {
  is_verified: boolean;
  /**
   * Blockscout's own qualifier on `is_verified`, and it is NOT a detail.
   *
   * `is_verified` is true for both a full match and a partial one, so reading
   * it alone answers "is there source?" when the question the audit is asking
   * is "is this source provably THIS contract's?". A partial match means the
   * runtime bytecode lines up but the metadata hash does not — most often
   * because Blockscout pulled the source out of `eth_bytecode_db` from some
   * OTHER address that compiled to the same code. That is real evidence and it
   * is weaker evidence, and the difference is exactly the kind a verdict must
   * not silently absorb (§9: a partial result is not a fact).
   *
   * Null when the explorer did not say — unknown, never assumed full.
   */
  is_partially_verified: boolean | null;
  /** True only on an exact metadata match. Null when the explorer did not say. */
  is_fully_verified: boolean | null;
  abi: unknown[] | null;
  source_code: string | null;
  additional_sources: { file_path: string; source_code: string }[];
  compiler_version: string | null;
  optimization_enabled: boolean | null;
  /** Verified contract's declared name — scopes capability classification to this contract + its inheritance chain (M8 handoff issue #4). */
  name: string | null;
}

export interface ExplorerHolder {
  address: { hash: string };
  value: string;
  label?: string;
  shareOfSupply?: number;
  valueUsd?: number;
}

export interface ExplorerTx {
  hash: string;
  method: string | null;
  timestamp?: string;
  from?: { hash: string } | null;
  to?: { hash: string } | null;
  value?: string; // native value in wei (string)
  block?: number;
  block_number?: number;
  position?: number;
  status?: string;
}

export interface ExplorerTxHistory {
  items: ExplorerTx[];
  /** False means the safety cap was reached and older transactions may exist. */
  complete: boolean;
}
