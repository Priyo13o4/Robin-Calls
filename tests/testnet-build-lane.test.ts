import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Testnet is allowed to reach exactly two build lanes — the local dev server
 * and the local smoke stack — and never the image CI pushes to production.
 *
 * The guarantee is the ABSENCE OF A WIRE, not an unset variable: with no
 * build-arg in the workflow, no repo Variable can reach the client bundle
 * however anyone sets it. That distinction is the whole point, and it is
 * invisible in a diff — a future "add the new NEXT_PUBLIC var" edit copies the
 * whole block back and silently reopens it, which is how the dead rate limits
 * (§8 #5) and the pinned whitelist flag both happened here.
 *
 * What it would cost: /token-sale is a public page that takes real money.
 * Pointed at testnet it renders perfectly and reads a chain where the sale
 * contract does not exist.
 *
 * The smoke assertions are the other half. Deleting the wire everywhere would
 * also pass a one-sided test, while quietly removing the operator's ability to
 * rehearse the sale in production mode.
 */
const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** Build-arg lines only — the comment explaining the absence must not count. */
const buildArgLines = (src: string) =>
  src
    .split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n");

const TESTNET_VARS = [
  "NEXT_PUBLIC_ALLOW_TESTNET_CHAIN",
  "NEXT_PUBLIC_ROBINHOOD_TESTNET_RPC_URL",
  "NEXT_PUBLIC_ROBINHOOD_TESTNET_EXPLORER_URL",
];

test("the production image build passes no testnet build-arg", () => {
  const wf = buildArgLines(read(".github/workflows/build-and-push.yml"));
  for (const v of TESTNET_VARS) {
    assert.ok(
      !wf.includes(v),
      `${v} is wired into the production build again — production must be mainnet by construction, not by an unset repo Variable`,
    );
  }
});

test("the local smoke stack can still opt into testnet", () => {
  const compose = buildArgLines(read("docker-compose.production-smoke.yml"));
  const dockerfile = buildArgLines(read("Dockerfile.prod"));
  for (const v of TESTNET_VARS) {
    assert.ok(
      compose.includes(v),
      `${v} is gone from the smoke stack — the sale can no longer be rehearsed on testnet in production mode`,
    );
    assert.ok(
      dockerfile.includes(v),
      `Dockerfile.prod dropped ARG ${v}; the smoke stack's build arg would bake in as undefined`,
    );
  }
});

test("the browser's mainnet RPC comes from a NEXT_PUBLIC var, not a server-only one", () => {
  const src = read("lib/config/chain.ts");
  const rpcBlock = src.slice(src.indexOf("export const robinhoodChain"));
  const code = rpcBlock.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const http = code.slice(code.indexOf("rpcUrls"), code.indexOf("blockExplorers"));
  // Next inlines only NEXT_PUBLIC_* into the client bundle (verified against a
  // real build), so a server-only name here reads `undefined` in the browser
  // and the chain silently pins itself to the hardcoded fallback — while
  // looking configurable to anyone setting it on the VM.
  assert.ok(
    /NEXT_PUBLIC_RPC_URL/.test(http),
    "mainnet rpcUrls has no NEXT_PUBLIC source, so the browser cannot be configured off the fallback",
  );
});
