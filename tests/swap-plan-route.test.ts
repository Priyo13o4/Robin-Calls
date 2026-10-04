import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { httpStatusForPlan } from "../app/api/swap/plan/route";
import type { SwapPlanResponse } from "../lib/swap/types";

/**
 * Extracts union members directly from SwapPlanResponse in lib/swap/types.ts
 * so tests verify the full type union without hardcoding a driftable list.
 */
function extractPlanStatuses(): SwapPlanResponse["status"][] {
  const src = readFileSync(new URL("../lib/swap/types.ts", import.meta.url), "utf8");
  const start = src.indexOf("export type SwapPlanResponse");
  assert.ok(start !== -1, "SwapPlanResponse type definition must exist in lib/swap/types.ts");
  const after = src.slice(start);
  const nextExport = after.slice(1).search(/\nexport /);
  const block = nextExport !== -1 ? after.slice(0, nextExport + 1) : after;
  const statuses = [...block.matchAll(/status:\s*"([^"]+)"/g)].map(
    (m) => m[1] as SwapPlanResponse["status"],
  );
  return statuses;
}

test("httpStatusForPlan maps every SwapPlanResponse union status to pinned HTTP status code", () => {
  const statuses = extractPlanStatuses();
  // Guard against silent extraction failures that would let tests pass vacuously (CLAUDE.md §8 #22).
  assert.ok(
    statuses.length >= 8,
    `expected at least 8 statuses from SwapPlanResponse, found ${statuses.length}`,
  );

  const unique = new Set(statuses);
  assert.equal(unique.size, statuses.length, "extracted statuses must not contain duplicates");
  assert.ok(unique.has("invalid"), "extracted statuses must include 'invalid'");
  assert.ok(unique.has("config-unavailable"), "extracted statuses must include 'config-unavailable'");
  assert.ok(unique.has("ready"), "extracted statuses must include 'ready'");

  for (const status of statuses) {
    const code = httpStatusForPlan(status);
    if (status === "invalid") {
      assert.equal(code, 400, `status ${status} must map to 400`);
    } else if (status === "config-unavailable") {
      assert.equal(code, 503, `status ${status} must map to 503`);
    } else {
      assert.equal(code, 200, `status ${status} must map to 200`);
    }
  }
});

test("nothing on the wire is a bigint, which is the only way this response fails to serialize", () => {
  // The test this replaces built a ~100-line object literal of strings and numbers and
  // asserted JSON.stringify did not throw. It called no production function and every field
  // was already JSON-safe, so it could not fail under any change to the route or the builder.
  //
  // The real hazard is a `bigint` reaching NextResponse.json, which throws at runtime. Amounts
  // in this codebase ARE bigints everywhere else, so the wire types carrying them as strings
  // is a live convention, not a tautology. Assert the convention where it is decided.
  const src = readFileSync(new URL("../lib/swap/types.ts", import.meta.url), "utf8");
  const wire = src.slice(src.indexOf("export type SimulationView"));
  assert.ok(wire.length > 400, "guard: the wire types must still be found");
  const offenders = wire
    .split("\n")
    .filter((line) => /\bbigint\b/.test(line) && !line.trimStart().startsWith("*") && !line.trimStart().startsWith("//"));
  assert.deepEqual(
    offenders,
    [],
    `a bigint on the wire throws inside NextResponse.json: ${offenders.join(" | ")}`,
  );
});
