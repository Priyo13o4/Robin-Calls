import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OUTBOUND_USER_AGENT } from "../lib/config/user-agent";

// ── KNOWN-PROBLEMS L95 ──
//
// Cloudflare fronts the community Blockscout instance — our verified-source
// FALLBACK — and 403s any request whose User-Agent is not in the
// `Mozilla/5.0 (compatible; ...)` shape. We were sending no UA at all, so every
// fallback call had been failing with 403: 18 in 48h, silently, because
// `getVerifiedRow` deliberately swallows fallback faults as "pure upside".
//
// That swallow is CORRECT and must stay — it is what stops a fallback outage
// from changing a verdict. But it also means nothing about this failure is
// visible in a scan, which is why the UA needs its own test rather than being
// left to a check to notice.

const src = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");

test("the UA is in the shape Cloudflare actually accepts", () => {
  // Probed 2026-09-03: this shape 200s, while "RobinCalls/1.0", a bare
  // "Mozilla/5.0", and no header at all are each a 403. The `compatible;`
  // prefix is the load-bearing part, not the product name after it.
  assert.match(OUTBOUND_USER_AGENT, /^Mozilla\/5\.0 \(compatible; /);
  // Honest, not impersonation: the identifying token and a contact URL both
  // pass, so there is no reason to copy a browser string.
  assert.match(OUTBOUND_USER_AGENT, /RobinCalls/);
  assert.match(OUTBOUND_USER_AGENT, /\+https:\/\/robincalls\.com/);
  assert.doesNotMatch(
    OUTBOUND_USER_AGENT,
    /Chrome|Safari|Firefox|Edg\//,
    "do not impersonate a browser — the honest string already passes",
  );
});

// ── WIRING (§8 #10) ──
//
// The assertions above pass just as happily if nothing ever sends the constant,
// which is precisely how this broke: the string existed in tradingview.ts and
// the explorer path — the one behind Cloudflare — never sent one.

test("explorerFetch actually sends the UA on every request", () => {
  const http = src("../lib/explorer/http.ts");
  assert.match(http, /OUTBOUND_USER_AGENT/, "http.ts must import the shared UA");
  // It has to be inside the fetch's own headers object, not merely imported.
  const headers = http.match(/headers:\s*\{[\s\S]{0,400}?\}/);
  assert.ok(headers, "could not locate the fetch headers object");
  assert.match(
    headers[0],
    /"user-agent":\s*OUTBOUND_USER_AGENT/,
    "the UA must be in the headers actually passed to fetch",
  );
});

test("no outbound caller hardcodes its own UA string", () => {
  // A second copy is how these drift apart: one gets fixed, its twin does not
  // (§8 #8). Every outbound UA must come from the shared constant.
  for (const f of ["../lib/explorer/http.ts", "../lib/market/tradingview.ts"]) {
    assert.doesNotMatch(
      src(f),
      /["']Mozilla\/5\.0/,
      `${f} must use OUTBOUND_USER_AGENT, not its own literal`,
    );
  }
});
