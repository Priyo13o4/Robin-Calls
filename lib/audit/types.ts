import type { AuditReadContext } from "./read-context";

/**
 * Shared type contracts for the contract/authority audit (Group B modules:
 * proxy/Safe resolution, capability classification, authority resolution,
 * targeted probes). Defined once, up front, so each module can be built
 * independently against a stable interface instead of each inventing its own
 * shape. Do not duplicate these types locally in a Group B module — import
 * from here.
 */

export type Completeness = "complete" | "partial" | "unresolved";

// ── Proxy resolution (M3) ───────────────────────────────────────────────

export type ProxyKind =
  | "none"
  | "transparent"
  | "uups"
  | "beacon"
  | "clone-1167"
  | "diamond-2535"
  | "safe-mastercopy"
  | "unresolved-delegatecall";

export interface ProxyFacet {
  address: string;
  functionSelectors: string[];
}

export interface ProxyResolution {
  kind: ProxyKind;
  /** Resolved target for non-diamond kinds; null for "none"/diamond/unresolved. */
  implementation: string | null;
  beacon: string | null;
  admin: string | null;
  /** Diamond only, capped at AUDIT_MAX_DIAMOND_FACETS; null for every other kind. */
  facets: ProxyFacet[] | null;
  /** Recursion depth actually used to reach `implementation`, capped at AUDIT_MAX_PROXY_DEPTH. */
  depth: number;
  completeness: Completeness;
  /** "depth-cap" | "facet-cap" | "explorer-unavailable" | "unsupported-pattern" | null */
  truncationReason: string | null;
}

// ── Safe / multisig resolution (M3) ─────────────────────────────────────

export interface SafeResolution {
  isSafe: boolean;
  /** masterCopy / singleton address, read from storage slot 0. */
  singleton: string | null;
  version: string | null;
  owners: string[] | null;
  threshold: number | null;
  /** True when getModulesPaginated(SENTINEL, 1) returns a non-empty array; null if unresolved. */
  modulesEnabled: boolean | null;
}

// ── Capability classification (M5) ──────────────────────────────────────

export type Capability =
  | "SUPPLY_MINT"
  | "SUPPLY_REBASE"
  | "TRADING_PAUSE"
  | "ADDRESS_BLOCK"
  | "FEE_CHANGE"
  | "LIMIT_CHANGE"
  | "EXEMPTION_CHANGE"
  | "AMM_ROUTE_CHANGE"
  | "ARBITRARY_EXECUTION"
  /**
   * Privileged code containing assembly this audit could NOT classify. It is a
   * statement about OUR reading, not about the contract — KNOWN-PROBLEMS L76,
   * where unparsed assembly under an owner-ish modifier was published as
   * ARBITRARY_EXECUTION, i.e. "this contract can execute arbitrary code", a
   * specific claim nothing had established. A recognition gap must hedge, never
   * accuse (CLAUDE.md §8 #16), and never silently vanish either (§4).
   */
  | "OPAQUE_PRIVILEGED_CODE"
  | "ASSET_RESCUE"
  | "UPGRADE_CODE"
  | "ROLE_ADMIN"
  | "INITIALIZATION"
  | "LIQUIDITY_WITHDRAW"
  | "CUSTODY_REDEEM"
  /**
   * The token's transfer path consults ANOTHER contract, so whoever controls
   * that contract can change who may trade without touching this one. Invisible
   * to a per-contract selector audit by construction — the authority is not in
   * this contract's ABI, and the hook that consults it is internal.
   */
  | "TRANSFER_GATE_DELEGATED"
  /**
   * The local sibling of the above: a state variable this contract's OWN setter
   * writes is read inside a `require`/revert on the transfer path, so changing
   * it changes who may trade.
   *
   * Exists because `setExchangeLimit` — a sell kill switch — was published as
   * "amm route change, limit change" (KNOWN-PROBLEMS L14). The setter's NAME
   * decided its bucket, and no bucket named after a setter can say what the
   * variable does to a holder. Name a capability for its effect, not for the
   * word its setter happened to contain.
   */
  | "TRANSFER_GATE_LOCAL"
  /**
   * The contract emits a `Transfer` whose `from` is an address that did not send
   * the tokens, so the logged provenance is fiction.
   *
   * Explorers and indexers — including this scanner's own `funding_lineage` —
   * read the EVENT, not the balance diff, so a token doing this can attribute
   * the owner's distributions to an address that never held a balance. Not a
   * privileged capability in the usual sense (no authority gates it; it happens
   * on every matching transfer), but it belongs in the census because it makes
   * every event-derived conclusion about this token unsound.
   */
  | "FORGED_TRANSFER_EVENT";

/**
 * Correction (post-review): a tolerant single-pass AST walk cannot reliably
 * trace behavior through inheritance, library calls, or inline assembly.
 * `confidence` must say so rather than silently reporting "verified" for
 * anything the walker couldn't actually prove.
 *
 * - verified-semantic: traced to a concrete storage write / call-graph edge
 *   inside THIS contract's own source, no unresolved indirection.
 * - heuristic: a plausible behavioral match, but through indirection the
 *   walker didn't fully trace (inherited function, library call).
 * - selector-hint: bytecode-selector match only (no verified source, or
 *   source didn't parse) — never overrides a verified-semantic contradiction.
 * - unresolved: capability-relevant surface exists (e.g. inline assembly, an
 *   external library call) but its effect could not be classified at all.
 */
export type CapabilityConfidence = "verified-semantic" | "heuristic" | "selector-hint" | "unresolved";

/** Set by M7's targeted probes; absent/undefined until a probe actually runs. */
export type ProbeStatus = "not-run" | "reverted" | "succeeded" | "unavailable";

/**
 * A guard that, once passed, permanently disables a function. Source-derived
 * and therefore cacheable; the state it refers to is NOT (lib/audit/liveness.ts).
 */
export interface LivenessPrecondition {
  /** "one-shot": reverts once `stateVar` is set. "time-window": `block.timestamp < stateVar`. */
  kind: "one-shot" | "time-window";
  /** Public getter for the state var the guard reads. */
  stateVar: string;
  /** The function this guard protects. */
  functionName: string;
  /** Read this storage slot instead of a getter: Solady `initializer` keeps its flag in one with no getter. */
  slot?: `0x${string}`;
}

/**
 * `spent` = proven unusable from here on. Only ever set from a successful read
 * of a frozen variable; a faulted, empty or unrecognised read is `unknown`,
 * which is treated exactly like `live` (CLAUDE.md §4).
 */
export type LivenessState = "live" | "spent" | "unknown";

export interface CapabilityLiveness {
  capability: Capability;
  state: LivenessState;
  /** Reader-facing sentence, e.g. "its window closed on 2026-08-10". */
  detail: string;
}

export interface CapabilityFinding {
  capability: Capability;
  confidence: CapabilityConfidence;
  /** The actual reachable function(s), whatever their name. */
  functionSignatures: string[];
  evidence: {
    storageWrites?: string[];
    modifiers?: string[];
    calls?: string[];
  };
  probeStatus?: ProbeStatus;
  /** Guards that could retire this capability. Empty means "no claim either way". */
  preconditions?: LivenessPrecondition[];
}

// ── Contract identity + callable surface (lib/audit/inventory.ts) ───────

/**
 * One entry point. `signature` and `label` are deliberately NOT the same field:
 * a signature is read out of a verified ABI and is a fact, while a label is a
 * match against our local selector table and is a guess — four bytes are cheap
 * to grind, so a contract can put any name on a familiar selector. Collapsing
 * them would let a guessed name be quoted as if the source had said it.
 */
export interface FunctionEntry {
  /** "0x" + 8 lowercase hex. Always known — it is what the dispatcher compares. */
  selector: string;
  /** Canonical signature, from a verified ABI only. Null when unverified. */
  signature: string | null;
  /** A recognized name for this selector, or null. A hint, never proof. */
  label: string | null;
  /** "write" only from an ABI. Bytecode does not carry mutability. */
  mutability: "write" | "unknown";
  /** Null when unobservable — which is every bytecode-only entry. */
  payable: boolean | null;
}

export interface FunctionInventory {
  /**
   * How the list was obtained, because it changes what the list MEANS.
   * "abi" — state-changing functions, mutability known.
   * "dispatcher" — every dispatched selector, mutability unknowable.
   * "none" — nothing to enumerate from.
   */
  source: "abi" | "dispatcher" | "none";
  /** "partial" when capped or an entry would not parse; "unresolved" when nothing was enumerated. */
  completeness: Completeness;
  functions: FunctionEntry[];
  /** ABI path: how many view/pure functions were excluded from `functions`. Null when mutability is unobservable. */
  readOnlyCount: number | null;
  /**
   * ABI path: selectors the bytecode dispatches that the ABI never declares —
   * a disagreement between two sources, not a finding. Null when it could not
   * be computed (no ABI, or the bytecode would not disassemble).
   */
  selectorsNotInAbi: string[] | null;
}

/**
 * What the contract IS. Descriptive only — nothing here reaches `verdict.checks[]`.
 *
 * It exists because "no capabilities found" is not an answer. The capability
 * classifier returns `[]` both for a contract that genuinely does nothing
 * privileged and for one whose source we never read, and the reader cannot tell
 * those apart from the empty array alone.
 */
export interface ContractIdentity {
  /** The verified contract's declared name; null when unverified or unread. */
  name: string | null;
  /**
   * Three states, and the third is the point. `false` means the explorer said
   * this contract is not verified. `null` means we could not establish it — the
   * explorer read failed, and a failed read is not a fact about the contract
   * (CLAUDE.md §4, §8.9).
   */
  sourceVerified: boolean | null;
  /**
   * How well the source matches THIS address, when it is verified at all.
   *
   * `sourceVerified` is a boolean and this question has three answers, so the
   * boolean was quietly rounding two of them together. `"full"` is an exact
   * metadata match. `"partial"` means the runtime bytecode agrees but the
   * metadata hash does not — most often Blockscout served the source from
   * `eth_bytecode_db`, i.e. from a different address that compiled to the same
   * code, so the names, comments and constants on screen are *a* source for
   * this bytecode rather than provably *the* one. `"unknown"` is the explorer
   * declining to say, and `null` is `sourceVerified` being null anyway.
   *
   * The distinction earns a field because the Auditor draws negative
   * conclusions from source — "no privileged capabilities" — and that sentence
   * is only as strong as the match behind it (§9).
   */
  sourceMatch: "full" | "partial" | "unknown" | null;
  compilerVersion: string | null;
  inventory: FunctionInventory;
}

// ── Authority resolution (M6) ───────────────────────────────────────────

export type AuthorityKind =
  | "eoa"
  | "ownable"
  | "ownable-two-step"
  | "access-control"
  | "proxy-admin"
  | "beacon-owner"
  | "safe-multisig"
  | "timelock"
  | "factory-operator"
  | "unknown";

export interface AuthorityResolution {
  kind: AuthorityKind;
  controller: string | null;
  /** AccessControl only: role -> admin-role, at least for roles gating a detected capability. */
  roleGraph?: Record<string, string> | null;
  safe?: SafeResolution;
  timelockDelaySeconds?: number | null;
  /** Which capability this specific authority actually controls (materiality idiom, checks.ts:646-718). */
  materialityNote?: string;
  /**
   * Which capabilities this authority is known to gate. KNOWN-PROBLEMS L53: the
   * accusation used to name a capability and a controller resolved
   * INDEPENDENTLY, with nothing able to check that the one could call the
   * other — the join was unverifiable by construction. Absent means unknown,
   * never "none": a consumer must hedge, not clear (§4).
   */
  capabilities?: Capability[];
  /**
   * `factory-operator` only: the address ownership passes to when the custodian lets go, read
   * from the custodian's own record (lib/audit/doppler-airlock.ts). Absent means not read.
   */
  handoffTo?: string | null;
}

// ── Targeted probes (M7) ────────────────────────────────────────────────

export interface ProbeResult {
  capability: Capability;
  /** Which registered adapter ran this probe; null when nothing matched (correction 6 — never a guessed call). */
  adapterId: string | null;
  status: ProbeStatus;
  detail: string;
  evidence: Record<string, unknown>;
}

export interface ProbeAdapterMatchArgs {
  capabilities: CapabilityFinding[];
  abi: readonly unknown[] | null;
  runtimeCode: string | null;
}

/**
 * A probe adapter recognizes ONE specific, concrete protocol shape (e.g. the
 * `lock/unlock(uint256)` pattern from the PRD's own ARROW smoke evidence) and
 * knows the exact calldata/caller convention for it. Correction (post-review):
 * this replaces a single generic "call whatever selector looks relevant"
 * prober — synthesizing calldata against an unrecognized ABI is unsafe and
 * misrepresents what was actually tested.
 */
export interface ProbeAdapter {
  id: string;
  matches(args: ProbeAdapterMatchArgs): boolean;
  run(ctx: AuditReadContext, address: string, authority: AuthorityResolution): Promise<ProbeResult>;
}

// ── Top-level audit result (target shape for M8's verdict.contractAudit) ──

export interface ContractAuditResult {
  completeness: Completeness;
  proxyGraph: ProxyResolution;
  /** Name, verification state and callable surface of the ANALYSED target (the implementation for a resolved proxy). */
  identity: ContractIdentity;
  capabilities: CapabilityFinding[];
  authorities: AuthorityResolution[];
  /**
   * Which capabilities are still exercisable. An absent entry means NO CLAIM —
   * consumers must read a missing capability as live, never as spent.
   */
  capabilityLiveness: CapabilityLiveness[];
  trustAssertionsUsed: string[];
  evidenceHashes: { runtimeCodeHash: string | null; abiHash: string | null; sourceHash: string | null };
  truncationReason: string | null;
  /**
   * Did every read in this audit happen at the one block the run pinned?
   *
   * L104: before 2026-09-09 the audit stamped a block it never read at, so its
   * facts were not mutually consistent. True means they are. False means the
   * node refused the pinned block mid-run and the reads finished at `latest`,
   * which is still a usable audit but not a snapshot of one block, and no
   * instance row is kept for it.
   */
  blockPinned: boolean;
  /** Why the pin was dropped. Null when it held. */
  blockPinDegradedReason: string | null;
}
