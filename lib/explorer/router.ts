import { blockscoutAdapter } from "./blockscout";
import { robinscanAdapter } from "./robinscan";
import { ExplorerFault } from "./http";
import { recordProviderState } from "../observability/context";
import { reportError } from "../observability/reporter";
import type { ExplorerAdapter, ExplorerMethod } from "./adapter";
import type {
  ExplorerAddressInfo,
  ExplorerTokenInfo,
  ExplorerHolder,
  ExplorerTx,
  ExplorerTxHistory,
  ExplorerVerificationDetail,
  AuditSmartContract,
} from "./types";

let _adapters: ExplorerAdapter[] | null = null;

/**
 * robinscan is OPT-IN, disabled by default (2026-08-26, Priyo's call while a
 * partner arrangement is explored). Blockscout is the sole source unless
 * `EXPLORER_ROBINSCAN_ENABLED` is turned on.
 *
 * Read the trade honestly before flipping this back off in a future panic:
 *
 * **What disabling costs.** robinscan is the BETTER holder source, not the
 * worse one — traced on OBEX (L46), it had 1 of 50 balances wrong against
 * Blockscout's 32 of 50, whose reported #1 holder held zero. Losing it means
 * `tokenHoldersAllSources` unions one list instead of two and gives up the 5
 * real holders robinscan alone carried.
 *
 * **Why that is survivable now, and was not three days ago.** Every holder
 * balance is re-read on chain before use (`lib/scanner/holders.ts`), so a
 * one-sided list costs COMPLETENESS, not correctness, and the set carries
 * `complete: false` to say so. Disabling this before that landed would have
 * handed `holder_concentration` Blockscout's phantom balances unchallenged.
 *
 * **What it also costs.** Blockscout's background 500s (153 recorded) no longer
 * have a second opinion, and with `UNREAD_SURFACE_DEFER_WEIGHT` in place a bad
 * Blockscout window now means scans that publish NOTHING rather than scans that
 * publish thinly. That is the better failure, but it is a louder one. The
 * mitigation already in place is Blockscout-side: two PRO keys in rotation plus
 * `EXPLORER_FALLBACK_API_URL` to the community instance.
 */
function robinscanEnabled(): boolean {
  const v = process.env.EXPLORER_ROBINSCAN_ENABLED;
  return v === "true" || v === "1" || v === "yes";
}

export const deps = {
  get adapters(): ExplorerAdapter[] {
    if (!_adapters) {
      _adapters = robinscanEnabled()
        ? [blockscoutAdapter, robinscanAdapter]
        : [blockscoutAdapter];
    }
    return _adapters;
  },
  set adapters(val: ExplorerAdapter[]) {
    _adapters = val;
  }
};

function getCapableAdapters(method: ExplorerMethod): ExplorerAdapter[] {
  return deps.adapters.filter((a) => a.capabilities.methods.includes(method));
}

// Exported for testing
export function selectAdapter(
  capable: ExplorerAdapter[],
  method: ExplorerMethod,
  randomValue?: number,
): ExplorerAdapter {
  if (capable.length === 1) return capable[0];

  // addressInfo feeds checkExplorerScamFlag (a CRITICAL check). Robinscan
  // structurally has no is_scam/public_tags (lib/explorer/robinscan.ts leaves
  // them undefined, correctly not fabricated) — but checks.ts's own
  // `?? []`/`=== true` defaulting reads that absence as "checked, clean",
  // silently blinding the scam-tag check on whichever scans randomly land on
  // Robinscan. Pin this one method to Blockscout; Robinscan still covers it
  // as a fault fallback via executeMethod's fall-through below, just never as
  // the random primary.
  if (method === "addressInfo") {
    const blockscout = capable.find((a) => a.id === "blockscout");
    if (blockscout) return blockscout;
  }

  // Default 0: enabling the adapter must not silently make it the FIRST ask.
  // Prod ran 50 — half of every scan started at the thinner source, which is the
  // direct cause of L47's 78 unread points.
  const robinscanWeight = parseInt(process.env.EXPLORER_ROBINSCAN_WEIGHT || "0", 10);

  const blockscout = capable.find(a => a.id === "blockscout");
  const robinscan = capable.find(a => a.id === "robinscan");

  if (blockscout && robinscan) {
    const r = randomValue !== undefined ? randomValue : Math.random() * 100;
    if (r < robinscanWeight) {
      return robinscan;
    }
    return blockscout;
  }

  return capable[Math.floor((randomValue !== undefined ? randomValue / 100 : Math.random()) * capable.length)];
}

/**
 * The two adapters do not answer the same questions: robinscan's `/addresses`
 * carries no verification/scam/creator, its `/txs` no sender. A 200 from it is
 * therefore not interchangeable with a 200 from Blockscout, and returning the
 * first one ends the scan's chance of learning the field at all.
 *
 * `satisfied` names the field a caller actually came for. Unsatisfied answers
 * are kept as `best` and returned only if no adapter does better — so this can
 * add information but never replace a fuller answer with a thinner one.
 */
async function executeMethod<T>(
  method: ExplorerMethod,
  execute: (adapter: ExplorerAdapter) => Promise<T | null>,
  satisfied?: (result: T) => boolean,
): Promise<T | null> {
  const capable = getCapableAdapters(method);
  
  if (capable.length === 0) {
    recordProviderState(`explorer-exhausted:${method}`, "ERROR");
    return null;
  }

  const primary = selectAdapter(capable, method);
  const remaining = capable.filter(a => a.id !== primary.id);
  const order = [primary, ...remaining];

  let domain = "scoring";
  /** An adapter responded — including with a 404. Not a fault, so no latch. */
  let answered = false;
  let best: T | null = null;
  for (const adapter of order) {
    try {
      const result = await execute(adapter);
      answered = true;
      // A 404 is one adapter's answer, not the chain's: ask the next before
      // reporting absence. Only the latch below distinguishes "nobody replied".
      if (result === null) continue;
      if (!satisfied || satisfied(result)) return result;
      best ??= result;
    } catch (error) {
      if (error instanceof ExplorerFault) {
        domain = error.domain;
        // Fall through to the next adapter. The fault was already logged and
        // recorded in providerStates by explorerFetch.
        continue;
      }
      // Unexpected errors should also fall through, but log them
      await reportError({
        code: "RC_EXPLORER_UNAVAILABLE",
        message: `Unexpected error in adapter ${adapter.id} for ${method}`,
        operation: `explorer.router.${method}`,
        error,
        requestOutcome: "degraded",
      });
    }
  }

  if (best !== null) return best;
  // Somebody replied and the answer was "no such thing". That is a fact about
  // the chain, so it must NOT trip the exhausted latch — only silence does.
  if (answered) return null;

  // If we get here, every capable adapter faulted.
  // Trip the scan-wide latch by recording an exhausted state (or shadow-exhausted if shadow-audit).
  const prefix = domain === "shadow-audit" ? "explorer-shadow-exhausted" : "explorer-exhausted";
  recordProviderState(`${prefix}:${method}`, "ERROR");
  return null;
}

/**
 * L47 — what an `addressInfo` caller actually came for.
 *
 * The adapters do not answer the same questions (see executeMethod), and this
 * method had NO `satisfied` predicate: the first non-null answer won, however
 * thin, and the other adapter was never asked. The mechanism built to prevent
 * exactly that went unused by the one method whose docstring describes the
 * problem (§8 #10).
 *
 * The cost was not a missing field, it was a missing SCAN. An unresolved
 * creator takes `deployer_history` (14), `funding_lineage` (12),
 * `funder_rug_history` and most of `lp_custody` (18) down with it — 44+ weight
 * points off one read. Measured on prod 2026-08-26: 78 of 155 points unread on
 * OBEX #161, every one of them traceable to the explorer, and only 29% of 158
 * published verdicts had read their whole surface.
 *
 * A CONTRACT is answered only when we know who made it and whether its source
 * is published. A non-contract has no creator to find, so demanding one would
 * make every adapter unsatisfied and waste a call on every EOA.
 *
 * This can only ADD information: an unsatisfied answer is still kept as `best`
 * and returned when nobody does better, so no scan gets a thinner result than
 * it would have before.
 */
function addressInfoSatisfied(info: ExplorerAddressInfo): boolean {
  if (info.is_contract !== true) return true;
  const hasCreator =
    typeof info.creator_address_hash === "string" && info.creator_address_hash.length > 0;
  return hasCreator && info.is_verified !== undefined;
}

export const explorer = {
  addressInfo: (address: string) =>
    executeMethod<ExplorerAddressInfo>(
      "addressInfo",
      (a) => a.addressInfo(address),
      addressInfoSatisfied
    ),

  // L39 — the identical read, but naming WHICH adapter answered.
  addressInfoDetailed: async (
    address: string,
  ): Promise<{ info: ExplorerAddressInfo | null; adapterId: string | null }> => {
    let adapterId: string | null = null;
    const info = await executeMethod<ExplorerAddressInfo>(
      "addressInfo",
      async (a) => {
        const r = await a.addressInfo(address);
        if (r !== null) adapterId = a.id;
        return r;
      },
      addressInfoSatisfied
    );
    return { info, adapterId };
  },

  tokenInfo: (address: string) =>
    executeMethod<ExplorerTokenInfo>("tokenInfo", (a) => a.tokenInfo(address)),

  tokenHolders: (address: string) =>
    executeMethod<{ items: ExplorerHolder[] }>("tokenHolders", (a) => a.tokenHolders(address)),

  /**
   * L46 — EVERY capable adapter, not the first that answers.
   *
   * `executeMethod` picks one source and stops. For holders that is the bug:
   * traced on OBEX, blockscout and robinscan each hold real addresses the other
   * is missing (19 and 5), so whichever answered decided the verdict. Callers
   * union these and confirm the balances on chain (lib/scanner/holders.ts).
   *
   * One entry per adapter that was ASKED, with `items: null` where it faulted —
   * a caller must be able to tell "answered with nothing" from "did not answer".
   * Failures are contained per-adapter so one dead source cannot lose the other.
   */
  tokenHoldersAllSources: async (
    address: string,
  ): Promise<{ sourceId: string; items: ExplorerHolder[] | null }[]> => {
    const capable = getCapableAdapters("tokenHolders");
    return Promise.all(
      capable.map(async (a) => {
        try {
          const r = await a.tokenHolders(address);
          return { sourceId: a.id, items: r?.items ?? null };
        } catch {
          return { sourceId: a.id, items: null };
        }
      }),
    );
  },

  addressTxs: (address: string) =>
    executeMethod<{ items: ExplorerTx[] }>("addressTxs", (a) => a.addressTxs(address)),

  addressTxHistory: (address: string, filter: "to" | "from", maxPages = 8) =>
    executeMethod<ExplorerTxHistory>("addressTxHistory", (a) => a.addressTxHistory(address, filter, maxPages)),

  addressTxWindowAsc: (address: string, limit = 100) =>
    executeMethod<{ items: ExplorerTx[]; sawWholeHistory: boolean }>("addressTxWindowAsc", (a) =>
      a.addressTxWindowAsc(address, limit)
    ),

  addressInternalTxWindowAsc: (address: string, limit = 100) =>
    executeMethod<{ items: ExplorerTx[]; sawWholeHistory: boolean }>("addressInternalTxWindowAsc", (a) =>
      a.addressInternalTxWindowAsc(address, limit)
    ),

  smartContract: (address: string) =>
    executeMethod<{ is_verified?: boolean; source_code?: string | null }>("smartContract", (a) => a.smartContract(address)),

  verificationDetail: (address: string) =>
    executeMethod<ExplorerVerificationDetail>("verificationDetail", (a) => a.verificationDetail(address)),

  smartContractFull: (address: string) =>
    executeMethod<AuditSmartContract>("smartContractFull", (a) => a.smartContractFull(address)),

  // `from` — the EOA that sent the creation transaction, i.e. who launched a
  // factory-deployed token (item 7). Robinscan's adapter does not return it, so
  // consumers must treat its absence as unknown, never as "no launcher" — and
  // the predicate keeps a robinscan draw from ending the lookup, since every
  // real transaction has a sender and only the adapter can be missing it.
  transaction: (hash: string) =>
    executeMethod<{ timestamp?: string; from?: { hash?: string } | null }>(
      "transaction",
      (a) => a.transaction(hash),
      (r) => r.from?.hash != null,
    ),
};
