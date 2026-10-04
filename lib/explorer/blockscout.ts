import { explorerApiUrl, explorerFallbackApiUrl } from "../config/chain";
import { explorerFetch, v1Base } from "./http";
import type { ExplorerAdapter } from "./adapter";
import type {
  ExplorerAddressInfo,
  ExplorerTokenInfo,
  ExplorerHolder,
  ExplorerTx,
  ExplorerTxHistory,
  ExplorerVerificationDetail,
  AuditSmartContract,
} from "./types";

export * from "./types";

interface RawSmartContract {
  is_verified?: boolean | null;
  is_partially_verified?: boolean | null;
  is_fully_verified?: boolean | null;
  abi?: unknown[] | null;
  source_code?: string | null;
  additional_sources?: { file_path?: string; source_code?: string }[] | null;
  compiler_version?: string | null;
  optimization_enabled?: boolean | null;
  name?: string | null;
}

interface RawVerificationDetail {
  is_verified?: boolean | null;
  is_fully_verified?: boolean | null;
  is_partially_verified?: boolean | null;
  is_verified_via_eth_bytecode_db?: boolean | null;
  is_verified_via_sourcify?: boolean | null;
}

interface ExplorerTxPage {
  items: ExplorerTx[];
  next_page_params?: Record<string, string | number> | null;
}

/**
 * Every Blockscout read, with the second host as a real failover — not just for
 * the verified-source question (`getVerifiedRow` below).
 *
 * The PRO gateway and the community instance are separate deployments of the
 * same chain, and the gateway's upstream 500s independently: probed 2026-08-26
 * with both PRO keys, `/addresses/:id` returned `{"error":"Internal server
 * error","source":"upstream"}` on one key and a connection failure on the other
 * WHILE `/tokens/:id/holders` served 200 on both, and the community instance
 * served the same `/addresses/:id` with the full 26-key payload. That fault
 * classifies RC_EXPLORER_UNAVAILABLE and ends the scan — so a healthy host sat
 * there unasked while the user got "CHAIN EXPLORER unavailable" (L51).
 *
 * Safe in the direction that matters: this fires only when the primary FAULTED,
 * i.e. when we knew nothing at all, so a second answer can only replace a
 * non-answer. A 404 never reaches here — `explorerFetch` returns null for it,
 * because a 404 is a domain answer and re-asking another host would launder
 * "no such address" into "we could not look" (§4).
 *
 * Costs nothing on the happy path, and cannot leak the PRO credential: the key
 * is attached by origin in `withApiKey`, so the community host is asked unkeyed
 * exactly as it should be.
 */
async function get<T>(path: string, opts?: { domain?: "scoring" | "shadow-audit" }): Promise<T | null> {
  try {
    return await explorerFetch<T>("blockscout", explorerApiUrl, path, opts);
  } catch (primaryFault) {
    const base = verifiedFallbackBase();
    if (!base) throw primaryFault;
    try {
      // Own adapterId so the failover host's health is its own providerStates
      // row — otherwise a working fallback would be invisible and a failing one
      // would be blamed on the primary.
      return await explorerFetch<T>("blockscout-host-fallback", base, path, opts);
    } catch {
      // Rethrow the PRIMARY's fault, never the fallback's: the pipeline's
      // exhaustion latch and error reporting are written about the primary, and
      // swapping in a second host's error would misattribute the outage.
      throw primaryFault;
    }
  }
}

/**
 * Null when the fallback host is the primary — nothing to ask twice. That is
 * the local/dev path, where `EXPLORER_API_URL` is unset and both consts
 * default to the community instance.
 */
export function verifiedFallbackBase(): string | null {
  // Read per call, like gate.ts's concurrency cap, so ops can retune without a
  // restart. Compared against the `explorerApiUrl` CONST rather than its env
  // var, because that const is what `get()` above actually fetches — comparing
  // to anything else could declare the hosts distinct while they are not.
  const fallback = (process.env.EXPLORER_FALLBACK_API_URL ?? explorerFallbackApiUrl).replace(/\/+$/, "");
  return fallback === explorerApiUrl.replace(/\/+$/, "") ? null : fallback;
}

/**
 * A `/smart-contracts` read that asks the fallback host when the primary
 * reports no verified source (see `explorerFallbackApiUrl`).
 *
 * The second call is a REFINEMENT, never an override: it fires only when the
 * primary did not answer `is_verified: true`, and its result is used only when
 * it does. So a fallback outage cannot change what we already knew, and the
 * three outcomes stay distinguishable — a verified row, an explicit
 * `is_verified: false`, and `null` for "neither host could tell us". Collapsing
 * that last one into "unverified" is the §4 error this whole path exists to
 * avoid, so the primary's `null` is returned as `null`.
 */
async function getVerifiedRow<T extends { is_verified?: boolean | null }>(
  path: string,
  opts?: { domain?: "scoring" | "shadow-audit" }
): Promise<T | null> {
  const primary = await get<T>(path, opts);
  if (primary?.is_verified === true) return primary;

  const base = verifiedFallbackBase();
  if (!base) return primary;

  let fallback: T | null = null;
  try {
    // Separate adapterId so the second host's health is its own row in
    // providerStates rather than blamed on the primary.
    fallback = await explorerFetch<T>("blockscout-verified-fallback", base, path, opts);
  } catch {
    // Swallowed deliberately: this call is pure upside, so its failure must
    // cost nothing. An ExplorerFault escaping here would reach the router,
    // count as blockscout failing the method, and could latch
    // `explorer-exhausted:` — voiding a scan that the primary had already
    // answered cleanly. Recorded in providerStates under its own id above.
    return primary;
  }
  return fallback?.is_verified === true ? fallback : primary;
}

/** One row of the Etherscan-compatible `txlist` response. */
interface V1Tx {
  hash?: string;
  from?: string;
  to?: string;
  value?: string;
  blockNumber?: string;
  transactionIndex?: string;
  timeStamp?: string;
  methodId?: string;
}

interface V1TxListResponse {
  status?: string;
  message?: string;
  result?: V1Tx[] | string;
}

/**
 * Map a v1 `txlist` row onto the v2-shaped `ExplorerTx` the lineage logic reads.
 *
 * Every field the selection logic touches is carried across, and `position` in
 * particular is NOT optional in practice: `compareTxOrder` falls back to
 * MAX_SAFE_INTEGER without it, which would silently reorder same-block
 * transactions and could pick the wrong funder out of a block. v1 supplies it
 * as `transactionIndex` (verified against the live gateway).
 */
function fromV1Tx(raw: V1Tx): ExplorerTx {
  const block = Number(raw.blockNumber);
  const position = Number(raw.transactionIndex);
  return {
    hash: raw.hash ?? "",
    method: raw.methodId ?? null,
    timestamp: raw.timeStamp,
    from: raw.from ? { hash: raw.from } : null,
    to: raw.to ? { hash: raw.to } : null,
    value: raw.value,
    block: Number.isFinite(block) ? block : undefined,
    position: Number.isFinite(position) ? position : undefined,
  };
}

/**
 * The OLDEST `limit` transactions for an address, both directions, in one call.
 *
 * Why this exists: `addressTxHistory` below walks the v2 endpoint newest-first,
 * up to 8 sequential pages, purely because the funder is the EARLIEST inbound
 * transfer and v2 offers no ordering control. Measured on prod 2026-08-01 that
 * was 10 calls and 32.9s — 53% of all explorer time in a scan — to answer a
 * question about the first few transactions a wallet ever made. The v1
 * Etherscan-compatible endpoint takes `sort=asc`, so the same answer is one
 * request.
 *
 * `sawWholeHistory` is true only when the response came back short of `limit`,
 * which is the sole proof there is nothing older beyond the window. The caller
 * must not treat a full window as a complete history — see `findFunder`.
 */
async function addressTxWindowAsc(
  address: string,
  limit = 100
): Promise<{ items: ExplorerTx[]; sawWholeHistory: boolean } | null> {
  const q = new URLSearchParams({
    module: "account",
    action: "txlist",
    address,
    sort: "asc",
    page: "1",
    offset: String(limit),
  });
  const res = await explorerFetch<V1TxListResponse>("blockscout", v1Base(), `?${q.toString()}`);
  if (!res) return null;

  // A genuine "no records" answer ships `result: []` WITH `status: "0"` (verified
  // live; same convention lib/explorer/logs.ts relies on), so it is an array and
  // falls through to the map below as an honest empty history.
  //
  // Therefore a non-array `result` is ALWAYS a fault — `{"status":"0",
  // "message":"NOTOK","result":"Max rate limit reached"}` is the shape that gets
  // here — and the only correct answer is null, "we could not look".
  //
  // This branch previously returned `{ items: [], sawWholeHistory: true }` when
  // status was "0", which is the §4 bug this file's own comment warned against:
  // `findFunder` reads `sawWholeHistory` as proof it saw the beginning of the
  // wallet's life, skips its descending fallback, and `checkFundingLineage`
  // publishes a throttled explorer as "Funding lineage is clean."
  if (!Array.isArray(res.result)) return null;
  const rows = res.result;

  return { items: rows.map(fromV1Tx), sawWholeHistory: rows.length < limit };
}

interface V1InternalTx {
  transactionHash?: string;
  from?: string;
  to?: string;
  value?: string;
  blockNumber?: string;
  timeStamp?: string;
  isError?: string;
  type?: string;
}

/**
 * The OLDEST `limit` internal (trace-level) value transfers for an address.
 *
 * A wallet funded by a contract (a disperse call, or a CREATE whose constructor
 * pays out) has no inbound row in `txlist`, so `findFunder` read it as unfunded
 * and the check published "Funding lineage is clean" (ZFORGE #305).
 * `hash` is the PARENT transaction. `position` is left unset: an internal
 * index is not a transaction index, and a wrong one reorders same-block rows.
 * Status "2" ("not yet processed") means the trace index is partial, so it is
 * never a whole history.
 */
async function addressInternalTxWindowAsc(
  address: string,
  limit = 100
): Promise<{ items: ExplorerTx[]; sawWholeHistory: boolean } | null> {
  const q = new URLSearchParams({
    module: "account",
    action: "txlistinternal",
    address,
    sort: "asc",
    page: "1",
    offset: String(limit),
  });
  const res = await explorerFetch<{ status?: string; message?: string; result?: V1InternalTx[] | string }>(
    "blockscout",
    v1Base(),
    `?${q.toString()}`
  );
  if (!res || !Array.isArray(res.result)) return null;
  const rows = res.result;
  const items = rows
    .filter((r) => r.isError !== "1")
    .map((r): ExplorerTx => {
      const block = Number(r.blockNumber);
      return {
        hash: r.transactionHash ?? "",
        method: null,
        timestamp: r.timeStamp,
        from: r.from ? { hash: r.from } : null,
        to: r.to ? { hash: r.to } : null,
        value: r.value,
        block: Number.isFinite(block) ? block : undefined,
      };
    });
  return { items, sawWholeHistory: rows.length < limit && res.status !== "2" };
}

async function addressTxHistory(
  address: string,
  filter: "to" | "from",
  maxPages = 8
): Promise<ExplorerTxHistory | null> {
  const items: ExplorerTx[] = [];
  let cursor: Record<string, string | number> | null = null;

  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({ filter });
    for (const [key, value] of Object.entries(cursor ?? {})) params.set(key, String(value));
    const result = await get<ExplorerTxPage>(
      `/addresses/${address}/transactions?${params.toString()}`
    );
    if (!result) return null;
    items.push(...(result.items ?? []));
    cursor = result.next_page_params ?? null;
    if (!cursor) return { items, complete: true };
  }

  return { items, complete: false };
}

export const blockscoutAdapter: ExplorerAdapter = {
  id: "blockscout",
  capabilities: {
    methods: [
      "addressInfo",
      "tokenInfo",
      "tokenHolders",
      "addressTxs",
      "addressTxHistory",
      "addressTxWindowAsc",
      "addressInternalTxWindowAsc",
      "smartContract",
      "verificationDetail",
      "smartContractFull",
      "transaction",
    ],
  },
  addressInfo: (address: string) =>
    get<ExplorerAddressInfo>(`/addresses/${address}`),

  tokenInfo: (address: string) =>
    get<ExplorerTokenInfo>(`/tokens/${address}`),

  tokenHolders: (address: string) =>
    get<{ items: ExplorerHolder[] }>(`/tokens/${address}/holders`),

  addressTxs: (address: string) =>
    get<{ items: ExplorerTx[] }>(`/addresses/${address}/transactions?filter=from`),

  addressTxHistory,
  addressTxWindowAsc,
  addressInternalTxWindowAsc,

  smartContract: (address: string) =>
    getVerifiedRow<{ is_verified?: boolean; source_code?: string | null }>(
      `/smart-contracts/${address}`
    ),

  verificationDetail: async (address: string): Promise<ExplorerVerificationDetail | null> => {
    const raw = await getVerifiedRow<RawVerificationDetail>(`/smart-contracts/${address}`, {
      domain: "shadow-audit",
    });
    if (!raw || raw.is_verified !== true) return null;
    return {
      isVerified: true,
      isFullyVerified: raw.is_fully_verified === true,
      isPartiallyVerified: raw.is_partially_verified === true,
      // Absent means the explorer did not say; only an explicit boolean is an answer.
      ...(typeof raw.is_verified_via_eth_bytecode_db === "boolean" ? { viaBytecodeDb: raw.is_verified_via_eth_bytecode_db } : {}),
      ...(typeof raw.is_verified_via_sourcify === "boolean" ? { viaSourcify: raw.is_verified_via_sourcify } : {}),
    };
  },

  smartContractFull: async (address: string): Promise<AuditSmartContract | null> => {
    const raw = await getVerifiedRow<RawSmartContract>(`/smart-contracts/${address}`, {
      domain: "shadow-audit",
    });
    if (!raw) return null;
    return {
      is_verified: raw.is_verified ?? false,
      // Absent means the explorer did not say, which is not the same as "no".
      // `?? null` rather than `=== true`: this pair has to be able to report
      // that it does not know, or the audit would read silence as a full match.
      is_partially_verified: raw.is_partially_verified ?? null,
      is_fully_verified: raw.is_fully_verified ?? null,
      abi: Array.isArray(raw.abi) ? raw.abi : null,
      source_code: typeof raw.source_code === "string" ? raw.source_code : null,
      additional_sources: Array.isArray(raw.additional_sources)
        ? raw.additional_sources
            .filter((s): s is { file_path: string; source_code: string } =>
              typeof s?.file_path === "string" && typeof s?.source_code === "string"
            )
        : [],
      compiler_version: typeof raw.compiler_version === "string" ? raw.compiler_version : null,
      optimization_enabled:
        typeof raw.optimization_enabled === "boolean" ? raw.optimization_enabled : null,
      name: typeof raw.name === "string" && raw.name ? raw.name : null,
    };
  },

  // `from` is the EOA that sent the transaction — for a token created through a
  // factory, the only on-chain trace of WHO launched it (item 7).
  transaction: (hash: string) =>
    get<{ timestamp?: string; from?: { hash?: string } | null }>(`/transactions/${hash}`),
};

export const LIQUIDITY_PULL_METHODS = new Set([
  "removeLiquidity",
  "removeLiquidityETH",
  "removeLiquidityWithPermit",
  "removeLiquidityETHWithPermit",
  "decreaseLiquidity",
]);

export const TAX_TOGGLE_METHODS = new Set([
  "setFee",
  "setFees",
  "setTaxes",
  "setTax",
  "setBuyTax",
  "setSellTax",
  "setMaxTxAmount",
  "setMaxWallet",
  "setLimits",
  "removeLimits",
  "updateFees",
  "enableTrading",
  "setSwapAndLiquifyEnabled",
]);

export { explorer } from "./router";
