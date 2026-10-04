import { explorerFetch } from "./http";
import type { ExplorerAdapter } from "./adapter";

// Base URL for robinscan API. Configurable via EXPLORER_ROBINSCAN_URL if this graduates past an experiment.
const ROBINSCAN_API_URL = process.env.EXPLORER_ROBINSCAN_URL || "https://robinscan.io/api";

export const deps = {
  get: <T>(path: string, opts?: { domain?: "scoring" | "shadow-audit" }): Promise<T | null> => {
    return explorerFetch<T>("robinscan", ROBINSCAN_API_URL, path, opts);
  }
};

interface RawRobinscanAddress {
  address?: string;
  isContract?: boolean;
  balance?: string;
  txCount?: number;
  firstSeen?: string;
  lastSeen?: string;
  contractCreator?: string;
  contractCreationTx?: string;
  isVerified?: boolean;
  implementation?: string;
  lastBalanceUpdateBlock?: number;
  tokenTransfersCount?: number;
}

interface RawRobinscanToken {
  address?: string;
  name?: string;
  symbol?: string;
  decimals?: number;
  totalSupply?: string;
  tokenType?: string;
  holderCount?: number;
  transferCount?: number;
  priceUsd?: number;
  marketCapUsd?: number;
}

interface RawRobinscanHolder {
  holder?: string;
  holderName?: string;
  amount?: string;
  balance?: string;
  share?: number;
  valueUsd?: number;
}

interface RawRobinscanHoldersResponse {
  items?: RawRobinscanHolder[];
  total?: number;
  page?: number;
  pageSize?: number;
  status?: string;
}

interface RawRobinscanTx {
  hash?: string;
  blockNumber?: number;
  from?: string;
  to?: string;
  value?: string;
  method?: string;
  timestamp?: string;
  status?: string;
  input?: string;
  logs?: unknown[];
}

export const robinscanAdapter: ExplorerAdapter = {
  id: "robinscan",
  capabilities: {
    methods: ["addressInfo", "tokenInfo", "tokenHolders", "transaction"],
  },
  
  addressInfo: async (address: string) => {
    const raw = await deps.get<RawRobinscanAddress>(`/addresses/${address}`);
    if (!raw) return null;
    return {
      is_contract: raw.isContract,
      is_verified: raw.isVerified,
      creation_tx_hash: raw.contractCreationTx,
      creator_address_hash: raw.contractCreator,
      // is_scam and public_tags are intentionally left undefined as Robinscan doesn't provide them
    };
  },

  tokenInfo: async (address: string) => {
    const raw = await deps.get<RawRobinscanToken>(`/tokens/${address}`);
    if (!raw) return null;
    return {
      name: raw.name,
      symbol: raw.symbol,
      holders: raw.holderCount !== undefined ? String(raw.holderCount) : undefined,
      total_supply: raw.totalSupply,
      decimals: raw.decimals !== undefined ? String(raw.decimals) : undefined,
    };
  },

  tokenHolders: async (address: string) => {
    // Default pageSize to 50 to match Blockscout's typical single-page holder count
    const raw = await deps.get<RawRobinscanHoldersResponse>(`/tokens/${address}/holders?page=1&pageSize=50`);
    if (!raw || !raw.items) return null;
    return {
      items: raw.items.map((item) => ({
        address: { hash: item.holder ?? "" },
        value: item.balance ?? "0",
        label: item.holderName,
        shareOfSupply: item.share,
        valueUsd: item.valueUsd,
      })),
    };
  },

  addressTxs: async () => null,
  addressTxHistory: async () => null,
  // Not advertised in `capabilities.methods`, so the router never picks
  // robinscan for this. null is the honest "could not look", never an empty
  // history — the caller reads that difference (CLAUDE.md §4).
  addressTxWindowAsc: async () => null,
  addressInternalTxWindowAsc: async () => null,
  smartContract: async () => null,
  verificationDetail: async () => null,
  smartContractFull: async () => null,

  transaction: async (hash: string) => {
    const raw = await deps.get<RawRobinscanTx>(`/txs/${hash}`);
    if (!raw) return null;
    return {
      hash: raw.hash ?? hash,
      method: raw.method ?? null,
      timestamp: raw.timestamp,
      from: raw.from ? { hash: raw.from } : null,
      to: raw.to ? { hash: raw.to } : null,
      value: raw.value,
      block_number: raw.blockNumber,
      status: raw.status,
    };
  },
};
