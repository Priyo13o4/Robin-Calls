import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { snapshotPurgeDecision, SNAPSHOT_PURGE_MAX_TOKEN_FRACTION } from "../lib/data/rugs";

const root = join(__dirname, "..");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

test("an empty watch set never purges: it is a failed read, not 'everything is dead'", () => {
  assert.deepEqual(snapshotPurgeDecision({ keepCount: 0, purgeTokens: 5, tokensWithSnapshots: 200 }), {
    purge: false,
    skipped: "empty-watch-set",
  });
});

test("a purge over the fraction cap is refused", () => {
  assert.equal(SNAPSHOT_PURGE_MAX_TOKEN_FRACTION, 0.5);
  assert.deepEqual(snapshotPurgeDecision({ keepCount: 90, purgeTokens: 101, tokensWithSnapshots: 200 }), {
    purge: false,
    skipped: "purge-too-large",
  });
});

test("normal run purges; nothing to purge is not a skip", () => {
  assert.deepEqual(snapshotPurgeDecision({ keepCount: 197, purgeTokens: 7, tokensWithSnapshots: 192 }), { purge: true, skipped: null });
  assert.deepEqual(snapshotPurgeDecision({ keepCount: 197, purgeTokens: 0, tokensWithSnapshots: 192 }), { purge: false, skipped: null });
});

test("WIRING: the purge protects every token the Wanted board and RWA pages still read", () => {
  const src = strip(readFileSync(join(root, "lib/data/rugs.ts"), "utf8"));
  const start = src.indexOf("export async function purgeDeadTokenSnapshots");
  assert.ok(start > 0, "purge function must exist");
  const body = src.slice(start, src.indexOf("export async function writeMarketSnapshotBatch"));
  assert.ok(body.length > 500, "extracted the purge body");
  for (const guard of [
    /from slow_rug_watch w where .* w\.cleared = false/,
    /from token_marks m where .* m\.lifted_at is null/,
    /from rugs r join tokens tk/,
    /from registry g where/,
    /deployer_pulled_liquidity/,
    /s\.t not in \(\$\{keepList\}\)/,
    /created_at >= \$\{cutoffIso\}::timestamptz/,
  ]) {
    assert.match(body, guard);
  }
});

test("WIRING: the slow-rug job purges with the watch set, after every token was evaluated", () => {
  const src = strip(readFileSync(join(root, "app/api/jobs/slow-rug/route.ts"), "utf8"));
  const loop = src.indexOf("for (const addr of tokens)");
  const call = src.indexOf("purgeDeadTokenSnapshots(tokens)");
  assert.ok(loop > 0, "evaluation loop must exist");
  assert.ok(call > loop, "purge must run after the evaluation loop");
  assert.match(src, /snapshotsPurged:/);
});
