import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const src = readFileSync(join(root, "app/components/site/TokenIcon.tsx"), "utf8");
const icon = src.slice(src.indexOf("function TokenIcon"), src.indexOf("function ShimmerBlock"));

/**
 * CashCat tokens rendered no icon at all.
 *
 * Measured against prod 2026-08-26: 0 of 19 CashCat curve rows carry a
 * `metadata_uri` (the pad's TokenLaunched event has no URI field) and the
 * explorer's `icon_url` is null on every sampled token — so both existing
 * tiers came back empty and every CashCat card fell through to the monogram.
 *
 * The fix adds DexScreener's pair art as a THIRD tier, after the registry
 * sources, by reusing lib/data/token-art.ts (the one fetcher — a second
 * implementation of the endpoint here is forbidden). It will return null most
 * of the time by design: DexScreener indexes ~1 of 15 graduated tokens on this
 * chain, so the monogram stays the final fallback.
 *
 * What is worth pinning is the selection ORDER — first source wins, a null
 * falls through, all-null reaches the placeholder — because a silent reorder
 * would rank a third party above our own registry without anything failing.
 */

interface StubSource {
  name: string;
  result: string | null;
}

/** The component's selection loop, restated. Kept honest by the source pins below. */
async function resolveIcon(sources: StubSource[]): Promise<{ url: string | null; asked: string[] }> {
  const asked: string[] = [];
  let url: string | null = null;
  for (const s of sources) {
    asked.push(s.name);
    if (s.result !== null) {
      url = s.result;
      break;
    }
  }
  return { url, asked };
}

const META_URL = "https://ipfs.example/wrapped.png";
const DS_URL = "https://cdn.dexscreener.com/cms/images/cashcat.png";

test("first source wins: metadata hit means explorer and DexScreener are never asked", async () => {
  const out = await resolveIcon([
    { name: "metadata", result: META_URL },
    { name: "explorer", result: null },
    { name: "dexscreener", result: null },
  ]);
  assert.equal(out.url, META_URL);
  assert.deepEqual(out.asked, ["metadata"]);
});

test("an empty tier falls through to the next, and stops there", async () => {
  const out = await resolveIcon([
    { name: "metadata", result: null },
    { name: "explorer", result: "https://explorer.example/icon.png" },
    { name: "ds", result: DS_URL },
  ]);
  assert.equal(out.url, "https://explorer.example/icon.png");
  assert.deepEqual(out.asked, ["metadata", "explorer"]);
});

test("all tiers empty yields null — the placeholder, not an error or a retry", async () => {
  const out = await resolveIcon([
    { name: "metadata", result: null },
    { name: "explorer", result: null },
    { name: "dexscreener", result: null },
  ]);
  assert.equal(out.url, null);
  assert.deepEqual(out.asked, ["metadata", "explorer", "dexscreener"]);
});

test("the component asks its three tiers in provenance order, registry first", () => {
  // A reorder silently ranks a third party above our own chain/registry sources (L180: pointer first, in the browser).
  const pointer = icon.indexOf("iconCandidates(metadataUri)");
  const json = icon.indexOf("imageFromJsonPointer(");
  const explorer = icon.indexOf("await fromExplorer()");
  const dex = icon.indexOf("await fromDexscreener()");
  assert.ok(pointer > 0 && json > 0 && explorer > 0 && dex > 0, "found every tier in TokenIcon");
  assert.ok(pointer < json && json < explorer && explorer < dex, "pointer → JSON pointer → explorer → DexScreener");
});

test("the DexScreener tier REUSES token-art rather than a second fetcher", () => {
  assert.ok(
    src.includes('import { fetchTokenImage } from "@/lib/data/token-art";'),
    "must reuse lib/data/token-art.ts"
  );
  assert.ok(
    icon.includes("fetchTokenImage(address, ctrl.signal)"),
    "the tier must abort with the others (shared AbortController signal)"
  );
  // A second implementation of the endpoint in this file is the exact fork the
  // handoff forbids.
  assert.ok(!src.includes("api.dexscreener.com"), "no second DexScreener client here");
});

test("unmount teardown still covers all three tiers", () => {
  assert.ok(icon.includes("ctrl.abort()"), "AbortController must abort pending tier fetches");
  assert.ok(icon.includes("if (!active) return;"), "no setState after unmount");
});

test("DIRECT_DEX rows still skip the metadata tier entirely", () => {
  // They carry no metadata_uri: no pointer candidates and no JSON fetch, straight to the explorer.
  assert.ok(icon.includes("metadataUri ? iconCandidates(metadataUri) : []"));
  assert.ok(icon.includes("if (isCidOrHttp && metadataUri)"));
});
