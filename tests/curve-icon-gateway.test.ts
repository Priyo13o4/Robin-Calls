import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { gatewayUrls } from "../lib/data/curve-icon";

/**
 * Working gateways measured 2026-09-15:
 * Filebase (path form) and 4everland (subdomain form, base32 v1).
 * ipfs.io, dweb.link, and w3s.link refuse requests with 429/403.
 * Server fallback (/api/token-icon) was removed; client resolves directly.
 */
const SRC = "lib/data/curve-icon.ts";
const src = () => readFileSync(new URL(`../${SRC}`, import.meta.url), "utf8");

test("IMAGE_GATEWAYS uses working gateways and never ipfs.io, dweb.link, or w3s.link", () => {
  const s = src();
  assert.ok(s.includes("export const IMAGE_GATEWAYS"), "IMAGE_GATEWAYS must be exported");
  const code = s.slice(s.indexOf("export const IMAGE_GATEWAYS"), s.indexOf("looksLikeCid"));
  assert.match(code, /ipfs\.filebase\.io/);
  assert.match(code, /4everland\.io/);
  assert.doesNotMatch(code, /ipfs\.io/);
  assert.doesNotMatch(code, /dweb\.link/);
  assert.doesNotMatch(code, /w3s\.link/);
});

test("v1 CIDs go to a browser through the SUBDOMAIN form, not a path", () => {
  const v1 = "bafybeigdyrzt5sfp7udm7ahu76uh7y26nf3efuylqabf3oclgtqy55fbkd";
  const urls = gatewayUrls(v1);
  const fourEverland = urls.find((u) => u.includes("4everland.io"));
  assert.ok(fourEverland, "4everland gateway URL must be present for v1 CID");
  assert.match(fourEverland, /https:\/\/bafy[a-z0-9]+\.ipfs\.4everland\.io\//);
});

test("v1 CIDs return multiple candidate gateways for client failover", () => {
  const v1 = "bafybeigdyrzt5sfp7udm7ahu76uh7y26nf3efuylqabf3oclgtqy55fbkd";
  const urls = gatewayUrls(v1);
  assert.equal(urls.length, 2);
  assert.ok(urls.some((u) => u.includes("filebase.io")));
  assert.ok(urls.some((u) => u.includes("4everland.io")));
});

test("v0 CIDs keep the path form — they are not valid DNS labels", () => {
  const s = src();
  assert.match(s, /isSubdomainSafeCid/);
  assert.match(s, /\^baf\[0-9a-z\]\{20,\}\$/);
  const v0 = "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco";
  const urls = gatewayUrls(v0);
  assert.equal(urls.length, 1);
  assert.ok(urls[0].startsWith("https://ipfs.filebase.io/ipfs/Qm"));
});

test("TokenIcon resolves client-side and no longer fetches /api/token-icon", () => {
  const tokenIcon = readFileSync(
    new URL("../app/components/site/TokenIcon.tsx", import.meta.url),
    "utf8",
  );
  assert.match(tokenIcon, /iconCandidates/);
  assert.match(tokenIcon, /imageFromJsonPointer/);
  assert.doesNotMatch(tokenIcon, /\/api\/token-icon/);
});

test("the icon route is removed from proxy and ratelimit", () => {
  const rl = readFileSync(new URL("../lib/security/ratelimit.ts", import.meta.url), "utf8");
  const proxy = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  assert.doesNotMatch(rl, /pathname === "\/api\/token-icon"/);
  assert.doesNotMatch(rl, /tokenIcon:/);
  assert.doesNotMatch(proxy, /"\/api\/token-icon"/);
});

test("app/api/token-icon/route.ts and readLaunchMetadataUri are deleted", () => {
  const routeExists = existsSync(new URL("../app/api/token-icon/route.ts", import.meta.url));
  assert.equal(routeExists, false);
  const launches = readFileSync(new URL("../lib/data/launches.ts", import.meta.url), "utf8");
  assert.doesNotMatch(launches, /readLaunchMetadataUri/);
});
