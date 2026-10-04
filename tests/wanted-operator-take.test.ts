import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aggregateOperatorTake, operatorTakeUsd } from "../lib/data/wanted";

// Operator decision 2026-09-15: the board shows what the operator took, not pool TVL lost.
// MAO's rug row: extracted_usd $3,629.33 (TVL), takeCeilingUsd $1,818.87, chain take ~$1,640.

test("a measured take wins over the ceiling; the ceiling is marked as one", () => {
  assert.deepEqual(operatorTakeUsd({ operatorTakeUsd: 1640, takeCeilingUsd: 1818.87 }), { usd: 1640, measured: true });
  assert.deepEqual(operatorTakeUsd({ takeCeilingUsd: 1818.87 }), { usd: 1818.87, measured: false });
});

test("zero is a figure, junk is not (§8 #3)", () => {
  assert.deepEqual(operatorTakeUsd({ operatorTakeUsd: 0 }), { usd: 0, measured: true });
  assert.deepEqual(operatorTakeUsd({ takeCeilingUsd: 0 }), { usd: 0, measured: false });
  for (const bad of [{ takeCeilingUsd: "1818" }, { takeCeilingUsd: Number.NaN }, { takeCeilingUsd: -1 }, {}, null, "x"]) {
    assert.equal(operatorTakeUsd(bad), null, JSON.stringify(bad));
  }
});

test("a deployer's total sums its rows and says 'up to' if any row is a ceiling", () => {
  assert.deepEqual(aggregateOperatorTake([{ evidence: { operatorTakeUsd: 100 } }, { evidence: { takeCeilingUsd: 50 } }]), {
    taken_usd: 150,
    taken_is_ceiling: true,
  });
  assert.deepEqual(aggregateOperatorTake([{ evidence: { operatorTakeUsd: 100 } }]), { taken_usd: 100, taken_is_ceiling: false });
  assert.deepEqual(aggregateOperatorTake([{ evidence: {} }]), { taken_usd: null, taken_is_ceiling: false });
  assert.deepEqual(aggregateOperatorTake([]), { taken_usd: null, taken_is_ceiling: false });
});

test("WIRING: no public board surface renders the TVL column any more", () => {
  const files = [
    "../app/wanted/page.tsx",
    "../app/wanted/[deployer]/page.tsx",
    "../app/admin/(dashboard)/wanted/page.tsx",
    "../app/components/site/landing/RecordSection.tsx",
    "../app/components/site/landing/ProductGrid.tsx",
  ];
  for (const f of files) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.ok(src.length > 500, `read ${f}`);
    assert.doesNotMatch(src, /extracted_usd|extractedUsd/, f);
    assert.match(src, /taken_usd|takenUsd/, f);
  }
  const data = readFileSync(new URL("../lib/data/wanted.ts", import.meta.url), "utf8");
  assert.match(data, /takes\.set\(id, aggregateOperatorTake\(depRugs\)\)/);
  assert.match(data, /const take = aggregateOperatorTake\(rugRows\);/);
});
