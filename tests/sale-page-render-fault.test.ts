import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// L230: the sale reader rethrows a transient RPC fault; a page that awaits it bare shows Next's error screen.
for (const page of ["../app/token-sale/page.tsx", "../app/leaderboard/page.tsx"]) {
  test(`${page}: the first-paint snapshot read cannot throw out of the render`, () => {
    const src = readFileSync(new URL(page, import.meta.url), "utf8");
    const calls = src.match(/readSaleSnapshotCached\([^)]*\)[^\n]*/g) ?? [];
    assert.ok(calls.length > 0, "found the snapshot read");
    for (const call of calls) assert.match(call, /\)\.catch\(/);
  });
}

test("L230: a render fault on any page lands on our error screens, which offer a retry", () => {
  for (const file of ["../app/error.tsx", "../app/global-error.tsx"]) {
    const src = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(src, /^"use client";/, `${file} must be a client component or Next ignores it`);
    assert.match(src, /export default function/);
    assert.match(src, /onClick=\{\(\) => reset\(\)\}/);
  }
  assert.match(readFileSync(new URL("../app/global-error.tsx", import.meta.url), "utf8"), /<html[\s>]/, "global-error replaces the root layout, so it renders its own <html>");
});
