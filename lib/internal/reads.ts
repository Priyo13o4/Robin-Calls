import { keccak256 } from "viem";
import { latestVerdictRowForToken, queryLedgerFeed, verdictRowById } from "@/lib/data/ledger";
import { publicVerdictRow } from "@/lib/sale/token";
import { readDeployerByAddress, readDeployerFamilyTree, readIndictedStats } from "@/lib/data/wanted";
import { readTokenMarks } from "@/lib/data/marks";
import { readAllTrustedAddresses } from "@/lib/data/admin-trust";
import { readLatestAuditInstance } from "@/lib/data/audit";
import { readRwaTokenByAddress } from "@/lib/data/registry";
import { AUDIT_RULE_VERSION } from "@/lib/audit/orchestrator";
import { runServerContractAudit } from "@/lib/audit/server-run";
import { bundleContractSource } from "@/lib/agent/source-bundle";
import { resolveSourceTarget } from "@/lib/audit/source-target";
import { explorer } from "@/lib/explorer/blockscout";
import { isDatabaseConfigured } from "@/lib/db/client";
import { rpc } from "@/lib/rpc/client";
import { batchRead, isFaulted, valueOrNull, type BatchResult } from "@/lib/rpc/multicall";
import {
  EIP1967_SLOTS,
  V3_FEE_TIERS,
  erc20Abi,
  v2FactoryAbi,
  v3FactoryAbi,
  v3PoolAbi,
  v3PoolStateAbi,
} from "@/lib/rpc/abis";
import { dexes } from "@/lib/config/dex-registry";
import {
  primeTrustedAddresses,
  seedPlan,
  trustedAddressCachePrimed,
} from "@/lib/config/trusted-addresses";
import {
  CRITICAL_OVERRIDES,
  FORMULA_VERSION,
  POST_SCORE_RULES,
  TIER_BANDS,
  WEIGHTED_CHECKS,
} from "@/lib/config/formula";
import { clientWebSearch, clientWebFetch } from "@/lib/mcp/parallel-search-client";
import { getLiveLpCustody } from "@/lib/trade/lp-custody-live";

/**
 * The internal read contract — the ONLY thing the FastAPI agent plane may ask
 * Next.js for besides a scan.
 *
 * Why this file is a lookup table and not a layer: `lib/data/` already owns
 * every database access and already serves the website (CLAUDE.md §1).
 * Reimplementing those queries in Python would fork the persistence boundary
 * into two languages — exactly the 80-file sprawl §1 exists to prevent. So the
 * agent plane borrows them through one named dispatcher instead.
 *
 * ── Two rules, both load-bearing ────────────────────────────────────────────
 *
 * 1. **Return the FULL domain object. Never shape a payload here.**
 *    The retiring MCP server shaped its own responses and, in doing so, dropped
 *    `evidence`, `deduction` and `weight` off every check (`lib/mcp/tools.ts:56`).
 *    That silently made citation-or-silence impossible: an agent asked "why is
 *    this 72?" had no cited numbers available and could only invent them.
 *    What the model sees is a model-facing decision, so Python decides it —
 *    downstream of a read that stripped nothing.
 *
 * 2. **A read that fails must not look like a read that found nothing.**
 *    `lib/data/` reads degrade to an empty value by design, which is only safe
 *    while the caller treats empty as *unknown* (CLAUDE.md §4). The dispatcher
 *    therefore reports `{ found: false }` for a legitimate miss and lets a
 *    thrown error surface as a 5xx — never as an empty success. "No deployer on
 *    record" and "the database was unreachable" must not arrive identically,
 *    because one of them is a sentence about the token.
 *
 *    That covers a read that *throws*. It does not cover the leg where there is
 *    nothing to throw: with `DATABASE_URL` unset or still a `YOUR_…`
 *    placeholder, `database()` returns null and every repository function
 *    returns its documented empty value without erroring. `readTokenMarks`
 *    hands back `[]`, `readIndictedStats` hands back zeroes — non-null, so a
 *    plain emptiness test calls them `found: true` and the model narrates a
 *    config mistake as "no marks stand against this token". Every DB-backed
 *    read below therefore goes through `db()`, which gates on
 *    `isDatabaseConfigured()` exactly as `lib/scanner/pipeline.ts:371` already
 *    does — the guard existed and this file was routing around it (§8.7).
 */

export type ReadFn = (args: Record<string, unknown>) => Promise<unknown>;
export type ReadRegistry = Record<string, ReadFn>;

/** 0x + 40 hex, lowercased. Throws rather than silently querying garbage. */
function address(args: Record<string, unknown>, key = "address"): string {
  const raw = String(args[key] ?? "").trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(raw)) {
    throw new BadReadRequest(`\`${key}\` must be a 0x-prefixed 40-hex address.`);
  }
  return raw;
}

function integer(args: Record<string, unknown>, key: string): number {
  const n = Number(args[key]);
  if (!Number.isInteger(n)) {
    throw new BadReadRequest(`\`${key}\` must be an integer.`);
  }
  return n;
}

/** V3 pools are addresses; V4 pool identifiers are bytes32 values. */
function poolId(args: Record<string, unknown>): string {
  const raw = String(args.poolId ?? "").trim().toLowerCase();
  if (!/^0x(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(raw)) {
    throw new BadReadRequest("`poolId` must be a 20-byte pool address or 32-byte pool id.");
  }
  return raw;
}

/** Argument-shape rejection — a 400, distinct from a read that faulted (500). */
export class BadReadRequest extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadReadRequest";
  }
}

/**
 * "We could not look" — the third state, distinct from both an answer and a
 * miss. Surfaces as a 503 with `transient: true`, which the Python plane
 * already refuses to narrate as a finding (`next_client.as_tool_payload`).
 *
 * Thrown rather than returned so it cannot be ignored by a future read that
 * forgets to check a flag: the dispatcher's existing catch is the only path out.
 */
export class ReadUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadUnavailable";
  }
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * A single chain read, with the three states kept apart.
 *
 * `valueOrNull` deliberately flattens "reverted" and "never asked" to null, and
 * its own docstring tells callers whose answer feeds a narration not to use it
 * (`lib/rpc/multicall.ts:272`). Every read below feeds a narration, so none of
 * them may. The distinction is the whole tracing method: `fee()` reverting on a
 * V2 pair is the answer "this is not a V3 pool", while `fee()` faulting is not
 * an answer at all, and a model handed `null` for both will say the first.
 */
type ReadState<T> =
  | { status: "ok"; value: T }
  | { status: "reverted"; value: null }
  | { status: "unavailable"; value: null };

function state<T>(
  result: BatchResult<unknown> | undefined,
  map: (raw: unknown) => T
): ReadState<T> {
  if (result === undefined || result.status === "faulted") {
    return { status: "unavailable", value: null };
  }
  if (result.status === "reverted") return { status: "reverted", value: null };
  return { status: "ok", value: map(result.value) };
}

const asAddress = (raw: unknown) => String(raw).toLowerCase();
const asNumber = (raw: unknown) => Number(raw);
const asBigintString = (raw: unknown) => String(raw);

/** Decode a 32-byte storage word to an address. All-zero means "unset", not "unknown". */
function slotToAddress(word: string | null | undefined): string | null {
  if (!word || word.length < 42) return null;
  const addr = `0x${word.slice(-40)}`.toLowerCase();
  return addr === ZERO_ADDRESS ? null : addr;
}

/**
 * Every factory address that pool discovery can currently resolve, and under
 * which venue.
 *
 * This is deliberately read through `dexes()` rather than off the registry rows
 * directly, because the two are not the same set. `role()` only matches a row
 * when its `dex_id` and `category` line up AND its label contains the protocol
 * string (or `metadata.protocol` names it) — so a correctly-inserted V3 factory
 * row labelled without "V3" is present in the database and invisible to
 * discovery. That gap has no symptom other than pools quietly never being
 * found, which is why the reconciliation below computes it instead of asking a
 * reader to spot it.
 */
function resolvedFactories(): Map<string, { dexId: string; protocol: string; dexEnabled: boolean }> {
  const out = new Map<string, { dexId: string; protocol: string; dexEnabled: boolean }>();
  for (const dex of dexes()) {
    const add = (addr: string | null | undefined, protocol: string) => {
      if (addr) out.set(addr.toLowerCase(), { dexId: dex.id, protocol, dexEnabled: dex.enabled });
    };
    add(dex.v2?.factory, "v2");
    add(dex.v3?.factory, "v3");
    add(dex.v4?.poolManager, "v4");
  }
  return out;
}

/**
 * Gate for every read whose emptiness would otherwise become a sentence about
 * a token or a wallet. Not a connection check — `isDatabaseConfigured` opens
 * nothing (`lib/db/client.ts:59`); it only distinguishes "persistence is a live
 * boundary and said no" from "persistence was never configured".
 */
function requireDatabase(): void {
  if (!isDatabaseConfigured()) {
    throw new ReadUnavailable(
      "The record store is not configured, so this lookup never ran. " +
        "Absence here is not evidence."
    );
  }
}

/**
 * Validate arguments FIRST, then gate on availability.
 *
 * The order is the contract, not a detail: a malformed address is a 400
 * whether or not the store is up, and flipping these turns every bad argument
 * into a 503 the moment persistence goes away — a caller debugging its own typo
 * would be told our infrastructure was down.
 */
function reading<A, T>(parse: (args: Record<string, unknown>) => A, run: (parsed: A) => Promise<T>) {
  return async (args: Record<string, unknown>): Promise<T> => {
    const parsed = parse(args);
    requireDatabase();
    return run(parsed);
  };
}

export const READS = {
  /** One archived verdict by ledger id — full row, checks with evidence intact. */
  get_verdict: reading((args) => integer(args, "id"), async (id) => {
    const row = await verdictRowById(id);
    return row && publicVerdictRow(row);
  }),

  /** The most recent canonical verdict recorded for a token. */
  get_latest_verdict: reading((args) => address(args), async (addr) => {
    const row = await latestVerdictRowForToken(addr);
    return row && publicVerdictRow(row);
  }),

  /**
   * Public ledger feed page — used for "what has this scanner said lately".
   *
   * `token` goes through the same strict validator as every other address
   * argument: a truncated or malformed address filtered in SQL returns an empty
   * page, which reads as "the scanner has published nothing about this token"
   * rather than "you asked me something I could not parse".
   */
  get_ledger_feed: reading(
    (args) => ({
      cursor: args.cursor == null ? null : integer(args, "cursor"),
      token: args.token == null ? null : address(args, "token"),
      // Clamped at both ends: `-5 || 20` is `-5`, which reaches Postgres as a
      // negative LIMIT and 500s on a model typo.
      limit: Math.max(1, Math.min(Number(args.limit ?? 20) || 20, 50)),
    }),
    async (opts) => {
      const page = await queryLedgerFeed(opts);
      return { ...page, entries: page.entries.map(publicVerdictRow) };
    }
  ),

  /** Persistent deployer record: confirmed rugs, dead launches, total extracted. */
  lookup_deployer: reading((args) => address(args), readDeployerByAddress),

  /** Every token traced back to one deployer — the rap sheet behind a verdict. */
  get_deployer_family: reading((args) => address(args), readDeployerFamilyTree),

  /** Honeypot / pump-dump marks standing against a token right now. */
  get_token_marks: reading((args) => address(args), readTokenMarks),

  /**
   * Wanted Board aggregate — indicted deployer count and total extracted.
   *
   * `webCounts` is a `Map`, which `JSON.stringify` renders as `{}` with no
   * error — the silent-drop shape CLAUDE.md §8.1 is about. Converting it is
   * transport encoding for a type JSON cannot express, not the payload shaping
   * rule 1 forbids: every key survives.
   */
  /**
   * The contract audit already on record for an address. Never runs one.
   *
   * `runContractAuthorityAudit` is server-locale by construction — multicall, a
   * deadline budget, our RPC pool — and it is what a scan spends. This read is
   * the deliberate opposite: it answers only from `contract_audit_instance`,
   * written by a previous scan, so the Auditor persona costs a single indexed
   * SELECT no matter how many people ask. A contract nobody has scanned returns
   * `found: false`, which the dispatcher already labels "no record exists — not
   * a clean bill of health".
   *
   * The shape carries three honesty signals rather than one boolean:
   *
   *   completeness  the artifact's own — `partial` means the analysis itself
   *                 ran short (unverified source, a truncated read), so absence
   *                 of a capability in `capabilities` is not evidence it is
   *                 missing from the contract.
   *   staleRules    this audit ran under a superseded AUDIT_RULE_VERSION. Its
   *                 findings stand; its silences do not, because the newer
   *                 ruleset may look for things the older one never did.
   *   blockHash     authorities are true as of a block. An owner can be
   *                 transferred the block after, and this is what lets the
   *                 answer be dated instead of stated.
   */
  get_contract_audit: reading(
    (args) => address(args),
    (addr) => readLatestAuditInstance(addr, AUDIT_RULE_VERSION)
  ),

  /**
   * Is this address a registered tokenized real-world asset, and what is it?
   *
   * The RWA Analyst had no tool that could answer "what is this" — it held the
   * verdict surface and the generic chain reads, so on a stock token with no
   * scan on record it fell through to `get_token_meta` and narrated the
   * infrastructure paragraph out of its own prompt with nothing underneath it.
   * That is the exact shape this codebase treats as the worst class of bug: a
   * confident sentence with no read behind it.
   *
   * `verify_status` is passed through unflattened and is the point of the row.
   * `unchecked` and `unprobeable` are NOT `failed` — one has never been tested
   * and one could not be tested, and neither is a statement about the asset.
   */
  get_rwa_asset: reading((args) => address(args), readRwaTokenByAddress),

  get_indicted_stats: async () => {
    requireDatabase();
    const stats = await readIndictedStats();
    return { ...stats, webCounts: Object.fromEntries(stats.webCounts) };
  },

  // ── Chain reads ───────────────────────────────────────────────────────────
  //
  // These exist so CLIENT-locale tools have a server executor when they are
  // reached over MCP, where there is no browser to run them (§7). They go
  // through `lib/rpc`'s pooled client deliberately: circuit state is
  // per-process (`lib/rpc/provider-pool.ts:41`), so a second pool inside the
  // Python container would give two blind, disagreeing views of the same
  // providers. The agent plane therefore opens no RPC connections of its own —
  // it borrows this one.
  //
  // Read-only and display-only by design. Nothing honeypot-shaped belongs here:
  // viem throws identically for a revert and a timeout, and `isTransientRpcError`
  // is what tells them apart (CLAUDE.md §4).

  /** Current head. Also the reference the client-result staleness check uses. */
  get_block_number: async () => ({
    blockNumber: Number(await rpc().getBlockNumber()),
    observedAt: new Date().toISOString(),
  }),

  /**
   * ERC-20 name/symbol/decimals/totalSupply — every field independently
   * nullable, because a token that reverts on `name()` is a real fact about it.
   *
   * Deliberately NOT `fetchTokenMeta`: that helper flattens through
   * `valueOrNull`, which its own docstring says callers whose answer feeds a
   * narration must avoid, because it renders "reverted" and "never asked"
   * identically as null (`lib/rpc/multicall.ts:272`). Down that path one RPC
   * timeout arrives as a *successful* read of four nulls, and the model says
   * "this contract exposes no name, symbol, decimals or supply — it does not
   * implement ERC-20" about a perfectly ordinary token. A revert still yields
   * null here; only a fault refuses, which is the §4 line exactly.
   */
  get_token_meta: async (args) => {
    const token = address(args) as `0x${string}`;
    const results = await batchRead([
      { address: token, abi: erc20Abi, functionName: "name" },
      { address: token, abi: erc20Abi, functionName: "symbol" },
      { address: token, abi: erc20Abi, functionName: "decimals" },
      { address: token, abi: erc20Abi, functionName: "totalSupply" },
    ]);
    if (results.some((r) => isFaulted(r))) {
      throw new ReadUnavailable(
        "The token metadata read did not reach the chain. Absent fields here " +
          "are unknown, not missing."
      );
    }
    const decimals = valueOrNull<number>(results[2]);
    const totalSupply = valueOrNull<bigint>(results[3]);
    return {
      address: token,
      name: valueOrNull<string>(results[0]),
      symbol: valueOrNull<string>(results[1]),
      decimals: decimals === null ? null : Number(decimals),
      totalSupply: totalSupply === null ? null : totalSupply.toString(),
    };
  },

  /**
   * Run the full contract audit — the MCP leg of the client-locale
   * `run_contract_audit` tool, for callers that have no browser.
   *
   * `get_contract_audit` above is the deliberate opposite of this one: it reads
   * what a scan already recorded, for the cost of one indexed SELECT. This runs
   * the analysis, on our pool, and that is why it exists only behind the
   * bearer-gated transport. In chat the same tool is client-locale and executes
   * in the visitor's browser, spending nothing of ours at all.
   *
   * `persist: false` is the rule, not an optimisation: an agent-initiated audit
   * explains the permanent record and never joins it — the same line that keeps
   * agent-run scans out of The Ledger. Nothing here writes a verdict, a score,
   * a receipt or an audit instance.
   *
   * Never throws (the audit degrades to `completeness: "unresolved"` with a
   * `truncationReason`), so there is no `ReadUnavailable` leg: the honest
   * "we could not look" is already inside the payload rather than beside it.
   */
  run_contract_audit: async (args) => {
    const target = address(args);
    const result = await runServerContractAudit(target, { persist: false });
    return { address: target, ruleVersion: AUDIT_RULE_VERSION, ...result };
  },

  /**
   * The contract's verified Solidity, bounded and disclosed — the MCP leg of
   * the client-locale `read_contract_source`.
   *
   * In chat this runs in the visitor's browser against their own explorer
   * budget. Over MCP there is no browser, so it costs us one explorer fetch and
   * nothing else: no chain reads, no database, no write of any kind.
   *
   * `bundleContractSource` is the SAME function the browser calls. The whole
   * point of the bundle is what it refuses to overstate — which files were left
   * out, that the text inside is attacker-authored — and two implementations of
   * that would eventually disagree about what "I read the source" means.
   */
  read_contract_source: async (args) => {
    const requested = address(args);
    const path = typeof args.path === "string" && args.path.trim() ? args.path.trim() : null;
    // Same proxy resolution the browser leg does, through the same function:
    // the source of a proxy address is the forwarder's, not the contract's.
    const resolved = await resolveSourceTarget(rpc(), requested);
    const raw = await explorer.smartContractFull(resolved.target);
    return {
      address: requested,
      sourceOf: resolved.target,
      viaProxy: resolved.target === requested ? null : resolved.proxyKind,
      proxyUnresolved: resolved.unresolved,
      ...bundleContractSource(raw, { path }),
    };
  },

  /** One holder's balance, raw. Decimals come from `get_token_meta`, never assumed. */
  get_token_balance: async (args) => {
    const token = address(args, "token");
    const holder = address(args, "holder");
    const balance = await rpc().readContract({
      address: token as `0x${string}`,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [holder as `0x${string}`],
    });
    return { token, holder, balance: String(balance) };
  },

  // ── Contract tracing — the four-layer reconciliation ──────────────────────
  //
  // These back the `tracer` persona, which reproduces the contract-tracing
  // procedure: establish what a contract IS on chain (L1), what the registry
  // lets the scanner DISCOVER (L2), what the code seed INTENDED (L3), and what
  // a verdict CONCLUDED (L4 — already served by get_verdict_evidence).
  //
  // Every comparison between layers is computed HERE, in code, and handed to
  // the model as a result. That is the point of the persona: a bug in this
  // domain is a disagreement between two layers, and asking a language model to
  // diff two address lists by eye is exactly the step that must not be
  // probabilistic. The model narrates a computed answer; it never derives one.
  //
  // Server-locale on purpose, unlike the ERC-20 reads above. The client-locale
  // argument is free-tier economics, and none of it applies to an internal
  // audit persona — while a hostile client RPC answering `eth_getCode` with
  // `0x` would manufacture "no contract is deployed at this address", the first
  // row in CLAUDE.md §4's table of verdicts this scanner actually published.

  /**
   * Is there code at this address, and is it a proxy?
   *
   * `hasCode: false` is a real answer only because the read reached the chain —
   * a transport failure throws `ReadUnavailable` rather than reporting an empty
   * account. The three ERC-1967 slots are read as raw storage rather than
   * probed through an interface, because a proxy that does not expose
   * `implementation()` still stores one, and the slot is the durable fact.
   */
  get_contract_identity: async (args) => {
    const target = address(args) as `0x${string}`;
    let code: string | undefined;
    let slots: Array<string | undefined>;
    try {
      [code, ...slots] = await Promise.all([
        rpc().getCode({ address: target }),
        rpc().getStorageAt({ address: target, slot: EIP1967_SLOTS.implementation }),
        rpc().getStorageAt({ address: target, slot: EIP1967_SLOTS.beacon }),
        rpc().getStorageAt({ address: target, slot: EIP1967_SLOTS.admin }),
      ]);
    } catch {
      // Never degrades to "nothing is deployed there". `getCode` returning `0x`
      // and `getCode` never answering are the same shape and opposite facts.
      throw new ReadUnavailable(
        "The bytecode and proxy-slot reads did not reach the chain. This is not " +
          "evidence that the address is empty."
      );
    }

    const bytecode = code ?? "0x";
    const hasCode = bytecode !== "0x" && bytecode.length > 2;
    return {
      address: target,
      hasCode,
      // (length - 2) / 2 — hex chars to bytes. Zero for an EOA.
      codeSize: hasCode ? (bytecode.length - 2) / 2 : 0,
      // The identity a clone-template or shared-implementation comparison keys
      // on: two addresses with the same code hash run the same contract.
      codeHash: hasCode ? keccak256(bytecode as `0x${string}`) : null,
      proxy: {
        implementation: slotToAddress(slots[0]),
        beacon: slotToAddress(slots[1]),
        admin: slotToAddress(slots[2]),
      },
      note:
        "A null proxy slot means the slot holds zero — this is not an ERC-1967 " +
        "proxy of that kind. It does not rule out other proxy patterns.",
    };
  },

  /**
   * What venue is this pool on, and can the scanner see that venue?
   *
   * The five reads are independently nullable because they identify the pool's
   * *kind*: a V2 pair answers token0/token1/factory and reverts on fee and
   * liquidity, and those two reverts are how you know it is a V2 pair. Only a
   * fault is unknown.
   */
  get_pool_identity: async (args) => {
    const pool = address(args) as `0x${string}`;
    await primeTrustedAddresses();

    const results = await batchRead([
      { address: pool, abi: v3PoolAbi, functionName: "token0" },
      { address: pool, abi: v3PoolAbi, functionName: "token1" },
      { address: pool, abi: v3PoolAbi, functionName: "factory" },
      { address: pool, abi: v3PoolAbi, functionName: "fee" },
      { address: pool, abi: v3PoolStateAbi, functionName: "liquidity" },
    ]);

    if (results.every((r) => isFaulted(r))) {
      throw new ReadUnavailable(
        "No pool read reached the chain, so nothing is known about this address."
      );
    }

    const token0 = state(results[0], asAddress);
    const token1 = state(results[1], asAddress);
    const factory = state(results[2], asAddress);
    const fee = state(results[3], asNumber);
    const liquidity = state(results[4], asBigintString);

    const identityReads = [token0, token1, factory];
    // A pool answers its two sides. All three reverting is a real "not a pool";
    // any of them faulting leaves the question open rather than answered no.
    const isPool = identityReads.some((r) => r.status === "ok")
      ? true
      : identityReads.some((r) => r.status === "unavailable")
        ? null
        : false;

    const resolved = factory.value ? resolvedFactories().get(factory.value) : undefined;

    return {
      address: pool,
      isPool,
      token0,
      token1,
      factory,
      fee,
      liquidity,
      // Zero in-range liquidity is a fact, not a missing value: no swap can
      // route through this pool. It is the strongest signal in the domain and
      // must never be read as "no liquidity data" (CLAUDE.md §8.3).
      venue: resolved
        ? { ...resolved, discoverable: true }
        : factory.status === "ok"
          ? {
              dexId: null,
              protocol: null,
              dexEnabled: false,
              discoverable: false,
              reason:
                "The pool's factory resolves to no venue in the live registry, so " +
                "pool discovery cannot find pools created by it.",
            }
          : null,
      registryCachePrimed: trustedAddressCachePrimed(),
    };
  },

  /**
   * Every pool the two tokens share, probed against every factory in the
   * registry — including factories discovery cannot currently resolve.
   *
   * This is the discovery blind-spot detector. Discovery iterates the venues
   * `role()` resolves; this iterates the registry rows directly, so a pool
   * found here whose factory is not `discoverable` is a pool that exists and
   * that no scan will ever weigh.
   */
  find_pools_for_pair: async (args) => {
    const tokenA = address(args, "tokenA") as `0x${string}`;
    const tokenB = address(args, "tokenB") as `0x${string}`;
    requireDatabase();
    await primeTrustedAddresses();

    const rows = (await readAllTrustedAddresses(4663)).filter(
      (r) => r.category === "dex-factory"
    );
    const resolved = resolvedFactories();

    // getPair + one getPool per fee tier, per factory. A V2 factory reverts on
    // getPool and a V3 factory reverts on getPair; both reverts are expected
    // and are how the protocol is identified, so `allowFailure` is required.
    const calls = rows.flatMap((row) => {
      const factory = row.address.toLowerCase() as `0x${string}`;
      return [
        { address: factory, abi: v2FactoryAbi, functionName: "getPair", args: [tokenA, tokenB] },
        ...V3_FEE_TIERS.map((fee) => ({
          address: factory,
          abi: v3FactoryAbi,
          functionName: "getPool",
          args: [tokenA, tokenB, fee] as const,
        })),
      ];
    });

    const results = calls.length ? await batchRead(calls) : [];
    const stride = 1 + V3_FEE_TIERS.length;

    const pools: Array<Record<string, unknown>> = [];
    let faulted = 0;

    rows.forEach((row, index) => {
      const factory = row.address.toLowerCase();
      const venue = resolved.get(factory);
      const slice = results.slice(index * stride, (index + 1) * stride);
      faulted += slice.filter((r) => isFaulted(r)).length;

      const record = (result: BatchResult<unknown> | undefined, protocol: string, fee: number | null) => {
        const found = state(result, asAddress);
        // A zero address is the factory saying "no such pool" — a real answer.
        if (found.status !== "ok" || found.value === ZERO_ADDRESS) return;
        pools.push({
          pool: found.value,
          protocol,
          fee,
          factory,
          factoryLabel: row.label,
          dexId: row.dex_id,
          factoryEnabled: row.enabled,
          discoverable: venue !== undefined && venue.dexEnabled,
        });
      };

      record(slice[0], "v2", null);
      V3_FEE_TIERS.forEach((fee, i) => record(slice[1 + i], "v3", fee));
    });

    return {
      tokenA,
      tokenB,
      factoriesProbed: rows.length,
      // Short by a fault is not the same set as short by absence (§8.8). A
      // caller that reads an incomplete probe as "these are all the pools"
      // republishes the discovery bug it was called to find.
      //
      // Zero factories counts as incomplete for the same reason. An empty
      // `dex-factory` set is precisely the catastrophic registry state this
      // tool exists to surface, and reporting `complete: true, pools: []` for
      // it would answer "this pair trades nowhere" — a confident sentence about
      // two tokens, sourced entirely from our own missing configuration.
      complete: faulted === 0 && rows.length > 0,
      faultedReads: faulted,
      incompleteReason:
        rows.length === 0
          ? "The registry holds no dex-factory rows at all, so nothing was probed. " +
            "This is a finding about the registry, not about these tokens."
          : faulted > 0
            ? `${faulted} factory probe(s) did not reach the chain, so the pool set is short.`
            : null,
      pools,
      blindSpots: pools.filter((p) => p.discoverable === false),
      coverage: {
        probed: ["v2 getPair", `v3 getPool at fee tiers ${V3_FEE_TIERS.join(", ")}`],
        notProbed:
          "Uniswap V4. V4 pools live on one PoolManager singleton and are keyed " +
          "by poolId, not created by a factory, so no absence of a V4 pool can " +
          "be concluded from this result.",
      },
      registryCachePrimed: trustedAddressCachePrimed(),
    };
  },

  /**
   * Is this address known to the trusted-address registry, and as what?
   *
   * A miss is `found: false` at the dispatcher, never a verdict. The registry
   * lists contracts we have identified; it is not a census of every legitimate
   * contract on the chain, and "not on record" said about the Robinhood custody
   * relayer is how a documented issuer fingerprint becomes a suspicious
   * operator.
   */
  lookup_trusted_address: reading(
    (args) => address(args),
    async (target) => {
      const rows = await readAllTrustedAddresses(4663);
      const match = rows.find((r) => r.address.toLowerCase() === target);
      if (!match) return null;
      const venue = resolvedFactories().get(target);
      return {
        ...match,
        address: match.address.toLowerCase(),
        resolvesForDiscovery: venue ?? null,
      };
    }
  ),

  /** Live position ownership and custody for one token in one selected pool. */
  get_lp_custody: async (args) => {
    const id = poolId(args);
    const token = address(args, "token");
    return getLiveLpCustody({ poolId: id, token });
  },

  /**
   * Reconcile the registry (L2) against the code seed (L3) and against what
   * discovery can actually resolve.
   *
   * The three findings this computes are three different bugs with one
   * symptom — pools that are never discovered:
   *
   * - `missingFromRegistry` — the seed names an address the database does not
   *   have. This is the Uniswap V3 factory outage: migration 0027 seeded the
   *   table without it, all V3 discovery went dark, and V4 was mislabelled as
   *   the deepest venue on real tokens. Fixed by an additive migration.
   * - `seedEnvUnset` — the seed could not even name the address, because the
   *   environment variable behind it is unset. Fixed on the host, not in SQL,
   *   and invisible in `missingFromRegistry` precisely because a row that was
   *   never generated cannot be missing from anything.
   * - `unresolvedRoles` — the row is present and enabled and `role()` still
   *   cannot match it, because its label does not contain the protocol string
   *   and `metadata.protocol` is unset. Fixed by editing the row.
   *
   * A reader given only the two address lists would have to notice all three.
   */
  get_dex_registry: async () => {
    requireDatabase();
    const rows = await readAllTrustedAddresses(4663);
    await primeTrustedAddresses();

    const registryRows = rows.filter(
      (r) => r.category.startsWith("dex-") || r.category === "infra-asset"
    );
    const byAddress = new Map(registryRows.map((r) => [r.address.toLowerCase(), r]));
    const plan = seedPlan();
    const seeded = new Set(plan.map((p) => p.address).filter((a): a is string => a !== null));
    const resolved = resolvedFactories();

    const discoveryRoles = new Set(["dex-factory", "dex-pool-manager"]);

    return {
      registryCachePrimed: trustedAddressCachePrimed(),
      // False means `dexes()` below is reporting the environment fallback
      // rather than the database, and every resolution answer here describes
      // a registry the running scanner is not using.
      registryRows,
      expectedFromSeed: plan,

      missingFromRegistry: plan.filter((p) => p.address !== null && !byAddress.has(p.address)),

      seedEnvUnset: plan
        .filter((p) => p.address === null)
        .map((p) => ({ env: p.env, category: p.category, label: p.label, dexId: p.dex_id })),

      extraInRegistry: registryRows.filter((r) => !seeded.has(r.address.toLowerCase())),

      unresolvedRoles: registryRows
        .filter((r) => discoveryRoles.has(r.category) && r.enabled)
        .filter((r) => !resolved.has(r.address.toLowerCase()))
        .map((r) => ({
          address: r.address.toLowerCase(),
          category: r.category,
          label: r.label,
          dexId: r.dex_id,
          reason:
            "Present and enabled, but role() does not match it — its label does " +
            "not contain the protocol string and metadata.protocol is unset, so " +
            "discovery never sees it.",
        })),

      resolvedDeployments: dexes().map((d) => ({
        id: d.id,
        name: d.name,
        enabled: d.enabled,
        v2Factory: d.v2?.factory ?? null,
        v3Factory: d.v3?.factory ?? null,
        v4PoolManager: d.v4?.poolManager ?? null,
        v3PositionManager: d.v3?.positionManager ?? null,
        v4PositionManager: d.v4?.positionManager ?? null,
      })),
    };
  },

  /**
   * The published scoring formula. Not a database read, but it belongs on the
   * same contract: it is the answer to "what does this check weigh today", and
   * the agent's knowledge prose deliberately carries no numbers of its own so
   * the two can never disagree. The Python startup coverage gate calls this to
   * assert every live check id has an explainer before the agent will serve.
   */
  get_methodology: async () => ({
    version: FORMULA_VERSION,
    bands: TIER_BANDS,
    criticalOverrides: CRITICAL_OVERRIDES,
    weightedChecks: WEIGHTED_CHECKS.map((c) => ({
      id: c.id,
      name: c.name,
      weight: c.weight,
      source: c.source,
    })),
    /**
     * The score CAPS — omitted from this payload until now, which made them
     * invisible to every consumer that treats this endpoint as the formula.
     *
     * Two of the three (`prior_honeypot`, `prior_pump_dump`) are emitted into
     * `verdict.checks[]` by `lib/scanner/record.ts`, so the agent was already
     * receiving them — carrying `weight: null` and `deduction: 0`, because a
     * cap ceilings the score rather than subtracting from it. With no entry
     * here and no explainer behind `lookup_check`, the only sentence available
     * to the model was "this check has no weight and deducted nothing", about
     * a permanent DANGER cap. True of the numbers, and the opposite of the
     * meaning — §4's "an empty result is not a fact", pointed at a zero.
     *
     * `cap` is included because it is the number that actually did the work,
     * and the knowledge prose deliberately carries no numbers of its own.
     */
    postScoreRules: POST_SCORE_RULES.map((c) => ({
      id: c.id,
      name: c.name,
      cap: c.cap,
      source: c.source,
      mechanism: c.mechanism,
    })),
  }),

  /**
   * Real-time web search for financial news, market trends, and off-chain data.
   * Fallback execution path when called over /mcp or server-locale.
   */
  web_search: async (args) => {
    const objective = String(args.objective ?? "Search the web for financial news and market analysis");
    const rawQueries = args.queries ?? args.search_queries ?? args.query ?? [];
    const queries = Array.isArray(rawQueries)
      ? (rawQueries as unknown[]).map(String)
      : [String(rawQueries)];
    const search = await clientWebSearch(objective, queries);
    return {
      objective,
      results: search.items,
      source: "parallel-mcp",
      fetchedAt: search.fetchedAt,
      completeness: search.completeness,
    };
  },

  /**
   * Targeted page content and excerpt extraction for external URLs.
   * Fallback execution path when called over /mcp or server-locale.
   */
  web_fetch: async (args) => {
    const rawUrls = args.urls ?? (args.url ? [args.url] : []);
    const urls = Array.isArray(rawUrls) ? (rawUrls as unknown[]).map(String) : [String(rawUrls)];
    const objective = args.objective ? String(args.objective) : undefined;
    const fullContent = Boolean(args.full_content);
    const result = await clientWebFetch(urls, objective, fullContent);
    return {
      pages: result.pages,
      source: "parallel-mcp",
      fetchedAt: result.fetchedAt,
      completeness: result.completeness,
    };
  },

  /** Address-bound DexScreener market data for the read-only trade assistant. */
  search_token_market: async (args) => readTokenMarket(args),
} satisfies ReadRegistry;

const DEXSCREENER_MARKET_URL = "https://api.dexscreener.com/latest/dex/tokens/";
const DEXSCREENER_RESPONSE_LIMIT = 1_000_000;

async function readBoundedResponse(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > DEXSCREENER_RESPONSE_LIMIT) {
        await reader.cancel();
        throw new ReadUnavailable("DexScreener market response exceeded its size limit.");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    if (error instanceof ReadUnavailable) throw error;
    throw new ReadUnavailable("DexScreener market response could not be read.");
  } finally { reader.releaseLock(); }
}

export async function readTokenMarket(
  args: Record<string, unknown>,
  fetcher: typeof fetch = fetch
): Promise<Record<string, unknown>> {
  const target = address(args);
  let response: Response;
  try {
    response = await fetcher(`${DEXSCREENER_MARKET_URL}${target}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
  } catch (error) {
    throw new ReadUnavailable(`DexScreener market read did not complete: ${error instanceof Error ? error.message : "network error"}`);
  }
  if (!response.ok) throw new ReadUnavailable(`DexScreener market read failed with HTTP ${response.status}.`);
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > DEXSCREENER_RESPONSE_LIMIT) throw new ReadUnavailable("DexScreener market response exceeded its size limit.");
  const body = await readBoundedResponse(response);
  let decoded: { pairs?: Array<Record<string, unknown>> };
  try { decoded = JSON.parse(body) as typeof decoded; }
  catch { throw new ReadUnavailable("DexScreener returned an unreadable market response."); }
  if (!decoded || typeof decoded !== "object" || !Array.isArray(decoded.pairs)) throw new ReadUnavailable("DexScreener returned no readable pair list.");

  const matched = decoded.pairs.filter((pair) => {
    if (String(pair.chainId ?? "").toLowerCase() !== "robinhood") return false;
    const base = pair.baseToken as Record<string, unknown> | undefined;
    const quote = pair.quoteToken as Record<string, unknown> | undefined;
    return [base?.address, quote?.address, pair.pairAddress].some((value) => String(value ?? "").toLowerCase() === target);
  }).slice(0, 12);
  const text = (value: unknown, limit: number): string => typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, limit)
    : "";
  const numeric = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1e100 ? value : null;
  const group = (value: unknown, keys: string[]): Record<string, number> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const source = value as Record<string, unknown>;
    return Object.fromEntries(keys.flatMap((key) => {
      const item = numeric(source[key]);
      return item === null ? [] : [[key, item]];
    }));
  };
  const token = (value: unknown): Record<string, string> => {
    const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return { address: text(source.address, 64), name: text(source.name, 120), symbol: text(source.symbol, 40) };
  };
  const pairs = matched.map((pair) => {
    const txns = pair.txns && typeof pair.txns === "object" ? pair.txns as Record<string, unknown> : {};
    const info = pair.info && typeof pair.info === "object" ? pair.info as Record<string, unknown> : {};
    const linkRows = (value: unknown, kind: "websites" | "socials"): Array<Record<string, string>> => Array.isArray(value)
      ? value.slice(0, 8).flatMap<Record<string, string>>((raw) => {
          if (!raw || typeof raw !== "object") return [];
          const item = raw as Record<string, unknown>;
          const url = text(item.url, 2048);
          if (!url.startsWith("https://")) return [];
          return kind === "websites"
            ? [{ label: text(item.label, 80), url }]
            : [{ type: text(item.type, 32), url }];
        })
      : [];
    return {
      chainId: "robinhood", dexId: text(pair.dexId, 80), url: text(pair.url, 2048),
      pairAddress: text(pair.pairAddress, 80), baseToken: token(pair.baseToken), quoteToken: token(pair.quoteToken),
      priceUsd: text(pair.priceUsd, 64), priceNative: text(pair.priceNative, 64),
      fdv: numeric(pair.fdv), marketCap: numeric(pair.marketCap), pairCreatedAt: numeric(pair.pairCreatedAt),
      txns: Object.fromEntries(["m5", "h1", "h6", "h24"].map((period) => [period, group(txns[period], ["buys", "sells"])])),
      volume: group(pair.volume, ["m5", "h1", "h6", "h24"]),
      priceChange: group(pair.priceChange, ["m5", "h1", "h6", "h24"]),
      liquidity: group(pair.liquidity, ["usd"]),
      info: { websites: linkRows(info.websites, "websites"), socials: linkRows(info.socials, "socials") },
    };
  });
  return {
    query: target,
    chain: "robinhood",
    pairs,
    source: "dexscreener",
    fetchedAt: new Date().toISOString(),
    completeness: "complete",
  };
}

export type ReadName = keyof typeof READS;

export function isReadName(name: string): name is ReadName {
  return Object.prototype.hasOwnProperty.call(READS, name);
}

/** Sorted for a stable contract surface — the Python registry test diffs it. */
export const READ_NAMES: readonly string[] = Object.keys(READS).sort();
