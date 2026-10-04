import test from "node:test";
import assert from "node:assert/strict";
import {
  hourFloor,
  denseHourlyGrid,
  zeroPoint,
  toDenseGrid,
  type TimeseriesPoint,
} from "../lib/data/analytics";

/**
 * The chart's X axis is spaced by array index, and the comparison overlay
 * aligns two series by that same index — both depend on this grid math
 * being exactly `rangeHours(range)` long, contiguous, and gap-filled. A
 * silent off-by-one here would either compress elapsed time on the axis
 * (a missing hour rendered as adjacent to its neighbors) or misalign the
 * previous-period overlay by one bucket against the current period.
 */

test("hourFloor truncates minutes/seconds/ms, keeps the hour", () => {
  const d = new Date("2026-08-27T14:32:07.123Z");
  assert.equal(hourFloor(d).toISOString(), "2026-08-27T14:00:00.000Z");
});

test("denseHourlyGrid produces exactly rangeHours entries, half-open ending", () => {
  const end = new Date("2026-08-27T15:00:00.000Z"); // already hour-floored
  const grid24h = denseHourlyGrid("24h", end);
  assert.equal(grid24h.length, 24);
  assert.equal(grid24h[0], "2026-08-26T15:00:00.000Z");
  assert.equal(grid24h[grid24h.length - 1], "2026-08-27T14:00:00.000Z");
  // endExclusive itself is never included
  assert.ok(!grid24h.includes(end.toISOString()));

  const grid7d = denseHourlyGrid("7d", end);
  assert.equal(grid7d.length, 168);

  const grid30d = denseHourlyGrid("30d", end);
  assert.equal(grid30d.length, 720);
});

test("the previous-period grid is contiguous with the current grid, no overlap and no gap", () => {
  const currentEnd = new Date("2026-08-27T15:00:00.000Z");
  const current = denseHourlyGrid("24h", currentEnd);
  const previous = denseHourlyGrid("24h", new Date(current[0]!));

  assert.equal(previous.length, current.length);
  // The hour immediately before current's first hour is previous's last hour.
  const oneHourBefore = new Date(new Date(current[0]!).getTime() - 3600_000).toISOString();
  assert.equal(previous[previous.length - 1], oneHourBefore);
  // No index appears in both — a shared boundary would double-count or
  // misalign the overlay by one slot.
  const overlap = previous.filter((h) => current.includes(h));
  assert.deepEqual(overlap, []);
});

test("toDenseGrid zero-fills hours with no row, and preserves index alignment", () => {
  const grid = [
    "2026-08-27T12:00:00.000Z",
    "2026-08-27T13:00:00.000Z", // no row for this hour — a real silent gap
    "2026-08-27T14:00:00.000Z",
  ];
  const rows: TimeseriesPoint[] = [
    { ...zeroPoint(grid[0]!), views: 10 },
    { ...zeroPoint(grid[2]!), views: 30 },
  ];

  const dense = toDenseGrid(grid, rows);
  assert.equal(dense.length, 3);
  assert.equal(dense[0]!.views, 10);
  assert.equal(dense[1]!.views, 0); // gap hour is zero, not skipped/shifted
  assert.equal(dense[1]!.timestamp, grid[1]);
  assert.equal(dense[2]!.views, 30);
});

test("toDenseGrid tolerates a DB driver's non-ISO timestamp text via Date normalization", () => {
  // Simulates what queryHourlyRange already normalizes before calling this:
  // a driver might hand back "2026-08-27 12:00:00+00" instead of full ISO.
  const grid = ["2026-08-27T12:00:00.000Z"];
  const rows: TimeseriesPoint[] = [
    { ...zeroPoint(new Date("2026-08-27 12:00:00+00").toISOString()), views: 5 },
  ];
  const dense = toDenseGrid(grid, rows);
  assert.equal(dense[0]!.views, 5);
});
