import { test } from "node:test";
import assert from "node:assert/strict";
import { scaleActivity } from "../app/components/site/landing/activity-chart";

const hours = (fill: number, overrides: Record<number, number> = {}) =>
  Array.from({ length: 24 }, (_, i) => overrides[i] ?? fill);

test("a steady day puts the median hour at half height", () => {
  const s = scaleActivity(hours(10, { 5: 12, 6: 8, 20: 14 }));
  assert.equal(s.median, 10);
  assert.equal(s.ceiling, 14); // the peak is under 2x median, so the ceiling is the peak
  assert.ok(s.points.every((p) => !p.clipped));
});

test("one burst is clipped to the top instead of flattening the other hours", () => {
  const s = scaleActivity(hours(10, { 12: 400 }));
  assert.equal(s.ceiling, 20);
  assert.equal(s.points[0].y, 0.5);
  assert.equal(s.points[12].y, 1);
  assert.equal(s.points[12].clipped, true);
  assert.equal(s.points[12].value, 400);
  assert.equal(s.peak, 400);
});

test("a quiet day scales against the hours that had launches", () => {
  const s = scaleActivity(hours(0, { 3: 4, 9: 6, 17: 8 }));
  assert.equal(s.median, 6);
  assert.equal(s.ceiling, 8);
  assert.equal(s.points[17].y, 1);
  assert.equal(s.points[0].y, 0);
});

test("a single active hour reaches the top, and an empty day never divides by zero", () => {
  assert.equal(scaleActivity(hours(0, { 11: 5 })).points[11].y, 1);
  const empty = scaleActivity(hours(0));
  assert.equal(empty.ceiling, 1);
  assert.ok(empty.points.every((p) => p.y === 0));
});

test("x runs oldest to newest across the full width", () => {
  const s = scaleActivity(hours(1));
  assert.equal(s.points.length, 24);
  assert.equal(s.points[0].x, 0);
  assert.equal(s.points[23].x, 1);
});
