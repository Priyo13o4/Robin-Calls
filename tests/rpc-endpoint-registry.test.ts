import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  activeSetFromRows,
  configuredEndpoints,
  disabledEndpointIds,
  resetRpcEndpointsForTests,
  rpcEndpointGeneration,
  setRpcEndpointCache,
} from "../lib/config/rpc-endpoints";
import type { RpcEndpointRow } from "../lib/data/rpc-endpoints";

/**
 * The operator-editable RPC pool (migration 0061, KNOWN-PROBLEMS L19).
 *
 * The assertions that matter here are the THREE-STATE ones. An unseeded table,
 * an unreachable database and a table full of disabled rows are three
 * different situations that all have to resolve to "use the env seed" — and
 * NONE of them may resolve to "the pool has no providers" (§4, §8 #9).
 */

function row(over: Partial<RpcEndpointRow> = {}): RpcEndpointRow {
  return {
    id: "alpha",
    url: "https://alpha.example",
    enabled: true,
    sortOrder: 10,
    maxCuPerSecond: null,
    maxRequestsPerSecond: null,
    maxConcurrentRequests: null,
    preferMethods: [],
    maxLogSpan: null,
    denyMethods: [],
    allowMethods: [],
    note: null,
    disabledAt: null,
    updatedAt: null,
    updatedBy: null,
    pool: "shared",
    ...over,
  };
}

test("an unseeded table is 'no opinion', never an empty pool", () => {
  resetRpcEndpointsForTests();
  const { endpoints, disabledIds } = activeSetFromRows([]);
  assert.equal(endpoints, null, "zero rows must mean null (use the env seed), not []");
  assert.deepEqual(disabledIds, []);
});

test("rows that exist but are ALL disabled also fall back, rather than emptying the pool", () => {
  // The dangerous alternative is returning [] here: buildProviders would then
  // have no provider to try and every scan in the process would fail with
  // RC_RPC_NO_HEALTHY_PROVIDER — an operator misconfiguration taking the
  // scanner off the chain entirely.
  const { endpoints, disabledIds } = activeSetFromRows([
    row({ id: "a", enabled: false }),
    row({ id: "b", enabled: false }),
  ]);
  assert.equal(endpoints, null);
  assert.deepEqual(disabledIds.sort(), ["a", "b"]);
});

test("a disabled endpoint is dropped from the active set and named as disabled", () => {
  const { endpoints, disabledIds } = activeSetFromRows([
    row({ id: "live" }),
    row({ id: "quota-dead", enabled: false }),
  ]);
  assert.deepEqual(endpoints?.map((e) => e.id), ["live"]);
  assert.deepEqual(disabledIds, ["quota-dead"]);
});

test("capabilities and limits round-trip from columns into the pool's shape", () => {
  const { endpoints } = activeSetFromRows([
    row({
      id: "alchemy",
      maxLogSpan: 10,
      maxCuPerSecond: 500,
      maxConcurrentRequests: 4,
      preferMethods: ["eth_getTransactionReceipt"],
      denyMethods: ["eth_sendRawTransaction"],
    }),
  ]);
  const e = endpoints![0];
  assert.equal(e.capabilities?.maxLogSpan, 10);
  assert.deepEqual(e.capabilities?.denyMethods, ["eth_sendRawTransaction"]);
  assert.equal(e.capabilities?.allowMethods, undefined, "an empty array is not an allowlist of nothing");
  assert.equal(e.maxCuPerSecond, 500);
  assert.deepEqual(e.preferMethods, ["eth_getTransactionReceipt"]);
});

test("an unbounded maxLogSpan stays undefined — null is not zero", () => {
  // maxLogSpan 0 would route EVERY eth_getLogs away from the provider. A null
  // column means "no declared cap", and collapsing the two would silently
  // remove the chain's own public RPC from log indexing.
  const { endpoints } = activeSetFromRows([row({ maxLogSpan: null })]);
  assert.equal(endpoints![0].capabilities, undefined);
});

test("a malformed row is dropped AND named, never dropped silently", () => {
  const { endpoints, malformedIds } = activeSetFromRows([
    row({ id: "good" }),
    row({ id: "bad-url", url: "ftp://nope" }),
    row({ id: "bad-span", maxLogSpan: -1 }),
  ]);
  assert.deepEqual(endpoints?.map((e) => e.id), ["good"]);
  assert.deepEqual(malformedIds.sort(), ["bad-span", "bad-url"]);
});

test("the generation moves only when the active set actually changes", () => {
  // buildProviders rebuilds on a generation change. If the generation moved on
  // every prime, a 60s TTL would throw away the provider list — and its warm
  // circuit state with it — once a minute, so a sick provider would be retried
  // forever and never stay sidelined.
  resetRpcEndpointsForTests();
  setRpcEndpointCache([{ id: "a", url: "https://a.example" }]);
  const first = rpcEndpointGeneration();
  setRpcEndpointCache([{ id: "a", url: "https://a.example" }]);
  assert.equal(rpcEndpointGeneration(), first, "an identical reload must not bump the generation");
  setRpcEndpointCache([{ id: "b", url: "https://b.example" }]);
  assert.ok(rpcEndpointGeneration() > first, "a changed set must bump it");
  resetRpcEndpointsForTests();
});

test("configuredEndpoints() is null before anything primes it", () => {
  resetRpcEndpointsForTests();
  assert.equal(configuredEndpoints(), null);
  assert.deepEqual(disabledEndpointIds(), []);
});

// ── wiring, not logic (§8 #10) ────────────────────────────────────────────
//
// primeTrustedLockers() was correct, unit-tested through its own injection
// seam, and had ZERO callers for months. A test that installs the thing whose
// absence is the bug can never fail on that bug. So these read the SOURCE of
// the file that must make the call.

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

test("buildProviders() refreshes the registry and honours its generation", () => {
  const pool = src("../lib/rpc/provider-pool.ts");
  assert.match(
    pool,
    /function buildProviders\(\)[\s\S]{0,400}refreshRpcEndpoints\(\)/,
    "buildProviders must kick the registry refresh — it is the only function every " +
      "RPC path in the process already goes through, so it is the only wiring with " +
      "no second place to remember (§8 #10)",
  );
  assert.match(
    pool,
    /if \(providers && builtGeneration === rpcEndpointGeneration\(\)\) return providers/,
    "a memoized pool must be invalidated by a registry generation change, or an " +
      "admin disabling an endpoint would never take effect in a warm process",
  );
  assert.match(
    pool,
    /configuredEndpoints\(\) \?\? parseEndpointConfig\(process\.env\)/,
    "the DB set must FALL BACK to the env seed, never replace it with nothing",
  );
});

test("only the data module may select the endpoint URL", () => {
  // The URL carries an Alchemy key in its path and a Goldsky ?secret=. Moving
  // the pool into Postgres is only safe while exactly one module can read it.
  const page = src("../app/admin/(dashboard)/rpc/page.tsx");
  assert.doesNotMatch(
    page,
    /readRpcEndpoints\(\)/,
    "the admin page must use readRpcEndpointsRedacted() — the unredacted read returns secrets",
  );
  assert.match(page, /readRpcEndpointsRedacted/);
});

test("the admin toggle refuses to disable the last enabled endpoint", () => {
  // Zero enabled rows falls back to RPC_ENDPOINTS_JSON, which would re-enable
  // the very provider just switched off. Accepting a write we will not honour
  // is worse than refusing it.
  const actions = src("../app/admin/(dashboard)/rpc/actions.ts");
  // Only a SHARED row keeps scans off the env seed; swap rows cannot serve them.
  assert.match(actions, /r\.enabled && r\.pool === "shared" && r\.id !== id\)\.length === 0/);
  assert.match(actions, /last enabled shared endpoint/i);
  assert.match(actions, /toggleRpcEndpointAction[\s\S]*?if \(!enable\) await assertSharedStaysOn\(id\)/);
  assert.match(actions, /deleteRpcEndpointAction[\s\S]*?await assertSharedStaysOn\(id\)/);
});

test("every admin mutation force-primes the cache", () => {
  // A plain prime() would return the 60s-TTL value and the generation would
  // not move, so the pool would keep routing to the disabled provider.
  const actions = src("../app/admin/(dashboard)/rpc/actions.ts");
  assert.match(actions, /primeRpcEndpoints\(true\)/);
  for (const fn of [
    "saveRpcEndpointAction",
    "toggleRpcEndpointAction",
    "deleteRpcEndpointAction",
    "seedRpcEndpointsAction",
  ]) {
    const body = actions.slice(actions.indexOf(`export async function ${fn}`));
    assert.match(
      body.slice(0, body.indexOf("\n}\n") + 3),
      /await settle\(\)/,
      `${fn} must settle() — force-prime plus revalidatePath`,
    );
  }
});

test("the migration and the Drizzle table agree on every column", () => {
  // §3: Drizzle silently discards keys that do not match a column, and
  // drizzle-kit's rendered defaults are not trustworthy. A column named here
  // but absent from 0061 would be dropped on write with no error.
  const sql = src("../supabase/migrations/0061_rpc_endpoints.sql");
  const schema = src("../lib/db/schema.ts");
  const table = schema.slice(schema.indexOf('pgTable("rpc_endpoints"'));
  const body = table.slice(0, table.indexOf("});"));
  for (const col of [
    "url",
    "enabled",
    "sort_order",
    "max_cu_per_second",
    "max_requests_per_second",
    "max_concurrent_requests",
    "prefer_methods",
    "max_log_span",
    "deny_methods",
    "allow_methods",
    "note",
    "disabled_at",
    "updated_by",
  ]) {
    assert.ok(sql.includes(col), `migration 0061 is missing column ${col}`);
    const camel = col.replace(/_([a-z0-9])/g, (_m, c) => c.toUpperCase());
    assert.ok(
      body.includes(`"${col}"`) || body.includes(`${camel}:`),
      `schema.ts is missing column ${col}`,
    );
  }
  // The array defaults are the §3 trap: drizzle-kit renders `default '{}'` as
  // `.default([""])`, an array holding one empty string.
  assert.doesNotMatch(body, /default\(\[""\]\)/, 'drizzle-kit rendered `default \'{}\'` as [""]');
});

// ── behaviour, not shape ──────────────────────────────────────────────────
//
// Everything above proves the registry computes the right list. None of it
// proves the POOL routes by it — §9: a check that explains the mechanism is
// not a check that the published behaviour changed. This drives the real
// poolRequest() against two local JSON-RPC servers and asserts which one got
// the traffic, which is the only statement an operator actually cares about.

test("a DISABLED endpoint receives no traffic from the real pool", async () => {
  const { createServer } = await import("node:http");
  const { poolRequest, resetProviderPoolForTests } = await import("../lib/rpc/provider-pool");
  const { resetProviderSchedulerForTests } = await import("../lib/rpc/scheduler");

  const spin = (tag: string) =>
    new Promise<{ url: string; hits: string[]; close: () => Promise<void> }>((resolve) => {
      const hits: string[] = [];
      const s = createServer((req, res) => {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          const p = JSON.parse(body);
          hits.push(p.method);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: p.id,
              result: p.method === "eth_chainId" ? "0x1237" : `0x${tag}`,
            }),
          );
        });
      });
      s.listen(0, "127.0.0.1", () => {
        const { port } = s.address() as import("node:net").AddressInfo;
        resolve({ url: `http://127.0.0.1:${port}`, hits, close: () => new Promise((r) => s.close(() => r())) });
      });
    });

  const dead = await spin("1");
  const live = await spin("2");
  const prevEnv = process.env.RPC_ENDPOINTS_JSON;
  try {
    // The env seed lists BOTH, dead first — so if the registry were ignored,
    // dead would serve every call. That is the pre-0061 behaviour.
    process.env.RPC_ENDPOINTS_JSON = JSON.stringify([
      { id: "quota-dead", url: dead.url },
      { id: "live", url: live.url },
    ]);
    resetProviderPoolForTests();
    resetProviderSchedulerForTests();

    // The operator has switched the first one off.
    setRpcEndpointCache([{ id: "live", url: live.url }], ["quota-dead"]);

    for (let i = 0; i < 4; i++) await poolRequest({ method: "eth_blockNumber", params: [] });

    assert.deepEqual(
      dead.hits.filter((m) => m === "eth_blockNumber"),
      [],
      "a disabled endpoint must receive nothing — not even the failover attempt",
    );
    assert.equal(live.hits.filter((m) => m === "eth_blockNumber").length, 4);
    assert.deepEqual(disabledEndpointIds(), ["quota-dead"]);
  } finally {
    if (prevEnv === undefined) delete process.env.RPC_ENDPOINTS_JSON;
    else process.env.RPC_ENDPOINTS_JSON = prevEnv;
    resetProviderPoolForTests();
    resetProviderSchedulerForTests();
    await dead.close();
    await live.close();
  }
});

test("re-enabling mid-process brings an endpoint back without a restart", async () => {
  // The generation is what makes this work: buildProviders memoizes, so a warm
  // process would otherwise hold its provider list until the container
  // restarted — exactly the deploy-shaped delay this feature exists to remove.
  const { providerIds, resetProviderPoolForTests } = await import("../lib/rpc/provider-pool");
  const prevEnv = process.env.RPC_ENDPOINTS_JSON;
  try {
    process.env.RPC_ENDPOINTS_JSON = JSON.stringify([{ id: "seed", url: "https://seed.example" }]);
    resetProviderPoolForTests();

    setRpcEndpointCache([{ id: "only-live", url: "https://a.example" }], ["off"]);
    assert.deepEqual(providerIds(), ["only-live"]);

    setRpcEndpointCache(
      [
        { id: "only-live", url: "https://a.example" },
        { id: "off", url: "https://b.example" },
      ],
      [],
    );
    assert.deepEqual(providerIds(), ["only-live", "off"], "the pool must rebuild on a generation bump");
  } finally {
    if (prevEnv === undefined) delete process.env.RPC_ENDPOINTS_JSON;
    else process.env.RPC_ENDPOINTS_JSON = prevEnv;
    resetProviderPoolForTests();
  }
});

test("two endpoints sharing a hostname are DISTINGUISHABLE in the admin view", async () => {
  // The redaction that hid the secret also hid the identity: both Alchemy keys
  // live on robinhood-mainnet.g.alchemy.com, so /admin/rpc rendered the
  // exhausted row and the healthy one identically and the operator could not
  // tell which to switch off. A redaction must remove the secret, not the
  // distinction the page exists to make.
  const { redactRpcUrl, rpcUrlFingerprint } = await import("../lib/data/rpc-endpoints");
  const a = "https://robinhood-mainnet.g.alchemy.com/v2/KEY_ONE";
  const b = "https://robinhood-mainnet.g.alchemy.com/v2/KEY_TWO";

  assert.equal(redactRpcUrl(a), redactRpcUrl(b), "the hostname alone cannot separate them");
  assert.notEqual(rpcUrlFingerprint(a), rpcUrlFingerprint(b), "the fingerprint must");
  assert.equal(rpcUrlFingerprint(a), rpcUrlFingerprint(a), "and must be stable for one URL");
  assert.match(rpcUrlFingerprint(a), /^[0-9a-f]{6}$/);
  // One-way, and short enough not to be a key excerpt.
  assert.ok(!a.includes(rpcUrlFingerprint(a)), "the fingerprint is not a slice of the secret");
});

test("swap rows never join the shared set, and never stand in for it", () => {
  const { endpoints, swapEndpoints } = activeSetFromRows([
    row({ id: "shared-a" }),
    row({ id: "swap-a", pool: "swap" }),
    row({ id: "swap-off", pool: "swap", enabled: false }),
  ]);
  assert.deepEqual(endpoints?.map((e) => e.id), ["shared-a"]);
  assert.deepEqual(swapEndpoints.map((e) => [e.id, e.swapOnly]), [["swap-a", true]]);

  const swapOnly = activeSetFromRows([row({ id: "swap-a", pool: "swap" })]);
  assert.equal(swapOnly.endpoints, null, "only swap rows on means scans fall back to the env seed");
});

test("the swap scope walks swap keys first; scans never touch them; with none on, swap uses the shared pool", async () => {
  const { createServer } = await import("node:http");
  const { poolRequest, resetProviderPoolForTests } = await import("../lib/rpc/provider-pool");
  const { resetProviderSchedulerForTests } = await import("../lib/rpc/scheduler");
  const spin = () =>
    new Promise<{ url: string; hits: string[]; close: () => Promise<void> }>((resolve) => {
      const hits: string[] = [];
      const s = createServer((req, res) => {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          const p = JSON.parse(body);
          hits.push(p.method);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", id: p.id, result: p.method === "eth_chainId" ? "0x1237" : "0x1" }));
        });
      });
      s.listen(0, "127.0.0.1", () => {
        const { port } = s.address() as import("node:net").AddressInfo;
        resolve({ url: `http://127.0.0.1:${port}`, hits, close: () => new Promise((r) => s.close(() => r())) });
      });
    });
  const shared = await spin();
  const swap = await spin();
  const calls = (server: { hits: string[] }) => server.hits.filter((m) => m === "eth_blockNumber").length;
  try {
    resetProviderPoolForTests();
    resetProviderSchedulerForTests();
    // Shared sorts first, so only the scope can put the swap key ahead of it.
    setRpcEndpointCache([{ id: "shared", url: shared.url }], [], [{ id: "swap", url: swap.url, swapOnly: true }]);

    for (let i = 0; i < 3; i++) await poolRequest({ method: "eth_blockNumber", params: [] });
    assert.equal(calls(swap), 0, "a scan must never spend a swap key");
    assert.equal(calls(shared), 3);

    for (let i = 0; i < 3; i++) await poolRequest({ method: "eth_blockNumber", params: [] }, "swap");
    assert.equal(calls(swap), 3, "the swap must use its own key first");
    assert.equal(calls(shared), 3);

    // The operator switched the swap key off: the swap falls back to the shared pool.
    setRpcEndpointCache([{ id: "shared", url: shared.url }], ["swap"], []);
    await poolRequest({ method: "eth_blockNumber", params: [] }, "swap");
    assert.equal(calls(shared), 4);
    assert.equal(calls(swap), 3);
  } finally {
    resetProviderPoolForTests();
    resetProviderSchedulerForTests();
    await shared.close();
    await swap.close();
  }
});
