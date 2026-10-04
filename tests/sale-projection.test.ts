import test from "node:test";
import assert from "node:assert/strict";
import {
  LP_SHARE,
  LP_TOKENS,
  RAISE_LADDER_BASE,
  SALE_TOKENS,
  TOTAL_SUPPLY,
  fairLaunchPrice,
  fdvAt,
  fmtPrice,
  fmtUsdPrice,
  liveProjection,
  raiseCeiling,
  scenarioRow,
} from "@/lib/sale/projection";
import {
  ALLOCATION_SHADES,
  TOKENOMICS,
  VESTING,
  VESTING_MONTHS,
  allocationShades,
  circulatingPctAt,
  tokensFor,
  vestedFraction,
  vestingBarGeometry,
} from "@/lib/sale/tokenomics";
import { CITY, CITY_PAINT_ORDER } from "@/app/tokenomics/city-manifest";
import { VESTING_LOCKS } from "@/lib/sale/vesting-locks";
import * as projection from "@/lib/sale/projection";

/**
 * The projection math is what the sale page publishes about price and FDV, so
 * the tests pin the ways it could go wrong: the zero-raise division, the split
 * constants drifting from the 10M supply they must partition, the live panel
 * pricing against the PUBLISHED pool when the chain says something else, and
 * the raise ladder rescaling under a reader instead of growing.
 */

test("no listing price, listing FDV or uplift is exported — the +20% stays gone", () => {
  // Removed by operator decision 2026-09-04, and the way it comes back is as a
  // "harmless" local in one component. This fails the moment the module
  // re-exports any of it, which is the layer every consumer would go through.
  const surface = Object.keys(projection);
  for (const banned of ["listingPrice", "listingFdv", "LISTING_UPLIFT"]) {
    assert.ok(!surface.includes(banned), `${banned} is exported again`);
  }
  const row = scenarioRow(100) as unknown as Record<string, unknown>;
  for (const banned of ["listingPrice", "listingFdv", "uplift"]) {
    assert.ok(!(banned in row), `ScenarioRow carries ${banned} again`);
  }
});

test("raise ladder: 5 ETH until the raise crosses it, then doubles", () => {
  assert.equal(RAISE_LADDER_BASE, 5);
  // At exactly the rung the bar is FULL, not rolled over — "in case we cross".
  assert.equal(raiseCeiling(0), 5);
  assert.equal(raiseCeiling(4.999), 5);
  assert.equal(raiseCeiling(5), 5);
  assert.equal(raiseCeiling(5.0001), 10);
  assert.equal(raiseCeiling(10), 10);
  assert.equal(raiseCeiling(10.5), 20);
  assert.equal(raiseCeiling(20), 20);
  assert.equal(raiseCeiling(21), 40);
  assert.equal(raiseCeiling(640), 640);
  assert.equal(raiseCeiling(641), 1280);
});

test("raise ladder never returns NaN, Infinity or a rung below the base", () => {
  // A bad decode reaches this as a negative or non-finite number, and a NaN
  // ceiling divides the whole axis into NaN% widths with nothing erroring.
  for (const bad of [NaN, Infinity, -Infinity, -1, -0.0001]) {
    const c = raiseCeiling(bad);
    assert.ok(Number.isFinite(c) && c >= RAISE_LADDER_BASE, `raiseCeiling(${bad})=${c}`);
  }
  assert.ok(Number.isFinite(raiseCeiling(1e30)));
});

test("zero raise produces finite cells, not NaN", () => {
  // The raw functions at raised=0 yield 0 prices — the PAGE guards that into a
  // dash (§8 #9). What this pins is that no cell prints NaN: a table cell of
  // "NaN" is the same fake fact in worse clothes.
  const row = scenarioRow(0);
  assert.ok(Number.isFinite(row.fairLaunchPrice));
  assert.ok(Number.isFinite(row.fairLaunchFdv));
  assert.ok(Number.isFinite(row.toLpEth));
});

test("raise levels derive every cell, nothing hand-typed", () => {
  const r = scenarioRow(400);
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9 * Math.max(1, Math.abs(b)), `${a} vs ${b}`);
  near(r.toLpEth, 400 * LP_SHARE);
  near(r.fairLaunchPrice, 400 / SALE_TOKENS);
  near(r.fairLaunchFdv, (400 / SALE_TOKENS) * TOTAL_SUPPLY);
});

test("split constants partition the supply exactly (30/20 of 10M)", () => {
  assert.equal(SALE_TOKENS, 0.3 * TOTAL_SUPPLY);
  assert.equal(LP_TOKENS, 0.2 * TOTAL_SUPPLY);
});

test("liveProjection: faulted read, zero raise, and priced are three distinct states", () => {
  // undefined = the read FAULTED (§8 #9): must not render as zero...
  assert.deepEqual(liveProjection(undefined), { kind: "unavailable" });
  // ...and 0n must not render as a measured price.
  assert.deepEqual(liveProjection(0n), { kind: "zero" });
  const p = liveProjection(300n * 10n ** 18n);
  assert.ok(p && p.kind === "implied");
  assert.equal(p.fairLaunchPrice, 300 / SALE_TOKENS);
  assert.equal(p.fairLaunchFdv, (300 / SALE_TOKENS) * TOTAL_SUPPLY);
  assert.equal(p.raisedEth, 300);
});

test("liveProjection prices against the pool it is HANDED, never only the published split", () => {
  // The live panel passes the chain's tokensForSale; the default (published
  // split) exists for the no-pool case only. If this silently fell back to
  // SALE_TOKENS, the panel could print projections from a pool different from
  // the TOKEN POOL cell beside it — the two-surfaces-disagree failure.
  const raised = 400n * 10n ** 18n;
  const chainPool = 400_000;
  const p = liveProjection(raised, chainPool);
  assert.ok(p && p.kind === "implied");
  assert.equal(p.fairLaunchPrice, 400 / chainPool);
  assert.equal(p.fairLaunchFdv, (400 / chainPool) * TOTAL_SUPPLY);
  // Default still resolves to the published split — and must differ from the
  // drifted one, or the fallback is silently swallowing the disagreement the
  // page's drift banner exists to report.
  const d = liveProjection(raised);
  assert.ok(d && d.kind === "implied");
  assert.equal(d.fairLaunchPrice, 400 / SALE_TOKENS);
  assert.notEqual(d.fairLaunchPrice, p.fairLaunchPrice);
});

test("fmtPrice never emits scientific notation and keeps small prices readable", () => {
  // 1.25e-5 was rendering as "1.25E-5" — correct arithmetic, unreadable money.
  for (const p of [0.0000125, 1.25e-5, 3e-7, 0.0009999, 0.0001]) {
    const s = fmtPrice(p);
    assert.ok(!/[eE]/.test(s), `${p} formatted as ${s}`);
  }
  // Below 0.0001 the zero run becomes a subscript count: 6dp read 0.000000 for a 3e-9 sale price.
  assert.equal(fmtPrice(0.0000125), "0.0₄125");
  assert.equal(fmtPrice(0.01 / 3e6), "0.0₈3333");
  assert.equal(fmtPrice(0.0001), "0.000100");
  assert.equal(fmtUsdPrice((0.01 / 3e6) * 2696.7), "$0.0₅8989");
  assert.equal(fmtPrice(0.5), "0.500000");
  assert.equal(fmtPrice(1.23456), "1.2346");
  assert.equal(fmtPrice(2500), "2,500");
  // NaN never formats into a plausible number.
  assert.equal(fmtPrice(Number.NaN), "—");
});

/**
 * The split is DATA in one file and CONSTANTS in another, and only the
 * constants drive the FDV math. Nothing in the type system pairs
 * `TOKENOMICS[0].pct = 30` with `SALE_TOKENS = 3_000_000`, so an edit to the
 * allocation that misses the constants would leave the page printing "sale
 * pool 30%" beside prices computed from a different pool — §8's silent-drop
 * shape, one layer up. These pin the pairing, the sum, and the breakdown.
 */
test("the published split sums to exactly 100%", () => {
  const total = TOKENOMICS.reduce((n, r) => n + r.pct, 0);
  assert.equal(total, 100, `split sums to ${total}%`);
});

test("every breakdown sums to the row it decomposes", () => {
  for (const row of TOKENOMICS) {
    if (!row.breakdown) continue;
    const sum = row.breakdown.reduce((n, b) => n + b.pct, 0);
    assert.equal(sum, row.pct, `${row.label}: parts sum to ${sum}%, row is ${row.pct}%`);
  }
});

test("token counts derive from the percentages, and the split's counts sum to supply", () => {
  for (const row of TOKENOMICS) {
    assert.equal(tokensFor(row.pct), Math.round((row.pct / 100) * TOTAL_SUPPLY));
  }
  const counted = TOKENOMICS.reduce((n, r) => n + tokensFor(r.pct), 0);
  assert.equal(counted, TOTAL_SUPPLY);
});

test("the sale and LP rows match the constants the FDV math actually uses", () => {
  const sale = TOKENOMICS.find((r) => r.label === "PUBLIC FAIR LAUNCH");
  const lp = TOKENOMICS.find((r) => r.label === "LIQUIDITY");
  assert.ok(sale && lp, "the sale and LP rows must exist by name");
  assert.equal(tokensFor(sale.pct), SALE_TOKENS);
  assert.equal(tokensFor(lp.pct), LP_TOKENS);
});

test("allocation shades are unique per row down to the ramp's length", () => {
  // Colour is the only thing linking a bar to its label; two rows sharing a
  // shade inside the ramp's range would make the legend ambiguous.
  const shades = allocationShades(TOKENOMICS);
  assert.equal(shades.size, TOKENOMICS.length, "every row must get a shade");
  const distinct = new Set([...shades.values()]);
  assert.ok(
    distinct.size >= Math.min(TOKENOMICS.length, ALLOCATION_SHADES.length),
    `${distinct.size} distinct shades for ${TOKENOMICS.length} rows`,
  );
});

/**
 * The schedule is drawn as a chart, and a chart is read as a claim. These pin
 * that the drawing is internally coherent: every row modelled, nothing
 * unlocking backwards, the curve landing on exactly 100% rather than near it,
 * and the operator's 24-month ceiling actually holding.
 */
test("every allocation row has a vesting shape — an unmodelled row would silently read as 0% forever", () => {
  for (const row of TOKENOMICS) {
    assert.ok(VESTING[row.label], `no vesting shape for ${row.label}`);
  }
  // And no orphan shapes pointing at a row that no longer exists.
  const labels = new Set(TOKENOMICS.map((r) => r.label));
  for (const key of Object.keys(VESTING)) {
    assert.ok(labels.has(key), `VESTING has "${key}", which is not an allocation row`);
  }
});

test("the circulating curve is monotonic and reaches exactly 100%", () => {
  let prev = -1;
  for (let m = 0; m <= VESTING_MONTHS; m++) {
    const c = circulatingPctAt(m);
    assert.ok(c >= prev - 1e-9, `circulating fell at month ${m}: ${prev} -> ${c}`);
    prev = c;
  }
  assert.ok(
    Math.abs(circulatingPctAt(VESTING_MONTHS) - 100) < 1e-9,
    `ends at ${circulatingPctAt(VESTING_MONTHS)}%, not 100%`,
  );
});

test("no locked allocation runs past the 24-month ceiling", () => {
  // The schedule's headline promise. VESTING_MONTHS pins the horizon; this
  // pins every row against it, so adding a 36-month row fails here first.
  assert.equal(VESTING_MONTHS, 24);
  for (const [label, v] of Object.entries(VESTING)) {
    const endsAt = v.steps ? v.steps[v.steps.length - 1][0] : Math.max(v.cliff, v.end);
    assert.ok(endsAt <= VESTING_MONTHS, `${label} unlocks at M${endsAt}, past the ${VESTING_MONTHS}-month ceiling`);
  }
});

test("the decided schedules match the operator's structure", () => {
  // Pinned by name: these are commitments now, not shapes to be tweaked.
  const dev = VESTING["DEV & ECOSYSTEM"];
  assert.equal(dev.tge, 0.1);
  assert.equal(dev.cliff, 3);
  assert.equal(dev.end, 24);
  const treasury = VESTING.TREASURY;
  assert.equal(treasury.tge, 0);
  assert.equal(treasury.cliff, 3);
  assert.equal(treasury.end, 24);
  const team = VESTING["TEAM & CONTRIBUTORS"];
  assert.equal(team.tge, 0);
  assert.equal(team.cliff, 6);
  assert.equal(team.end, 24);
});

test("Platform Rewards releases in the operator's steps", () => {
  // 12.5% at TGE, 12.5% at M3, then 25% at M12, M18, M24 (revised 2026-09-30,
  // PinkLock locks mirror it). Flat between steps: no release is drawn early.
  const p = VESTING["PLATFORM REWARD"];
  assert.ok(p.steps, "PLATFORM REWARD must be stepped");
  const expected: [number, number][] = [
    [0, 0.125], [2, 0.125], [3, 0.25], [11, 0.25], [12, 0.5], [17, 0.5], [18, 0.75], [23, 0.75], [24, 1], [36, 1],
  ];
  for (const [m, f] of expected) {
    assert.ok(Math.abs(vestedFraction(p, m) - f) < 1e-9, `M${m}: ${vestedFraction(p, m)}, expected ${f}`);
  }
});

test("every decided row carries an unlock summary in the allocation table", () => {
  // The table's `unlock` prose and the chart's VESTING shape are two renders
  // of one decision; a row gaining a shape without prose (or vice versa) is
  // the two-surfaces-disagree shape.
  for (const row of TOKENOMICS) {
    assert.ok(row.unlock, `${row.label} has a vesting shape but no unlock summary`);
  }
});

test("vestedFraction never leaves [tge, 1], including past the end month", () => {
  for (const label of Object.keys(VESTING)) {
    const v = VESTING[label];
    for (const m of [-5, 0, 1, 3, 6, 12, 24, 36, 120]) {
      const f = vestedFraction(v, m);
      assert.ok(f >= v.tge - 1e-9 && f <= 1 + 1e-9, `${label} at m${m} = ${f}`);
    }
  }
});

/**
 * The bar's DRAWN shape is a second render of the schedule and it carries
 * meaning a reader acts on: colour width reads as "this releases over this
 * span". A number can be right while the bar next to it draws an unwind that
 * does not exist — the airdrop's M1 step once drew as a 24-month ramp. These
 * pin the geometry against the schedule, not against fixed strings.
 */
const parsePct = (s: string) => {
  const n = Number.parseFloat(s);
  assert.ok(s.endsWith("%") && Number.isFinite(n), `not a percent-of-track width: ${s}`);
  return n;
};

test("bar geometry: the coloured span is exactly the schedule's release window", () => {
  for (const row of TOKENOMICS) {
    const v = VESTING[row.label]!;
    const g = vestingBarGeometry(v, VESTING_MONTHS);
    const ramp = parsePct(g.linW);
    const expected = v.end <= v.cliff
      ? v.tge >= 1 ? 0 : (v.cliff / VESTING_MONTHS) * 100 // step: colour only up to the step
      : ((v.end - v.cliff) / VESTING_MONTHS) * 100; // linear: cliff → end
    assert.ok(
      Math.abs(ramp - expected) < 1e-9,
      `${row.label}: bar colours ${ramp}% of track, schedule releases over ${expected}%`,
    );
    // The colour block starts where its release starts — no floating window.
    if (v.end > v.cliff) {
      assert.equal(
        parsePct(g.linLeft),
        (v.cliff / VESTING_MONTHS) * 100,
        `${row.label}: colour block not anchored at the cliff`,
      );
    }
  }
});

test("bar geometry: a step row never draws a ramp past its step", () => {
  // The regression: GENESIS AIRDROP (60% at TGE, 40% at M1) coloured the whole
  // remaining track, drawing a continuous M1→M24 release the schedule does not
  // have. The bar must stop at the step, and the number alone may not carry
  // this — it printed 100% all along.
  const g = vestingBarGeometry(VESTING["GENESIS AIRDROP"]!, VESTING_MONTHS);
  assert.ok(parsePct(g.linW) <= (1 / VESTING_MONTHS) * 100 + 1e-9,
    `airdrop colours ${g.linW} of track for a release that finishes at M1`);
  // 40% arrives AT the cliff, so the hatch must not sit on the release moment.
  assert.equal(g.cliffW, "0%", "airdrop hatches the very month its 40% lands");
});

test("bar geometry: linear rows keep the hatched cliff; settled rows go dark", () => {
  // Hatch = nothing releases here. TEAM has a real 6-month cliff.
  const team = vestingBarGeometry(VESTING["TEAM & CONTRIBUTORS"]!, VESTING_MONTHS);
  assert.equal(parsePct(team.cliffW), (6 / VESTING_MONTHS) * 100);
  assert.equal(parsePct(team.linW), (18 / VESTING_MONTHS) * 100);
  // 100%-at-TGE rows (sale, liquidity) fill the track and nothing else: past
  // the release there is nothing left to draw, dark is the settled state.
  for (const label of ["PUBLIC FAIR LAUNCH", "LIQUIDITY"]) {
    const g = vestingBarGeometry(VESTING[label]!, VESTING_MONTHS);
    assert.equal(g.tgeW, "100%", `${label} must fill the track at TGE`);
    assert.equal(g.linW, "0%");
    assert.equal(g.cliffW, "0%");
  }
});

/**
 * The city is a second representation of the split, in a different file and a
 * different medium. §8's repeated shape is a value that is correct in one
 * place and never reaches — or never matches — the other, so pin the join in
 * BOTH directions: a row whose building is missing renders a table row that
 * highlights nothing, and a building whose row is missing is a sprite nobody
 * can ever name.
 */
test("every allocation row has a building, and every building has a row", () => {
  const rowKeys = TOKENOMICS.map((r) => r.city);
  const cityKeys = CITY.buildings.map((b) => b.key);
  for (const k of rowKeys) {
    assert.ok(cityKeys.includes(k), `allocation names building "${k}", which the city does not have`);
  }
  for (const k of cityKeys) {
    assert.ok(rowKeys.includes(k), `city has building "${k}", which no allocation row claims`);
  }
  assert.equal(new Set(rowKeys).size, rowKeys.length, "two rows share a building");
});

test("city paint order is furthest-first and covers every building", () => {
  assert.equal(CITY_PAINT_ORDER.length, CITY.buildings.length);
  for (let i = 1; i < CITY_PAINT_ORDER.length; i++) {
    assert.ok(
      CITY_PAINT_ORDER[i - 1].depth >= CITY_PAINT_ORDER[i].depth,
      "paint order must run furthest-first or nearer buildings render behind",
    );
  }
});

test("every hit box sits inside the rendered frame", () => {
  for (const b of CITY.buildings) {
    const [x0, y0, x1, y1] = b.box;
    assert.ok(x1 > x0 && y1 > y0, `${b.key} has an inverted box`);
    assert.ok(x0 >= 0 && y0 >= 0 && x1 <= CITY.w && y1 <= CITY.h,
      `${b.key} box ${JSON.stringify(b.box)} escapes the ${CITY.w}x${CITY.h} frame`);
  }
});

test("published PinkLock locks account for exactly each vested row's tokens", () => {
  // The /tokenomics panel prints these amounts beside the split; a lock that
  // does not add up to its row publishes a vest the chain does not hold.
  assert.equal(VESTING_LOCKS.length, 4, "expected four vested rows");
  for (const g of VESTING_LOCKS) {
    const row = TOKENOMICS.find((r) => r.label === g.label);
    assert.ok(row, `lock group "${g.label}" is not an allocation row`);
    const held = g.locks.reduce((s, l) => s + l.amount, 0) + (g.unlockedOutside?.amount ?? 0);
    assert.equal(held, tokensFor(row.pct), `${g.label}: locks hold ${held}, split says ${tokensFor(row.pct)}`);
    for (const l of g.locks) assert.match(l.claimWallet, /^0x[0-9a-f]{40}$/, `${g.label} #${l.lockId} wallet not lowercased`);
  }
});
