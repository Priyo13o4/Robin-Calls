import test from "node:test";
import assert from "node:assert/strict";
import { evaluateTokenSeries } from "../lib/watch/evaluate";

test("parity: evaluateTokenSeries matches the inline math for drain, pump-dump, and healthy fixtures", () => {
  const cfg = {
    minPeakUsd: 5000,
    drainThreshold: 0.7,
    pumpDumpWindowHours: 72,
    pumpDumpCollapsePct: 0.95,
  };
  const nowMs = 1770000000000;

  // Fixture 1: Drain ($8,000 peak -> $1,200 current = 85% drain >= 70% threshold)
  const drainRows = [
    { liq: 1200, price: 0.1, ts: nowMs },
    { liq: 8000, price: 0.8, ts: nowMs - 12 * 36e5 },
  ];
  const drainRes = evaluateTokenSeries(drainRows, nowMs, cfg);
  assert.deepEqual(drainRes, {
    drain: { pct: 0.85, peak: 8000, current: 1200 },
    clearDrain: false,
    collapseCandidate: null,
    skipped: null,
  });

  // Fixture 2: Pump-dump price collapse ($1.00 down to $0.03 within fast window, liq peak $8,000)
  const collapseRows = [
    { liq: 6000, price: 0.03, ts: nowMs },
    { liq: 8000, price: 1.0, ts: nowMs - 24 * 36e5 },
  ];
  const collapseRes = evaluateTokenSeries(collapseRows, nowMs, cfg);
  assert.deepEqual(collapseRes, {
    drain: null,
    clearDrain: true,
    collapseCandidate: {
      peakPrice: 1.0,
      fastLiqPeak: 8000,
      trigger: "price-collapse",
    },
    skipped: null,
  });

  // Fixture 3: Healthy (liquidity $10K -> $9.5K, price steady, neither drain nor collapse)
  const healthyRows = [
    { liq: 9500, price: 1.02, ts: nowMs },
    { liq: 10000, price: 1.0, ts: nowMs - 24 * 36e5 },
  ];
  const healthyRes = evaluateTokenSeries(healthyRows, nowMs, cfg);
  assert.deepEqual(healthyRes, {
    drain: null,
    clearDrain: true,
    collapseCandidate: null,
    skipped: null,
  });
});

test("a drain whose peak is 6 days old is detected across the full peak window", () => {
  const cfg = {
    minPeakUsd: 5000,
    drainThreshold: 0.7,
    pumpDumpWindowHours: 72,
    pumpDumpCollapsePct: 0.95,
  };
  const nowMs = 1770000000000;
  const sixDaysAgoMs = nowMs - 6 * 864e5;
  const rows = [
    { liq: 1000, price: 0.1, ts: nowMs },
    { liq: 20000, price: 2.0, ts: sixDaysAgoMs },
  ];
  const res = evaluateTokenSeries(rows, nowMs, cfg);
  assert.deepEqual(res.drain, {
    pct: 0.95,
    peak: 20000,
    current: 1000,
  });
  assert.equal(res.skipped, null);
});

test("rows.length < 2 is skipped with reason and never evaluated as a drain", () => {
  const cfg = {
    minPeakUsd: 5000,
    drainThreshold: 0.7,
    pumpDumpWindowHours: 72,
    pumpDumpCollapsePct: 0.95,
  };
  const nowMs = 1770000000000;
  const singleRow = [{ liq: 500, price: 0.05, ts: nowMs }];
  const emptyRows: typeof singleRow = [];

  const resSingle = evaluateTokenSeries(singleRow, nowMs, cfg);
  assert.equal(resSingle.drain, null);
  assert.equal(resSingle.collapseCandidate, null);
  assert.equal(resSingle.skipped, "insufficient_history");

  const resEmpty = evaluateTokenSeries(emptyRows, nowMs, cfg);
  assert.equal(resEmpty.drain, null);
  assert.equal(resEmpty.collapseCandidate, null);
  assert.equal(resEmpty.skipped, "insufficient_history");
});

test("zero liquidity: latest.liq = 0 with a $50K peak is a 100% drain, not skipped", () => {
  const cfg = {
    minPeakUsd: 5000,
    drainThreshold: 0.7,
    pumpDumpWindowHours: 72,
    pumpDumpCollapsePct: 0.95,
  };
  const nowMs = 1770000000000;
  const rows = [
    { liq: 0, price: 0.0, ts: nowMs },
    { liq: 50000, price: 5.0, ts: nowMs - 12 * 36e5 },
  ];
  const res = evaluateTokenSeries(rows, nowMs, cfg);
  assert.deepEqual(res.drain, {
    pct: 1,
    peak: 50000,
    current: 0,
  });
  assert.equal(res.skipped, null);
});
