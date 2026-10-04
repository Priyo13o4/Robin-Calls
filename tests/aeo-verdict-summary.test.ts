import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { verdictJsonLd, verdictSummarySentence } from "../lib/config/seo";

const root = join(__dirname, "..");

const base = {
  tokenAddress: "0x7163AE1B5AEA2F09EBC609C52B4DCAC0A7A4BC2D",
  tokenName: "Gage",
  tokenSymbol: "GAGE",
  score: 60,
  tier: "CAUTION",
  scoreVersion: "1.49",
};
const ledger = { id: 335, createdAt: "2026-09-14T15:04:00.000Z" };

test("summary names score, tier, version, verdict number and UTC date", () => {
  const checks = [{ status: "PASS" }, { status: "PASS" }, { status: "WARN" }, { status: "FAIL" }, { status: "CRITICAL" }, { status: "SKIP" }];
  assert.equal(
    verdictSummarySentence({ ...base, checks }, ledger),
    "RobinCalls scored GAGE 60/100 (CAUTION) on Robinhood Chain under formula v1.49, in verdict #335 published 14 Sep 2026 (UTC). Of 6 checks, 2 passed, 1 warned, 2 failed and 1 could not be run.",
  );
});

test("a SKIP is never counted as passed, and zero parts are left out", () => {
  const s = verdictSummarySentence({ ...base, checks: [{ status: "PASS" }, { status: "SKIP" }, { status: "SKIP" }] }, ledger);
  assert.match(s, /Of 3 checks, 1 passed and 2 could not be run\.$/);
  assert.doesNotMatch(s, /warned|failed/);
});

test("no symbol or name falls back to the short address; bad date drops the date, not the sentence", () => {
  const s = verdictSummarySentence(
    { ...base, tokenSymbol: null, tokenName: null, checks: [{ status: "PASS" }] },
    { id: 7, createdAt: "not-a-date" },
  );
  assert.match(s, /^RobinCalls scored 0x7163AE… 60\/100/);
  assert.match(s, /, in verdict #7\. Of 1 checks, 1 passed\.$/);
});

test("JSON-LD is about the token by lowercased address and carries the same sentence", () => {
  const checks = [{ status: "PASS" }];
  const ld = verdictJsonLd({ ...base, checks }, ledger, "https://robincalls.com/scan/gage-0x7163");
  assert.equal(ld["@type"], "WebPage");
  assert.equal(ld.about.identifier, base.tokenAddress.toLowerCase());
  assert.equal(ld.description, verdictSummarySentence({ ...base, checks }, ledger));
  assert.equal(ld.datePublished, ledger.createdAt);
});

test("WIRING: both verdict branches of /scan/[address] render the summary", () => {
  const src = readFileSync(join(root, "app/scan/[address]/page.tsx"), "utf8");
  assert.equal((src.match(/<VerdictSummary verdict=\{(archived|latest)\.verdict\}/g) ?? []).length, 2);
});

test("no em dash in any sentence the summary can produce", () => {
  const s = verdictSummarySentence({ ...base, checks: [{ status: "WARN" }] }, ledger);
  assert.ok(s.length > 0);
  assert.doesNotMatch(s, /—/);
});

test("llms.txt states current facts: real tier names, anchoring planned, no em dashes", () => {
  const txt = readFileSync(join(root, "public/llms.txt"), "utf8");
  assert.ok(txt.length > 500, "llms.txt must have been read");
  for (const tier of ["CLEAR", "CAUTION", "DANGER", "CRITICAL"]) assert.match(txt, new RegExp(`\\b${tier}\\b`));
  assert.doesNotMatch(txt, /PASS \/ WARN \/ DANGER/);
  assert.match(txt, /anchoring of the chain head is planned, not live/);
  assert.doesNotMatch(txt, /anchored on-chain/i);
  assert.doesNotMatch(txt, /—/);
});
