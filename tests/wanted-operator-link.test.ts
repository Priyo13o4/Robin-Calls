import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { linkOperatorPairs } from "../lib/data/wanted";
import { SHARED_FUNDER_MAX_FUNDEES } from "../lib/config/lineage";

// Prod 2026-09-15: HONOR's deployer 0x9161e973 was funded by 0x238e61fa (hop 1); DOOS's deployer
// 0x5264577d by 0x8d162b03, itself funded by 0x238e61fa (hop 2). 0x238e61fa paid 2 wallets and is
// not a hub. It was the only upstream wallet shared by any two of the 6 indicted deployers.
const HONOR = "0x9161e97387acdb9675032ac30ccead0d672ba1dc";
const DOOS = "0x5264577d9a8a2791c3fe304a0448ea2c8c3f1ac0";
const FUNDER = "0x238e61fa4210ed108cd1be2f5663d94ac8ca0e71";
const MID = "0x8d162b03aa61205b7311078d43dc10582930d142";
const stains = [
  { dep: HONOR, via: FUNDER },
  { dep: HONOR, via: "0x3ba99da9eca6d3a87a3f88de9011a611e2fd00d2" },
  { dep: DOOS, via: MID },
  { dep: DOOS, via: FUNDER },
];

test("HONOR and DOOS are joined through their shared funder, both ways", () => {
  const pairs = linkOperatorPairs(stains, stains, new Set(), new Map([[FUNDER, 2]]));
  assert.ok(pairs.length > 0, "found a pair");
  assert.deepEqual(
    pairs.map((p) => [p.dep, p.other, p.via]).sort(),
    [[DOOS, HONOR, FUNDER], [HONOR, DOOS, FUNDER]].sort(),
  );
});

test("a hub never links anyone, however few edges we stored for it", () => {
  assert.deepEqual(linkOperatorPairs(stains, stains, new Set([FUNDER]), new Map([[FUNDER, 2]])), []);
});

test("a funder past the plumbing threshold never links anyone", () => {
  const busy = new Map([[FUNDER, SHARED_FUNDER_MAX_FUNDEES + 1]]);
  assert.deepEqual(linkOperatorPairs(stains, stains, new Set(), busy), []);
  const atLimit = new Map([[FUNDER, SHARED_FUNDER_MAX_FUNDEES]]);
  assert.equal(linkOperatorPairs(stains, stains, new Set(), atLimit).length, 2);
});

test("a deployer is never its own operator link, and duplicates collapse", () => {
  const self = [{ dep: HONOR, via: FUNDER }, { dep: HONOR, via: FUNDER }];
  assert.deepEqual(linkOperatorPairs(self, self, new Set(), new Map()), []);
});

test("WIRING: the board and the rug page render the link only when it exists", () => {
  for (const f of ["../app/wanted/page.tsx", "../app/wanted/[deployer]/page.tsx"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.ok(src.length > 500, `read ${f}`);
    assert.match(src, /(operator_rugs|operatorRugs)\.length > 0 &&/, f);
    assert.match(src, /href=\{`\/wanted\/\$\{o\.deployer\}`\}/, f);
    assert.match(src, /<CopyAddressChip address=\{o\.token_address\} compact \/>/, f);
  }
  const data = readFileSync(new URL("../lib/data/wanted.ts", import.meta.url), "utf8");
  assert.match(data, /operator_rugs: operatorRugs\.get\(r\.address\.toLowerCase\(\)\) \?\? \[\]/);
  assert.match(data, /operatorRugs: \(await readOperatorRugs\(\[addr\]\)/);
});
