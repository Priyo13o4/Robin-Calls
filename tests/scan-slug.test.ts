import { test } from "node:test";
import assert from "node:assert/strict";
import { parseScanSlug, buildScanSlug } from "../lib/scan-slug";

test("parseScanSlug extracts valid address from bare address", () => {
  const addr = "0x04e8809450b22e14bfa5d09f01f24de865dbd0de";
  assert.equal(parseScanSlug(addr), addr.toLowerCase());
});

test("parseScanSlug extracts valid address from uppercase address", () => {
  const addr = "0x04E8809450B22E14BFA5D09F01F24DE865DBD0DE";
  assert.equal(parseScanSlug(addr), addr.toLowerCase());
});

test("parseScanSlug extracts address with ticker prefix (case-insensitive)", () => {
  const addr = "0x04e8809450b22e14bfa5d09f01f24de865dbd0de";
  assert.equal(parseScanSlug(`PEPE-${addr}`), addr);
  assert.equal(parseScanSlug(`pepe-${addr}`), addr);
  assert.equal(parseScanSlug(`PePe-${addr}`), addr);
});

test("parseScanSlug returns null for malformed slug with no address", () => {
  assert.equal(parseScanSlug(""), null);
  assert.equal(parseScanSlug("not-an-address"), null);
  assert.equal(parseScanSlug("0x123"), null);
  assert.equal(parseScanSlug("PEPE-0x123"), null);
  assert.equal(parseScanSlug("pepe-coin"), null);
});

test("buildScanSlug returns slug with cleaned lowercase ticker", () => {
  const addr = "0x04e8809450b22e14bfa5d09f01f24de865dbd0de";
  assert.equal(buildScanSlug(addr, "PEPE"), `pepe-${addr}`);
  assert.equal(buildScanSlug(addr, "$PEPE!"), `pepe-${addr}`);
  assert.equal(buildScanSlug(addr, "PEPE-2.0"), `pepe20-${addr}`);
});

test("buildScanSlug falls back to bare address when symbol is missing or empty", () => {
  const addr = "0x04e8809450b22e14bfa5d09f01f24de865dbd0de";
  assert.equal(buildScanSlug(addr, null), addr);
  assert.equal(buildScanSlug(addr, undefined), addr);
  assert.equal(buildScanSlug(addr, ""), addr);
  assert.equal(buildScanSlug(addr, "   "), addr);
  assert.equal(buildScanSlug(addr, "---"), addr);
});

test("canonical slug verification for test cases", () => {
  const addr = "0x04e8809450b22e14bfa5d09f01f24de865dbd0de";
  
  // Bare address slug resolves to addr
  const parsed1 = parseScanSlug("0x04e8809450b22e14bfa5d09f01f24de865dbd0de");
  assert.equal(parsed1, addr);
  
  // Uppercase ticker slug resolves to addr
  const parsed2 = parseScanSlug("PEPE-0x04e8809450b22e14bfa5d09f01f24de865dbd0de");
  assert.equal(parsed2, addr);

  // Canonical slug with symbol
  assert.equal(buildScanSlug(addr, "PEPE"), `pepe-${addr}`);
});
