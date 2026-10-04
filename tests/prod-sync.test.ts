import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { signSyncRequest, verifySyncRequest, syncAuthDeps } from "../lib/security/sync-auth";
import { syncPullConfig, pullTable, pullDeps } from "../lib/sync/pull";
import { pickColumns } from "../lib/data/sync";
import { launches } from "../lib/db/schema";
import { GET } from "../app/api/sync/v1/[table]/route";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUB = publicKey.export({ format: "der", type: "spki" }).toString("base64");
const PRIV = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
const other = generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
const BASE = "https://robincalls.com";
const PATH = "/api/sync/v1/launches?limit=10";
const req = (headers: Record<string, string>, path = PATH) => new Request(`${BASE}${path}`, { headers });

function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const prev = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  return fn().finally(() => { for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
}

test("auth: only a fresh, single-use signature from the paired key over this exact path passes", async () => {
  const spent = new Set<string>();
  const orig = syncAuthDeps.spendNonce;
  syncAuthDeps.spendNonce = async (n) => (spent.has(n) ? false : (spent.add(n), true));
  try {
    await withEnv({ SYNC_PUBLIC_KEY: PUB }, async () => {
      const h = signSyncRequest(PRIV, "GET", PATH);
      assert.equal(await verifySyncRequest(req(h)), true);
      assert.equal(await verifySyncRequest(req(h)), false, "replay");
      assert.equal(await verifySyncRequest(req(signSyncRequest(PRIV, "GET", PATH), "/api/sync/v1/launch_state?limit=10")), false, "path swapped");
      assert.equal(await verifySyncRequest(req(signSyncRequest(other, "GET", PATH))), false, "wrong key");
      assert.equal(await verifySyncRequest(req(signSyncRequest(PRIV, "GET", PATH, Date.now() - 120_000))), false, "stale");
      assert.equal(await verifySyncRequest(req({})), false, "unsigned");
    });
    await withEnv({ SYNC_PUBLIC_KEY: undefined }, async () => {
      assert.equal(await verifySyncRequest(req(signSyncRequest(PRIV, "GET", PATH))), false, "no key configured: off");
    });
    // A nonce store that is down cannot prove single use.
    syncAuthDeps.spendNonce = async () => { throw new Error("down"); };
    await withEnv({ SYNC_PUBLIC_KEY: PUB }, async () => {
      assert.equal(await verifySyncRequest(req(signSyncRequest(PRIV, "GET", PATH))), false);
    });
  } finally {
    syncAuthDeps.spendNonce = orig;
  }
});

test("route: an unsigned request is a plain 404, indistinguishable from no route", async () => {
  await withEnv({ SYNC_PUBLIC_KEY: PUB }, async () => {
    const res = await GET(req({}), { params: Promise.resolve({ table: "launches" }) });
    assert.equal(res.status, 404);
    assert.equal(await res.text(), "Not Found");
  });
});

test("puller: never on prod, never over http, never against itself", () => {
  const base = { PROD_SYNC_PULL: "true", PROD_SYNC_URL: BASE, PROD_SYNC_SIGNING_KEY: PRIV, NEXT_PUBLIC_SITE_URL: "https://dev.robincalls.com" };
  assert.ok(syncPullConfig(base as NodeJS.ProcessEnv));
  assert.equal(syncPullConfig({ ...base, PROD_SYNC_PULL: undefined } as NodeJS.ProcessEnv), null);
  assert.equal(syncPullConfig({ ...base, SYNC_PUBLIC_KEY: PUB } as NodeJS.ProcessEnv), null, "a server that verifies never pulls");
  assert.equal(syncPullConfig({ ...base, PROD_SYNC_URL: "http://robincalls.com" } as NodeJS.ProcessEnv), null);
  assert.equal(syncPullConfig({ ...base, NEXT_PUBLIC_SITE_URL: BASE } as NodeJS.ProcessEnv), null);
});

test("puller: pages until prod says no more, saving the cursor after every page", async () => {
  const cfg = syncPullConfig({ PROD_SYNC_PULL: "true", PROD_SYNC_URL: BASE, PROD_SYNC_SIGNING_KEY: PRIV } as NodeJS.ProcessEnv)!;
  const saved: string[] = [];
  const asked: string[] = [];
  const pages = [{ rows: [{ tokenAddress: "0x1" }], next: "c1", more: true }, { rows: [{ tokenAddress: "0x2" }], next: "c2", more: false }];
  const deps: typeof pullDeps = {
    fetch: async (url, init) => { asked.push(url); assert.ok((init.headers as Record<string, string>)["x-sync-sig"]); return new Response(JSON.stringify(pages.shift())); },
    cursor: async () => null,
    saveCursor: async (_t, a) => { saved.push(a); },
    upsert: async (_t, rows) => rows.length,
  };
  const r = await pullTable(cfg, "launches", deps);
  assert.deepEqual(r, { rows: 2, more: false });
  assert.deepEqual(saved, ["c1", "c2"]);
  const boot = JSON.parse(Buffer.from(new URL(asked[0]).searchParams.get("after")!, "base64url").toString());
  assert.ok(Date.now() - Date.parse(boot.ts) > 47 * 3600_000, "first run starts from the bootstrap window");
  assert.equal(new URL(asked[1]).searchParams.get("after"), "c1");
  await assert.rejects(pullTable(cfg, "launches", { ...deps, fetch: async () => new Response("", { status: 404 }) }), /HTTP 404/);
});

test("local writes refuse a key that is not a column (Drizzle would drop it silently)", () => {
  assert.equal(pickColumns(launches, { tokenAddress: "0x1", family: "x", recordedAt: "t" }, ["recordedAt"]).recordedAt, undefined);
  assert.throws(() => pickColumns(launches, { tokenAddress: "0x1", token_address: "0x1" }, []), /unknown column token_address/);
});

test("WIRING: smoke pulls, prod never does; nginx meters the route; the migration indexes every cursor", () => {
  const inst = readFileSync("instrumentation.ts", "utf8");
  assert.ok(inst.indexOf("startSyncPull(sync)") > 0 && inst.indexOf("startSyncPull(sync)") < inst.indexOf("flags.sequencerIngest"));
  assert.match(readFileSync("docker-compose.production-smoke.yml", "utf8"), /PROD_SYNC_PULL: \$\{SMOKE_PROD_SYNC:-true\}/);
  assert.doesNotMatch(readFileSync("docker-compose.yml", "utf8"), /PROD_SYNC_PULL|PROD_SYNC_SIGNING_KEY/);
  assert.match(readFileSync("docker/nginx/nginx.conf", "utf8"), /location \/api\/sync\/ \{\s*limit_req zone=rc_sync/);
  const mig = readFileSync("supabase/migrations/0102_sequencer_sync_lockers_hooks.sql", "utf8");
  for (const idx of ["launches_recorded_idx", "launch_events_recorded_idx", "v4_pools_recorded_idx", "launch_state_touched_idx"]) assert.match(mig, new RegExp(idx));
});
