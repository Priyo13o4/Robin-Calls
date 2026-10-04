import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A5 (KNOWN-PROBLEMS L58) — "assert the WIRING, not just the logic" (CLAUDE.md
 * §8 #10). `tests/launch-shape.test.ts` already pins `classifyLaunchShape`
 * itself; this file pins the one property that actually matters — that its
 * result can NEVER reach a status decision, per launch-shape.ts's hard
 * constraint. Flags here are computed once at module load (see flags.ts), so
 * per the established convention (tests/whale-audit-wiring.test.ts) this is a
 * source-grep test, not a live toggle.
 */

const v3CustodySrc = readFileSync(
  join(__dirname, "../lib/dex/v3-custody.ts"),
  "utf8",
);
const custodyFindingsSrc = readFileSync(
  join(__dirname, "../lib/scanner/checks/custody-findings.ts"),
  "utf8",
);

test("v3-custody.ts computes launch shape but never feeds it to decideCustodyState", () => {
  assert.match(v3CustodySrc, /import\s*\{\s*classifyLaunchShape/);
  const call = v3CustodySrc.match(/decideCustodyState\(\{[\s\S]*?\}\);/);
  assert.ok(call, "decideCustodyState call site not found");
  assert.doesNotMatch(
    call![0],
    /launchShape/i,
    "decideCustodyState must not read launchShape — it decides `state`, which launch-shape.ts's hard constraint forbids influencing",
  );
});

test("the launchShape evidence field is assembled AFTER `state` is decided", () => {
  const stateIdx = v3CustodySrc.indexOf("const state = decideCustodyState({");
  const evidenceIdx = v3CustodySrc.indexOf("...(launchShape?.matched ? { launchShape: launchShape.label } : {})");
  assert.ok(stateIdx > 0 && evidenceIdx > 0, "expected markers not found");
  assert.ok(
    evidenceIdx > stateIdx,
    "launchShape evidence must be built after `state`, proving `state` could not have read it",
  );
});

test("the extra token0()+receipt reads are gated on the flag", () => {
  assert.match(
    v3CustodySrc,
    /flags\.launchShapeRecognition\s*&&\s*mints\.length\s*>\s*0/,
    "launch-shape recognition must be flag-gated, matching every other Phase-2 addition",
  );
});

test("the LP_CONCENTRATED hedge sentence reads launchShape only in `reason`, never in `status`", () => {
  const block = custodyFindingsSrc.match(/case "LP_CONCENTRATED": \{[\s\S]*?\n {4}\}/);
  assert.ok(block, "LP_CONCENTRATED branch not found");
  const statusLine = block![0].match(/status:\s*[^,]+,/);
  assert.ok(statusLine, "status assignment not found in LP_CONCENTRATED branch");
  assert.doesNotMatch(
    statusLine![0],
    /launchShape/i,
    "status must be decided by whaleConfidence alone, never by the launch-shape hedge",
  );
  assert.match(
    block![0],
    /launchShapeNote/,
    "expected the hedge sentence to actually be wired into the reason string",
  );
});

test("MintLog's amount0/amount1 are strings, not bigint, and come from the store row's amounts", () => {
  // A5 needs the Mint's raw amounts; viem decodes them as bigint, the store holds strings.
  const interfaceBlock = v3CustodySrc.match(/interface MintLog \{[\s\S]*?\n\}/);
  assert.ok(interfaceBlock, "MintLog interface not found");
  assert.match(interfaceBlock![0], /amount0:\s*string;/);
  assert.match(interfaceBlock![0], /amount1:\s*string;/);
  assert.doesNotMatch(interfaceBlock![0], /amount[01]:\s*bigint/);
  // The store mapper (v3PositionEvents) throws on a missing amount, so no "0" default can stand in for one.
  assert.match(v3CustodySrc, /amount0:\s*m\.amount0,/);
  assert.match(v3CustodySrc, /amount1:\s*m\.amount1,/);
  assert.doesNotMatch(v3CustodySrc, /amount0\s*\?\?\s*"0"/);
});

test("classifyLaunchShape's return type carries no status vocabulary (compile-time cross-check)", () => {
  // Mirrors tests/launch-shape.test.ts's runtime pin — kept here too so a
  // reader auditing WIRING sees the hard constraint enforced from both ends.
  const launchShapeSrc = readFileSync(join(__dirname, "../lib/dex/launch-shape.ts"), "utf8");
  assert.match(launchShapeSrc, /export interface LaunchShapeRecognition \{\s*matched: boolean;\s*label: LaunchShapeLabel \| null;\s*\}/);
});
