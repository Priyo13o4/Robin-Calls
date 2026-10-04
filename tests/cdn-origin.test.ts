import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCdnOrigin } from "../lib/config/cdn";

/**
 * NEXT_PUBLIC_CDN_URL arrived once as a bare host, "cdn.robincalls.com".
 * The origin is then concatenated with an absolute /public path, so without a
 * scheme the result is RELATIVE: the browser resolves it against the current
 * page and every heavy asset 404s at
 * https://robincalls.com/cdn.robincalls.com/models/... — with nothing failing
 * at build or deploy to say so.
 */
test("a bare host is given a scheme, so the url stays absolute", () => {
  assert.equal(normalizeCdnOrigin("cdn.robincalls.com"), "https://cdn.robincalls.com");
});

test("a value that already carries a scheme is untouched", () => {
  assert.equal(normalizeCdnOrigin("https://cdn.robincalls.com"), "https://cdn.robincalls.com");
  assert.equal(normalizeCdnOrigin("http://localhost:9000"), "http://localhost:9000");
});

test("protocol-relative and same-origin prefixes are left alone", () => {
  // Both are legitimate and mean something a bare host cannot mean.
  assert.equal(normalizeCdnOrigin("//cdn.robincalls.com"), "//cdn.robincalls.com");
  assert.equal(normalizeCdnOrigin("/assets"), "/assets");
});

test("absent stays absent, so callers fall back to the local /public path", () => {
  assert.equal(normalizeCdnOrigin(undefined), "");
  assert.equal(normalizeCdnOrigin(""), "");
  assert.equal(normalizeCdnOrigin("   "), "");
});

test("a trailing slash is trimmed, before the scheme test not after", () => {
  assert.equal(normalizeCdnOrigin("cdn.robincalls.com/"), "https://cdn.robincalls.com");
  assert.equal(normalizeCdnOrigin("https://cdn.robincalls.com//"), "https://cdn.robincalls.com");
});
