import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  cidOf,
  gatewayUrls,
  iconCandidates,
  imageFromJsonPointer,
} from "../lib/data/curve-icon";

const root = join(import.meta.dirname, "..");
const V1_EVEN = "bafybeigdyrzt5sfp7udm7ahu76uh7y26nf3efuylqabf3oclgtqy55fbkd";
const V1_ODD = "bafybeigdyrzt5sfp7udm7ahu76uh7y26nf3efuylqabf3oclgtqy55fbke";
const V0_CID = "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco";

test("bare v1 CID produces filebase and 4everland in parity order", () => {
  const evenOut = iconCandidates(V1_EVEN);
  assert.equal(evenOut.length, 2);
  assert.equal(evenOut[0], `https://ipfs.filebase.io/ipfs/${V1_EVEN}`);
  assert.equal(evenOut[1], `https://${V1_EVEN}.ipfs.4everland.io/`);

  const oddOut = iconCandidates(V1_ODD);
  assert.equal(oddOut.length, 2);
  assert.equal(oddOut[0], `https://${V1_ODD}.ipfs.4everland.io/`);
  assert.equal(oddOut[1], `https://ipfs.filebase.io/ipfs/${V1_ODD}`);
});

test("v0 Qm CID produces filebase only", () => {
  const out = iconCandidates(V0_CID);
  assert.deepEqual(out, [`https://ipfs.filebase.io/ipfs/${V0_CID}`]);
});

test("ipfs:// pointer resolves identically to bare CID", () => {
  assert.deepEqual(iconCandidates(`ipfs://${V1_EVEN}`), iconCandidates(V1_EVEN));
  assert.deepEqual(iconCandidates(`ipfs://${V0_CID}`), iconCandidates(V0_CID));
});

test("legacy gateway URLs are rewritten to working gateways", () => {
  const pinataOut = iconCandidates(`https://gateway.pinata.cloud/ipfs/${V1_EVEN}`);
  const ipfsIoOut = iconCandidates(`https://ipfs.io/ipfs/${V1_EVEN}`);
  const dwebOut = iconCandidates(`https://${V1_EVEN}.ipfs.dweb.link/`);

  for (const list of [pinataOut, ipfsIoOut, dwebOut]) {
    assert.equal(list.length, 2);
    for (const url of list) {
      assert.ok(!url.includes("ipfs.io"), `url ${url} contains ipfs.io`);
      assert.ok(!url.includes("dweb.link"), `url ${url} contains dweb.link`);
      assert.ok(!url.includes("w3s.link"), `url ${url} contains w3s.link`);
      assert.ok(!url.includes("pinata"), `url ${url} contains pinata`);
    }
  }
});

test("plain image URL passes through directly", () => {
  const url = "https://j7m.io/avatar.png";
  assert.deepEqual(iconCandidates(url), [url]);
});

test("data:image/ URI passes through directly", () => {
  const dataUri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  assert.deepEqual(iconCandidates(dataUri), [dataUri]);
});

test("inline JSON with .image CID resolves to gateway candidates", () => {
  const jsonWithCid = JSON.stringify({ image: V1_EVEN });
  assert.deepEqual(iconCandidates(jsonWithCid), gatewayUrls(V1_EVEN));

  const jsonWithUrl = JSON.stringify({ image: "https://j7m.io/art.png" });
  assert.deepEqual(iconCandidates(jsonWithUrl), ["https://j7m.io/art.png"]);
});

test("null, blank, javascript:, and http:// return empty array", () => {
  assert.deepEqual(iconCandidates(null), []);
  assert.deepEqual(iconCandidates(""), []);
  assert.deepEqual(iconCandidates("   "), []);
  assert.deepEqual(iconCandidates("javascript:alert(1)"), []);
  assert.deepEqual(iconCandidates("http://j7m.io/avatar.png"), []);
});

test("imageFromJsonPointer returns gateway candidates for JSON with .image", async () => {
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ image: V1_EVEN }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    const candidates = await imageFromJsonPointer(`https://ipfs.filebase.io/ipfs/${V1_ODD}`);
    assert.deepEqual(candidates, gatewayUrls(V1_EVEN));
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("imageFromJsonPointer returns empty array when fetch throws (e.g. CORS)", async () => {
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new TypeError("Failed to fetch (CORS)");
    };
    const candidates = await imageFromJsonPointer(`https://ipfs.filebase.io/ipfs/${V1_ODD}`);
    assert.deepEqual(candidates, []);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("imageFromJsonPointer returns empty array on non-JSON response", async () => {
  const origFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response("not json", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    const candidates = await imageFromJsonPointer(`https://ipfs.filebase.io/ipfs/${V1_ODD}`);
    assert.deepEqual(candidates, []);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("WIRING: TokenIcon imports client resolvers, drops route, and retains near/art hooks", () => {
  const tokenIconPath = join(root, "app/components/site/TokenIcon.tsx");
  const src = readFileSync(tokenIconPath, "utf8");
  assert.ok(src.length > 200, "TokenIcon.tsx source extraction must find file content");
  assert.ok(src.includes("export function TokenIcon"), "TokenIcon definition must be found");

  assert.ok(src.includes("iconCandidates"), "TokenIcon must import iconCandidates");
  assert.ok(src.includes("imageFromJsonPointer"), "TokenIcon must import imageFromJsonPointer");
  assert.ok(!src.includes("/api/token-icon"), "TokenIcon must not contain /api/token-icon");
  assert.ok(src.includes("fetchTokenImage"), "TokenIcon must call fetchTokenImage");
  assert.ok(src.includes("useNearViewport"), "TokenIcon must call useNearViewport");
});

test("WIRING: /api/token-icon route is deleted and absent from proxy/ratelimit", () => {
  const routePath = join(root, "app/api/token-icon/route.ts");
  assert.equal(existsSync(routePath), false, "app/api/token-icon/route.ts must not exist");

  const proxySrc = readFileSync(join(root, "proxy.ts"), "utf8");
  assert.ok(proxySrc.length > 200, "proxy.ts extraction must find content");
  assert.ok(!proxySrc.includes("token-icon"), "proxy.ts must not mention token-icon");

  const ratelimitSrc = readFileSync(join(root, "lib/security/ratelimit.ts"), "utf8");
  assert.ok(ratelimitSrc.length > 200, "ratelimit.ts extraction must find content");
  assert.ok(!ratelimitSrc.includes("token-icon"), "ratelimit.ts must not mention token-icon");
  assert.ok(!ratelimitSrc.includes("tokenIcon:"), "ratelimit.ts must not define tokenIcon limit");
});

test("WIRING: no file under app/ or lib/ contains legacy gateways outside comments", () => {
  const scanDirs = [join(root, "app"), join(root, "lib")];
  const files: string[] = [];

  function walk(dir: string) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else if (st.isFile() && /\.(ts|tsx|js|mjs)$/.test(entry)) {
        files.push(full);
      }
    }
  }

  for (const d of scanDirs) walk(d);
  assert.ok(files.length > 100, "Must scan more than 100 source files");

  for (const file of files) {
    const raw = readFileSync(file, "utf8");
    // Strip multi-line and single-line comments.
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*/g, "");

    assert.ok(
      !code.includes("ipfs.io/ipfs"),
      `File ${file} contains ipfs.io/ipfs in code`
    );
    assert.ok(
      !code.includes("ipfs.dweb.link"),
      `File ${file} contains ipfs.dweb.link in code`
    );
    assert.ok(
      !code.includes("w3s.link"),
      `File ${file} contains w3s.link in code`
    );
  }
});
