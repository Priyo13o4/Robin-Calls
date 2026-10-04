import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clientIpFromHeaders } from "../lib/security/client-ip";

/**
 * Every per-IP budget is only as real as the identity it keys on.
 *
 * nginx appends to `x-forwarded-for` (`$proxy_add_x_forwarded_for`), so its
 * first entry is whatever the caller sent. It overwrites `x-real-ip`. Reading
 * the forwarded chain first let a caller mint a fresh budget per request by
 * varying one header, which was measured against dev before this was changed.
 */
const h = (init: Record<string, string>) => new Headers(init);

test("a forged forwarded chain loses to the header nginx overwrites", () => {
  const ip = clientIpFromHeaders(
    h({ "x-forwarded-for": "203.0.113.7, 198.51.100.9", "x-real-ip": "198.51.100.9" }),
  );
  assert.equal(ip, "198.51.100.9", "the caller's own x-forwarded-for entry must not win");
});

test("the forwarded chain is still read when nothing overwrote a real IP", () => {
  // app/api/internal/v1/scan builds a synthetic request carrying only this
  // header, copied from the x-rc-caller-ip nginx sets. Dropping the fallback
  // would silently collapse every agent-originated scan onto one budget key.
  assert.equal(clientIpFromHeaders(h({ "x-forwarded-for": "203.0.113.7" })), "203.0.113.7");
});

test("an absent identity is null, never a guess", () => {
  assert.equal(clientIpFromHeaders(h({})), null);
  assert.equal(clientIpFromHeaders(h({ "x-real-ip": "   " })), null);
});

test("both budget call sites read the shared resolver, not their own headers", () => {
  // §8 #10: one of these two used to have its own copy with the opposite
  // precedence, so fixing the other would have left the scan budget open.
  for (const path of ["proxy.ts", "lib/scan-control/index.ts"]) {
    const src = readFileSync(path, "utf8");
    assert.match(src, /clientIpFromHeaders/, `${path} no longer uses the shared resolver`);
    assert.doesNotMatch(
      src,
      /get\("x-forwarded-for"\)/,
      `${path} reads the forwarded chain directly again`,
    );
  }
});

test("nginx still overwrites x-real-ip on the app route, which is what makes it trustworthy", () => {
  // If this line ever becomes $proxy_add_x_forwarded_for style, the resolver's
  // precedence is pointing at a forgeable header again and nothing else notices.
  const conf = readFileSync("docker/nginx/nginx.conf", "utf8");
  const setters = conf.match(/proxy_set_header X-Real-IP [^;]+;/g) ?? [];
  assert.ok(setters.length > 0, "found no X-Real-IP setter in nginx.conf — retarget this test");
  for (const line of setters) {
    assert.match(line, /\$remote_addr/, `X-Real-IP must come from the peer, not a caller header: ${line}`);
  }
});
