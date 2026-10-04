import type { TraceEntry } from "./types";

/**
 * Reading an audit payload for display.
 *
 * Separated from the card that renders it (`app/components/agent/AuditCard.tsx`)
 * because this is where the meaning lives, and meaning is what has to be
 * tested. Every function below exists to preserve one distinction that a
 * paragraph — or a careless renderer — collapses:
 *
 *   - verified / not verified / **we could not establish it**
 *   - a signature read from an ABI / a name guessed from a selector table
 *   - a modifier that gates WHO may call / one that gates re-entrancy
 *   - "no capability matched" / "the analysis did not finish"
 *
 * Each of those has already been got wrong somewhere in this system, and each
 * one turns a careful finding into a false statement about a contract.
 */

type Json = Record<string, unknown>;

export const isObj = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strings = (v: unknown): string[] =>
  arr(v).filter((s): s is string => typeof s === "string" && s.length > 0);

/** How a capability was identified, ranked, in the reader's language. */
export interface ConfidenceTier {
  word: string;
  hint: string;
  /** 3 = read from source … 0 = unclassified. Used for colour, never for scoring. */
  rank: 3 | 2 | 1 | 0;
}

export const CONFIDENCE_TIERS: Record<string, ConfidenceTier> = {
  "verified-semantic": {
    word: "READ FROM SOURCE",
    hint: "traced to a concrete write in the contract's own verified source",
    rank: 3,
  },
  heuristic: {
    word: "PATTERN MATCH",
    hint: "resembles this power, through indirection the analyser could not fully trace — expect false positives",
    rank: 2,
  },
  "selector-hint": {
    word: "SELECTOR ONLY",
    hint: "a matching function selector exists in the bytecode; nothing is known about what it does",
    rank: 1,
  },
  unresolved: {
    word: "UNCLASSIFIED",
    hint: "capability-relevant code whose effect could not be classified at all",
    rank: 0,
  },
};

/**
 * An unrecognised confidence string must never render as the strongest tier.
 * The enum has changed before, and a display that fails open would quietly
 * present a downgrade as a source reading.
 */
export function confidenceTier(value: unknown): ConfidenceTier {
  const key = typeof value === "string" ? value : "";
  return CONFIDENCE_TIERS[key] ?? CONFIDENCE_TIERS.unresolved;
}

export interface AuditFinding {
  capability: string;
  confidence: string;
  tier: ConfidenceTier;
  signatures: string[];
  /** Modifiers that gate WHO may call. */
  gatingModifiers: string[];
  /** Modifiers that gate something else entirely (re-entrancy, pause state). */
  otherModifiers: string[];
  probeStatus: string | null;
}

/**
 * Modifiers that restrict the CALLER, as opposed to those that restrict when or
 * how re-entrantly a call may happen.
 *
 * `nonReentrant` and `whenNotPaused` are the two that matter here: a function
 * carrying only those is callable by anyone, and describing it as "gated" would
 * turn an open door into a locked one in the reader's head. Matching on the
 * `only*` / `require*` / `auth*` / `gov*` prefixes covers the conventions in
 * use (onlyOwner, onlyRole, onlyAdminSatellite, onlyGovernance, requiresAuth)
 * without pretending to be exhaustive — an unrecognised modifier falls into
 * `other`, which understates the gating rather than inventing it.
 */
export function isAuthorityModifier(name: string): boolean {
  return /^(only|require|restricted|auth|gov)/i.test(name.trim());
}

export function readFindings(value: Json): AuditFinding[] {
  // A RECORDED audit carries both `capabilities` (the cached artifact's) and
  // `findings` (the instance's — the same list with probe outcomes folded in).
  // Prefer the richer one. A live audit only has `capabilities`.
  const source = arr(value.findings).length > 0 ? arr(value.findings) : arr(value.capabilities);
  return source.filter(isObj).map((f) => {
    const modifiers = isObj(f.evidence) ? strings(f.evidence.modifiers) : [];
    return {
      capability: str(f.capability) ?? "UNKNOWN",
      confidence: str(f.confidence) ?? "unresolved",
      tier: confidenceTier(f.confidence),
      signatures: strings(f.functionSignatures),
      gatingModifiers: modifiers.filter(isAuthorityModifier),
      otherModifiers: modifiers.filter((m) => !isAuthorityModifier(m)),
      probeStatus: str(f.probeStatus),
    };
  });
}

export type Verification = "verified" | "partial" | "unverified" | "unestablished";

/**
 * Four states now, and each extra one exists because collapsing it lost a fact.
 *
 * `null` means the explorer read did not complete — rendering that as
 * "unverified" would be a claim about the contract manufactured out of a failed
 * HTTP call (CLAUDE.md §8.9).
 *
 * `"partial"` means Blockscout matched the runtime bytecode but not the
 * metadata hash — in practice it served source from `eth_bytecode_db`, i.e.
 * from some other address that compiled to the same code. The names and
 * comments on screen are *a* source for this bytecode, not provably *the* one.
 * It arrived as `is_verified: true` and was therefore drawn as a plain SOURCE
 * VERIFIED, under which the Auditor published "no privileged capabilities" —
 * a negative conclusion is exactly the kind that cannot outrun the strength of
 * its match.
 */
export function verificationOf(value: unknown, sourceMatch?: unknown): Verification {
  if (value === true) return sourceMatch === "partial" ? "partial" : "verified";
  if (value === false) return "unverified";
  return "unestablished";
}

export interface SurfaceSummary {
  /** "abi" | "dispatcher" | "none" */
  source: string;
  /** How to describe the count without asserting more than was observed. */
  countLabel: string;
  /** Names to print: real signatures on the ABI path, selectors (or a table label) otherwise. */
  entries: string[];
  /** True when `entries` are selectors whose mutability is NOT observable. */
  mutabilityUnknown: boolean;
}

export function readSurface(identity: Json): SurfaceSummary {
  const inventory = isObj(identity.inventory) ? identity.inventory : {};
  const source = str(inventory.source) ?? "none";
  const functions = arr(inventory.functions).filter(isObj);
  const readOnly = typeof inventory.readOnlyCount === "number" ? inventory.readOnlyCount : null;

  const entries = functions
    .map((f) => str(f.signature) ?? str(f.label) ?? str(f.selector))
    .filter((s): s is string => Boolean(s));

  if (source === "abi") {
    return {
      source,
      countLabel:
        `${functions.length} STATE-CHANGING` + (readOnly === null ? "" : ` · ${readOnly} READ-ONLY`),
      entries,
      mutabilityUnknown: false,
    };
  }
  if (source === "dispatcher") {
    // Never "write functions". The dispatcher does not carry mutability, and
    // calling these writes would invent the one fact the bytecode cannot give.
    return {
      source,
      countLabel: `${functions.length} DISPATCHED SELECTORS · MUTABILITY UNKNOWN`,
      entries,
      mutabilityUnknown: true,
    };
  }
  return { source, countLabel: "SURFACE NOT ENUMERATED", entries: [], mutabilityUnknown: true };
}

/**
 * Why the capability list is empty — which is a different question from whether
 * it is empty, and the only one worth printing.
 *
 * "No capabilities found" is returned identically by a contract that holds no
 * privileged power and by one whose source was never read. Three distinct
 * situations hide behind that sentence and each licenses a different claim:
 *
 * - `bytecode-only` — there was no verified source, so the classifier only ever
 *   had selectors to go on. Nothing failed; there was simply far less to read.
 *   This must NOT be reported as an analysis that fell short, which is what an
 *   ordering that tests `completeness` first would say about every unverified
 *   contract on the chain.
 * - `lookup-failed` — we could not even establish whether source exists. The
 *   weakest position of the three, and the one most easily mistaken for the
 *   first.
 * - `incomplete` — source WAS read and the analysis still did not finish.
 * - `clean-read` — the only one that licenses "no privileged capability is
 *   present in this source", and even then only about the source.
 */
export type EmptyReason =
  | "bytecode-only"
  | "lookup-failed"
  | "incomplete"
  | "partial-match"
  | "clean-read";

export function emptyFindingsReason(
  verification: Verification,
  completeness: string,
): EmptyReason {
  if (verification === "unverified") return "bytecode-only";
  if (verification === "unestablished") return "lookup-failed";
  // Checked before `completeness`, and not merely folded into "incomplete":
  // the analysis here DID finish, over source that may belong to a different
  // address. "We could not finish reading it" and "we read all of something we
  // cannot prove is this" are different admissions, and only the second one
  // tells the reader which way to be sceptical.
  if (verification === "partial") return "partial-match";
  return completeness === "complete" ? "clean-read" : "incomplete";
}

/**
 * The audit block from this turn's trace, or null when none reached the browser.
 *
 * `payload` is absent for server-locale tools on the our-models path — the
 * result never leaves the server — so the card renders for every live audit and
 * for a recorded one only on BYOK. That is the honest behaviour: there is
 * nothing to draw from a payload we do not have.
 */
export function findAuditPayload(
  trace: TraceEntry[] | undefined,
): { value: Json; live: boolean } | null {
  if (!trace) return null;
  for (const entry of trace) {
    if (entry.name !== "run_contract_audit" && entry.name !== "get_contract_audit") continue;
    const value = entry.payload?.value;
    // `identity` is what marks this as an audit-v4 payload the card can draw.
    // An older stored instance has none, and a card with no subject line is
    // worse than no card — the prose still says everything either way.
    if (!isObj(value) || !isObj(value.identity)) continue;
    return { value, live: entry.name === "run_contract_audit" };
  }
  return null;
}
