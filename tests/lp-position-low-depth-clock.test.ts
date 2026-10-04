import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isFreshLowDepthObservation } from "../lib/data/swap-pools";

const NOW = Date.parse("2026-10-02T00:00:00.000Z");

test("a fresh priced depth below the threshold starts or preserves the low-depth clock", () => {
  assert.equal(isFreshLowDepthObservation({ depthUsd: "99.99", readAt: new Date(NOW - 60_000).toISOString() }, 100, NOW), true);
  assert.equal(isFreshLowDepthObservation({ depthUsd: "0", readAt: new Date(NOW).toISOString() }, 100, NOW), true);
});

test("high, unpriced, missing-time, future, and stale observations reset the low-depth clock", () => {
  const cases = [
    { depthUsd: "100", readAt: new Date(NOW).toISOString() },
    { depthUsd: null, readAt: new Date(NOW).toISOString() },
    { depthUsd: undefined, readAt: new Date(NOW).toISOString() },
    { depthUsd: "20", readAt: null },
    { depthUsd: "20", readAt: new Date(NOW + 1).toISOString() },
    { depthUsd: "20", readAt: new Date(NOW - 48 * 60 * 60 * 1000 - 1).toISOString() },
  ] as const;

  for (const row of cases) assert.equal(isFreshLowDepthObservation(row, 100, NOW), false);
});

test("wiring: the low-depth VALUES list casts every column, or Postgres reads them as text", () => {
  const src = readFileSync(new URL("../lib/data/swap-pools.ts", import.meta.url), "utf8");
  const start = src.indexOf("const observations = chunk.map(");
  assert.ok(start > 0, "the observations list must be found");
  const list = src.slice(start, src.indexOf("`);", start));
  assert.match(list, /\}::text,/);
  assert.match(list, /\}::boolean,/);
  assert.match(list, /\}::timestamptz/);
});

test("wiring: prune never passes a bare JS array as a Postgres array", () => {
  const src = readFileSync(new URL("../lib/data/lp-positions-prune.ts", import.meta.url), "utf8");
  assert.match(src, /unnest\(array\[\$\{sql\.join\(/, "the prune batch must build an explicit array");
  assert.doesNotMatch(src, /\$\{[a-zA-Z]+\}::text\[\]/, "drizzle expands ${array} into a record, which cannot cast to text[]");
});
