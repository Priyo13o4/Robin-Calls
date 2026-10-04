import { decodeEventLog, encodeEventTopics, type AbiEvent } from "viem";
import {
  emitProgress,
  explorerFaulted,
  recordExplorerCall,
  recordProviderState,
} from "../observability/context";
import { reportError } from "../observability/reporter";
import { planExplorerRetry } from "./retry";
import { withExplorerSlot } from "./gate";
import { accountBlockscoutHttpAttempt, v1Base, withApiKey } from "./http";

/**
 * Indexed log reads via the explorer's Etherscan-compatible logs API.
 *
 * WHY THIS EXISTS: an RPC node answers `eth_getLogs` by walking blocks, so a
 * full-history read gets slower every day on a chain minting ~10 blocks/s —
 * verified live: the public RPC served `fromBlock:0` in 0.39s at head ~10.7M
 * and returns `-32000 log query timed out` at head ~11.5M. The explorer is an
 * INDEXER: the same query is a database lookup for it, so range size is
 * irrelevant (verified: genesis→head, topic-filtered, 1.4s, at the same head
 * the RPC refused). This module is the primary full-history source for
 * lib/rpc/log-index; the RPC tiers behind it remain as fallbacks because the
 * explorer is a single point of failure that has had real outages.
 *
 * Contract mirrors lib/explorer/blockscout.ts: null means "the source could
 * not answer", never "no logs" — an empty history is `[]`. The caller must
 * treat null as fall-through, not as evidence.
 */

/** One decoded log, shaped like viem's getLogs output where call sites look. */
export interface DecodedExplorerLog {
  args: unknown;
  blockNumber: bigint;
  transactionHash: `0x${string}`;
  logIndex: number;
}

interface RawExplorerLog {
  topics?: (string | null)[];
  data?: string;
  blockNumber?: string;
  transactionHash?: string;
  logIndex?: string;
}

interface V1LogsResponse {
  status?: string;
  message?: string;
  result?: unknown;
}

/** Blockscout caps one response at this many records; more means paginate. */
const PAGE_LIMIT = 1000;
/**
 * Pages before giving up (≈30k logs). Our queries are per-token/per-pool event
 * streams — a verified whole-pool lifetime is ~200 events — so hitting this cap
 * means the filter is wrong or the subject is pathological; either way a
 * truncated "complete" history must not be cached, so the read returns null.
 */
const MAX_PAGES = 30;

const hex = (v: string | undefined): bigint | null => {
  if (!v) return null;
  try {
    return BigInt(v);
  } catch {
    return null;
  }
};

async function getLogsPage(url: string): Promise<V1LogsResponse | null> {
  // Circuit breaker: this scan's verdict is already void once any explorer
  // read has faulted (pipeline.ts's hard gate), so a later page — same query
  // or a different one entirely — skips straight to null instead of paying
  // its own timeout and retry for an answer that will be thrown away.
  if (explorerFaulted()) return null;
  // A4: one process-wide explorer slot for this page fetch (held through A3's
  // backoff), so concurrent per-pool log indexes can't burst the Blockscout
  // budget. Pages within one query are already sequential; this caps the fan-out
  // ACROSS queries.
  // Instrumented like every other explorer read (it was NOT before, so log
  // paging — the single heaviest explorer consumer on a cold index — was
  // invisible in explorerWallMs and the totals understated it to zero).
  return withExplorerSlot(async (queuedMs) => {
    const startedAt = Date.now();
    try {
      return await fetchPage();
    } finally {
      recordExplorerCall("/api?module=logs", queuedMs, Date.now() - startedAt);
    }

    async function fetchPage(): Promise<V1LogsResponse | null> {
    for (let attempt = 1; ; attempt++) {
      try {
        const attemptStartedAt = Date.now();
        let res: Response;
        try {
          res = await fetch(url, {
            headers: { accept: "application/json" },
            cache: "no-store",
            signal: AbortSignal.timeout(20_000),
          });
        } catch (error) {
          await accountBlockscoutHttpAttempt({ requestUrl: url, adapterId: "blockscout", domain: "scoring", endpoint: "/api?module=logs&action=getLogs", outcome: "transport_error", latencyMs: Date.now() - attemptStartedAt });
          throw error;
        }
        await accountBlockscoutHttpAttempt({ requestUrl: url, adapterId: "blockscout", domain: "scoring", endpoint: "/api?module=logs&action=getLogs", outcome: `http_${res.status}`, latencyMs: Date.now() - attemptStartedAt });
        if (!res.ok) {
          // 429 gets the Retry-After-aware, seconds-scale policy (A3): a transient
          // throttle is waited out; only a persistent one falls through and trips
          // the explorerFaulted() latch below.
          const plan = planExplorerRetry({
            status: res.status,
            attempt,
            retryAfter: res.headers.get("retry-after"),
            nowMs: Date.now(),
          });
          if (plan.retry) {
            emitProgress({ type: "retry", source: "explorer", detail: "retrying explorer logs" });
            await new Promise((r) => setTimeout(r, plan.delayMs));
            continue;
          }
          recordProviderState("explorer:logs", res.status === 429 ? "RATE_LIMITED" : "ERROR");
          await reportError({
            code: "RC_EXPLORER_UNAVAILABLE",
            message: `explorer logs API returned ${res.status}${attempt > 1 ? ` (after ${attempt} attempts)` : ""}`,
            operation: "explorer.getLogs",
            httpStatus: res.status,
            requestOutcome: "degraded",
          });
          return null;
        }
        recordProviderState("explorer:logs", "OK");
        return (await res.json()) as V1LogsResponse;
      } catch (error) {
        const plan = planExplorerRetry({ status: undefined, attempt, nowMs: Date.now() });
        if (plan.retry) {
          emitProgress({ type: "retry", source: "explorer", detail: "retrying explorer logs" });
          await new Promise((r) => setTimeout(r, plan.delayMs));
          continue;
        }
        const timeout = error instanceof Error && error.name === "TimeoutError";
        recordProviderState("explorer:logs", timeout ? "TIMEOUT" : "ERROR");
        await reportError({
          code: "RC_EXPLORER_UNAVAILABLE",
          message: `explorer logs API ${timeout ? "timed out" : "was unreachable"} (after ${attempt} attempts)`,
          operation: "explorer.getLogs",
          error,
          requestOutcome: "degraded",
        });
        return null;
      }
    }
    }
  });
}

/**
 * Topic-filtered, full-range log read against the explorer's index, decoded to
 * viem-shaped logs. Same (address, event, args) semantics as
 * `client.getLogs(...)` so a call site can feed both sources through one
 * mapping function.
 *
 * Pagination: Blockscout returns at most 1000 records per response with no
 * cursor, so a full page re-queries from the last block seen (inclusive —
 * a block's logs can straddle the cut) and dedupes on (txHash, logIndex).
 */
export async function explorerGetLogs(params: {
  address: `0x${string}`;
  event: AbiEvent;
  args?: Record<string, unknown>;
  fromBlock: bigint;
  toBlock: bigint;
}): Promise<DecodedExplorerLog[] | null> {
  let topics: (string | null)[];
  try {
    topics = encodeEventTopics({
      abi: [params.event],
      eventName: params.event.name,
      args: params.args as never,
    }) as (string | null)[];
  } catch {
    return null; // a filter we cannot encode is a bug, not an outage — degrade
  }

  const out: DecodedExplorerLog[] = [];
  const seen = new Set<string>();
  let from = params.fromBlock;

  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({
      module: "logs",
      action: "getLogs",
      fromBlock: from.toString(),
      toBlock: params.toBlock.toString(),
      address: params.address,
    });
    const present: number[] = [];
    topics.forEach((t, i) => {
      if (t) {
        q.set(`topic${i}`, t);
        present.push(i);
      }
    });
    // Etherscan-style APIs require an explicit AND between each topic pair.
    for (let a = 0; a < present.length; a++) {
      for (let b = a + 1; b < present.length; b++) {
        q.set(`topic${present[a]}_${present[b]}_opr`, "and");
      }
    }

    const res = await getLogsPage(withApiKey(`${v1Base()}?${q.toString()}`));
    if (!res) return null;
    if (res.status !== "1") {
      // An empty history is a real answer, delivered as status 0 by API
      // convention — Etherscan says "No records found", Blockscout "No logs
      // found", and both ship an empty result array (verified live). A status-0
      // with a non-empty/non-array result is an actual fault.
      if (
        /no (records|logs) found/i.test(res.message ?? "") ||
        (Array.isArray(res.result) && res.result.length === 0)
      ) {
        return out; // nothing (more) matched — the history read is complete
      }
      recordProviderState("explorer:logs", "ERROR");
      return null;
    }
    const rows = Array.isArray(res.result) ? (res.result as RawExplorerLog[]) : null;
    if (!rows) return null;

    let pageMaxBlock = from;
    for (const raw of rows) {
      const blockNumber = hex(raw.blockNumber);
      const logIndex = hex(raw.logIndex);
      const txHash = raw.transactionHash;
      if (blockNumber === null || logIndex === null || !txHash) continue;
      if (blockNumber > pageMaxBlock) pageMaxBlock = blockNumber;
      const key = `${txHash}:${logIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const rawTopics = (raw.topics ?? []).filter((t): t is string => !!t);
      let args: unknown;
      try {
        ({ args } = decodeEventLog({
          abi: [params.event],
          data: (raw.data ?? "0x") as `0x${string}`,
          topics: rawTopics as [`0x${string}`, ...`0x${string}`[]],
        }));
      } catch {
        continue; // a malformed record is skipped, never fatal
      }
      out.push({
        args,
        blockNumber,
        transactionHash: txHash as `0x${string}`,
        logIndex: Number(logIndex),
      });
    }

    if (rows.length < PAGE_LIMIT) return out;
    if (pageMaxBlock === from && page > 0) {
      // A single block holding 1000+ matching logs cannot be paged past with
      // a block cursor; a silently truncated history must not look complete.
      return null;
    }
    from = pageMaxBlock; // inclusive re-read of the boundary block; dedup absorbs it
  }
  // MAX_PAGES exhausted without a short page — same truncation rule as above.
  return null;
}
