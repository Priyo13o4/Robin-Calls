import test from "node:test";
import assert from "node:assert/strict";
import {
  confidenceTier,
  emptyFindingsReason,
  findAuditPayload,
  isAuthorityModifier,
  readFindings,
  readSurface,
  verificationOf,
} from "../lib/agent/audit-view";
import type { TraceEntry } from "../lib/agent/types";

/**
 * What the audit card is allowed to say.
 *
 * The card exists because a paragraph loses qualifiers first: in the transcript
 * that prompted it, a SUPPLY_MINT finding at `heuristic` confidence on a
 * function named `deposit()` was narrated as a mint function, flatly. Every
 * distinction asserted below is one that, collapsed, turns a careful finding
 * into a false statement about somebody's contract.
 */

function entry(name: string, value: unknown): TraceEntry {
  return {
    id: "t1",
    name,
    locale: name === "run_contract_audit" ? "client" : "server",
    outcome: "found",
    durationMs: 12,
    payload: { ok: true, found: true, value },
  };
}

const IDENTITY = {
  name: "LockerV2",
  sourceVerified: true,
  compilerVersion: "v0.8.30",
  inventory: {
    source: "abi",
    completeness: "complete",
    functions: [
      { selector: "0x1", signature: "lockPosition(address)", label: null, mutability: "write", payable: false },
      { selector: "0x2", signature: "collectFees(address)", label: null, mutability: "write", payable: false },
    ],
    readOnlyCount: 9,
    selectorsNotInAbi: [],
  },
};

// ── confidence ─────────────────────────────────────────────────────────────

test("each confidence value keeps its own word and its own rank", () => {
  assert.equal(confidenceTier("verified-semantic").rank, 3);
  assert.equal(confidenceTier("heuristic").rank, 2);
  assert.equal(confidenceTier("selector-hint").rank, 1);
  assert.equal(confidenceTier("unresolved").rank, 0);
  assert.notEqual(
    confidenceTier("heuristic").word,
    confidenceTier("verified-semantic").word,
    "a pattern match must not be worded like a source reading — this is the exact " +
      "collapse that reported SUPPLY_MINT on deposit() as fact",
  );
});

test("an unrecognized confidence fails to the WEAKEST tier, never the strongest", () => {
  // The enum has changed before. A display that failed open would silently
  // present a downgraded finding as source-verified.
  for (const junk of ["bytecode-selector", "", undefined, null, 7, "VERIFIED-SEMANTIC"]) {
    assert.equal(confidenceTier(junk).rank, 0, `"${String(junk)}" must not outrank anything`);
  }
});

// ── modifiers ──────────────────────────────────────────────────────────────

test("authority modifiers are separated from safety modifiers", () => {
  // A function carrying only nonReentrant is callable by ANYONE. Reporting it
  // as gated turns an open door into a locked one.
  for (const gating of ["onlyOwner", "onlyRole(MINTER)", "onlyAdminSatellite", "requiresAuth", "onlyGovernance"]) {
    assert.ok(isAuthorityModifier(gating), `${gating} restricts the caller`);
  }
  for (const safety of ["nonReentrant", "whenNotPaused", "payable", "virtual"]) {
    assert.ok(!isAuthorityModifier(safety), `${safety} does not restrict the caller`);
  }
});

test("an unrecognized modifier understates the gating rather than inventing it", () => {
  assert.ok(!isAuthorityModifier("someCustomGuard"));
});

test("findings carry the function, the tier and the modifier split", () => {
  const [f] = readFindings({
    capabilities: [
      {
        capability: "SUPPLY_MINT",
        confidence: "heuristic",
        functionSignatures: ["deposit(uint256)"],
        evidence: { modifiers: ["nonReentrant"] },
      },
    ],
  });
  assert.equal(f.capability, "SUPPLY_MINT");
  assert.equal(f.tier.rank, 2);
  assert.deepEqual(f.signatures, ["deposit(uint256)"]);
  assert.deepEqual(f.gatingModifiers, [], "nonReentrant gates nothing about authority");
  assert.deepEqual(f.otherModifiers, ["nonReentrant"]);
});

test("a recorded audit's probed findings win over the artifact's unprobed copy", () => {
  // The instance's `findings` are the same capabilities with probe outcomes
  // folded in; the artifact's `capabilities` are not. Reading the wrong one
  // discards the strongest evidence in the payload.
  const findings = readFindings({
    capabilities: [{ capability: "FEE_CHANGE", confidence: "verified-semantic", functionSignatures: [] }],
    findings: [
      {
        capability: "FEE_CHANGE",
        confidence: "verified-semantic",
        functionSignatures: ["setFee(uint256)"],
        probeStatus: "reverted",
      },
    ],
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].probeStatus, "reverted");
  assert.deepEqual(findings[0].signatures, ["setFee(uint256)"]);
});

// ── verification, the three-state one ──────────────────────────────────────

test("verification has three states and null is not 'unverified'", () => {
  assert.equal(verificationOf(true), "verified");
  assert.equal(verificationOf(false), "unverified");
  assert.equal(
    verificationOf(null),
    "unestablished",
    "the explorer read failed — that is a fact about our lookup, not about the contract",
  );
  assert.equal(verificationOf(undefined), "unestablished");
});

// ── the callable surface ───────────────────────────────────────────────────

test("an ABI surface counts state-changing functions and discloses the views", () => {
  const s = readSurface(IDENTITY);
  assert.equal(s.mutabilityUnknown, false);
  assert.match(s.countLabel, /2 STATE-CHANGING/);
  assert.match(s.countLabel, /9 READ-ONLY/);
  assert.deepEqual(s.entries, ["lockPosition(address)", "collectFees(address)"]);
});

test("a dispatcher surface never calls its selectors write functions", () => {
  const s = readSurface({
    inventory: {
      source: "dispatcher",
      functions: [
        { selector: "0xa9059cbb", signature: null, label: "transfer(address,uint256)", mutability: "unknown" },
        { selector: "0xaabbccdd", signature: null, label: null, mutability: "unknown" },
      ],
      readOnlyCount: null,
    },
  });
  assert.equal(s.mutabilityUnknown, true);
  assert.match(s.countLabel, /MUTABILITY UNKNOWN/);
  assert.doesNotMatch(s.countLabel, /STATE-CHANGING|WRITE/);
  // The label stands in for a name we do not have; the bare selector stands for
  // one we could not even guess.
  assert.deepEqual(s.entries, ["transfer(address,uint256)", "0xaabbccdd"]);
});

test("a surface that was never enumerated says so instead of showing nothing", () => {
  const s = readSurface({ inventory: { source: "none", functions: [], readOnlyCount: null } });
  assert.equal(s.countLabel, "SURFACE NOT ENUMERATED");
  assert.deepEqual(s.entries, []);
});

test("a missing identity does not crash the reader", () => {
  assert.equal(readSurface({}).countLabel, "SURFACE NOT ENUMERATED");
});

// ── why the list is empty ──────────────────────────────────────────────────

test("an unverified contract is 'bytecode-only', not 'the analysis fell short'", () => {
  // Caught in the browser on a real unverified contract. An unverified
  // contract's artifact is `completeness: "unresolved"` BY CONSTRUCTION — there
  // was no source to classify — so testing completeness before verification
  // tells every unverified contract on the chain that our analysis failed.
  // Nothing failed. There was simply far less to read.
  assert.equal(emptyFindingsReason("unverified", "unresolved"), "bytecode-only");
  assert.equal(emptyFindingsReason("unverified", "partial"), "bytecode-only");
});

test("a failed explorer lookup is its own state, weaker than 'unverified'", () => {
  assert.equal(emptyFindingsReason("unestablished", "unresolved"), "lookup-failed");
});

test("only a complete read of verified source licenses the clean wording", () => {
  assert.equal(emptyFindingsReason("verified", "complete"), "clean-read");
  assert.equal(emptyFindingsReason("verified", "partial"), "incomplete");
  assert.equal(emptyFindingsReason("verified", "unresolved"), "incomplete");
});

// ── finding the payload in a trace ─────────────────────────────────────────

test("a live audit is marked live and a recorded one is not", () => {
  const live = findAuditPayload([entry("run_contract_audit", { identity: IDENTITY })]);
  assert.equal(live?.live, true);
  const recorded = findAuditPayload([entry("get_contract_audit", { identity: IDENTITY })]);
  assert.equal(recorded?.live, false);
});

test("a payload with no identity is not drawn at all", () => {
  // A pre-audit-v4 stored instance. A card missing its subject line is worse
  // than no card; the prose still says everything either way.
  assert.equal(findAuditPayload([entry("get_contract_audit", { capabilities: [] })]), null);
});

test("a server-locale result that never reached the browser draws nothing", () => {
  // On the our-models path a server tool's body stays on the server. Rendering
  // an empty card would read as "the audit found nothing".
  const withheld: TraceEntry = {
    id: "t1",
    name: "get_contract_audit",
    locale: "server",
    outcome: "found",
    durationMs: 8,
  };
  assert.equal(findAuditPayload([withheld]), null);
});

test("a trace with no audit call at all draws nothing", () => {
  assert.equal(findAuditPayload([entry("get_latest_verdict", { score: 91 })]), null);
  assert.equal(findAuditPayload(undefined), null);
  assert.equal(findAuditPayload([]), null);
});
