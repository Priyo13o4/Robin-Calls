import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiParameters,
  type Hex,
} from "viem";
import { launches } from "@/lib/db/schema";
import {
  enqueueSequencerWork,
  readSequencerWork,
  reserveSequencerCredits,
  retrySequencerWork,
} from "@/lib/data/sequencer";
import { database } from "@/lib/db/client";
import { PONS_V2_FACTORY } from "@/lib/sequencer/handlers/launches";
import { POOL_GRADUATED, TOKEN_LAUNCHED } from "@/lib/launches/modules/pons-v2";
import { DEFAULT_V4_POOL_MANAGER, v4InitializeEvent } from "@/lib/launches/modules/v4-pools";
import { computeV4PoolId } from "@/lib/sequencer/confirmed-events";
import { executionDeps, fetchExecutionEvidence } from "@/lib/sequencer/execution-provider";
import { enqueuePonsEvent, persistExecution, processSequencerWork, runtimeDeps } from "@/lib/sequencer/runtime";
import { normalizePonsEvent, type PonsConfirmedLaunchEvent, type PonsTokenMetaEvent } from "@/lib/sequencer/pons-events";
import type { SequencerWork } from "@/lib/data/sequencer";
import type { LauncherInstance } from "@/lib/launches/types";

const TOKEN_PONS = fixtureAddress(1);
const TOKEN_V4 = fixtureAddress(2);
const TOKEN_REVERTED = fixtureAddress(3);
const TX_PONS = fixtureHash(1);
const TX_GRADUATION = fixtureHash(2);
const TX_V4 = fixtureHash(3);
const TX_REVERTED = fixtureHash(4);
const TX_PROVIDER = fixtureHash(5);
const POOL_PONS = fixtureAddress(11);
const CREATOR = fixtureAddress(12);
const DEPLOYER = fixtureAddress(13);
const ZERO = "0x0000000000000000000000000000000000000000" as const;
const BUDGET_DAY = new Date("2001-01-02T12:00:00.000Z");
const BUDGET_ACCOUNT = createHash("sha256").update("sequencer-local-e2e-dedicated-account").digest("hex").slice(0, 16);
const BUDGET_STORAGE_KEY = createHash("sha256").update(BUDGET_ACCOUNT).digest("hex");
const WORK_IDS = [TX_PONS, TX_GRADUATION, TX_V4, TX_REVERTED, TX_PROVIDER, `pool:${TX_GRADUATION}`];
const PONS_WORK_IDS = [
  `pons:newToken:${TX_PONS}:${TOKEN_PONS}`,
  `pons:graduation:${TX_GRADUATION}:${TOKEN_PONS}`,
];
const META_WORK_ID = `meta:${TOKEN_PONS}`;
const FUTURE_AT = () => new Date(Date.now() + 24 * 60 * 60_000).toISOString();
const CHECKPOINTS = [
  ...[TX_PONS, TX_GRADUATION, TX_V4, TX_REVERTED, TX_PROVIDER].map((h) => `tx:${h}`),
  `meta:${TOKEN_PONS}`,
  `provider:blockscout`,
  `provider:robinscan`,
];

type MockPlan = { status: number; body?: Record<string, unknown> };
const plans = new Map<string, MockPlan>();
let blockscoutFetches = 0;
let blockscoutPublicFetches = 0;
let robinscanFetches = 0;

function fixtureAddress(n: number): `0x${string}` {
  return `0x${"e".repeat(36)}${n.toString(16).padStart(4, "0")}`;
}
function fixtureHash(n: number): `0x${string}` {
  return `0x${"e".repeat(60)}${n.toString(16).padStart(4, "0")}`;
}
function nowSeconds(): number { return Math.floor(Date.now() / 1000); }
function ponsLaunch(token: string, txHash: string, pool: string): PonsConfirmedLaunchEvent {
  const at = nowSeconds();
  const raw = {
    type: "newToken", status: "confirmed", token, pool, pairToken: ZERO,
    quote: { symbol: "ETH", decimals: 18 }, graduationThreshold: "1000000",
    block: 101, blockTimestamp: at, txHash, creator: CREATOR, deployer: DEPLOYER,
    name: null, symbol: null, imageUri: null, description: "local e2e fixture", socials: null,
    devBuyWei: "1", initialBuyWei: "1",
  };
  const event = normalizePonsEvent(raw);
  assert.ok(event && event.type === "newToken" && event.status === "confirmed");
  return event;
}
function ponsMeta(token: string): PonsTokenMetaEvent {
  const event = normalizePonsEvent({ type: "tokenMeta", token, name: "Sequencer E2E", symbol: "E2E", decimals: 18 });
  assert.ok(event && event.type === "tokenMeta");
  return event;
}
function tokenLaunchedLog(token: string, curve: string, txHash: string, index = 1) {
  return {
    address: PONS_V2_FACTORY,
    topics: encodeEventTopics({ abi: [TOKEN_LAUNCHED], eventName: "TokenLaunched", args: { token: token as Hex, curve: curve as Hex, deployer: DEPLOYER } }),
    data: encodeAbiParameters(parseAbiParameters("address,uint256,uint256"), [ZERO, 1n, 1000000n]),
    logIndex: index,
  };
}
function graduationLog(token: string, txHash: string, index = 2) {
  return {
    address: PONS_V2_FACTORY,
    topics: encodeEventTopics({ abi: [POOL_GRADUATED], eventName: "PoolGraduated", args: { token: token as Hex } }),
    data: encodeAbiParameters(parseAbiParameters("uint256,uint256,uint256"), [7n, 100n, 200n]),
    logIndex: index,
  };
}
function v4InitLog(token: string, txHash: string, index = 3) {
  const currency0 = "0x1111111111111111111111111111111111111111" as Hex;
  const currency1 = token as Hex;
  const fee = 3000;
  const tickSpacing = 60;
  const hooks = ZERO as Hex;
  const poolId = computeV4PoolId({ currency0, currency1, fee, tickSpacing, hooks });
  return {
    poolId,
    log: {
      address: DEFAULT_V4_POOL_MANAGER,
      topics: encodeEventTopics({ abi: [v4InitializeEvent], eventName: "Initialize", args: { id: poolId, currency0, currency1 } }),
      data: encodeAbiParameters(parseAbiParameters("uint24,int24,address,uint160,int24"), [fee, tickSpacing, hooks, 1n, 0]),
      logIndex: index,
    },
  };
}
function planEvidence(hash: string, logs: Array<{ address: string; topics: readonly string[]; data: string; logIndex: number }>, status = 1, blockNumber = 101): void {
  plans.set(hash.toLowerCase(), {
    status: 200,
    body: { hash, blockNumber: String(blockNumber), timestamp: String(nowSeconds()), status, logs },
  });
}
function jsonResponse(plan: MockPlan): Response {
  return new Response(JSON.stringify(plan.body ?? {}), { status: plan.status, headers: { "content-type": "application/json" } });
}
function mockRequestHash(url: URL): string | null {
  const queryHash = url.searchParams.get("txhash");
  if (queryHash) return queryHash.toLowerCase();
  const txs = url.pathname.match(/\/txs\/(0x[0-9a-fA-F]{64})\/?$/);
  return txs?.[1]?.toLowerCase() ?? null;
}
function makeWork(row: SequencerWork | undefined): SequencerWork {
  assert.ok(row, "expected durable work row");
  return row;
}
async function loadWork(id: string): Promise<SequencerWork> {
  const row = (await readSequencerWork(250, new Date(Date.now() + 48 * 60 * 60_000).toISOString())).find((w) => w.id === id);
  return makeWork(row);
}
async function executionDepsEvidence(hash: string) {
  const result = await fetchExecutionEvidence(hash);
  assert.ok(result.ok, "mock provider should return confirmed execution evidence");
  return result.evidence;
}

async function main(): Promise<void> {
  if (process.env.SEQUENCER_LOCAL_E2E !== "true") throw new Error("set SEQUENCER_LOCAL_E2E=true to run this local integration script");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const parsed = new URL(databaseUrl);
  if (parsed.hostname !== "pgbouncer" && parsed.hostname !== "localhost") throw new Error("DATABASE_URL host must be pgbouncer or localhost");
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  let appPool: Pool | undefined;
  let safeCleanup = false;
  try {
  const conn = database();
  if (!conn) throw new Error("application database client is unavailable");
  appPool = (globalThis as typeof globalThis & { robincallsPgPool?: Pool }).robincallsPgPool;

  const originalExecution = { ...executionDeps };
  const originalMetric = runtimeDeps.metric;
  const originalEnrich = runtimeDeps.enrich;
  const originalEnqueue = runtimeDeps.enqueue;
  const originalRetry = runtimeDeps.retry;
  const originalEnv = {
    fallback: process.env.SEQUENCER_BLOCKSCOUT_FALLBACK,
    oneKey: process.env.EXPLORER_API_KEY,
    manyKeys: process.env.EXPLORER_API_KEYS,
  };
  const queuedAssertions: string[] = [];
  const instances = await runtimeDeps.instances();
  const ponsInstance = instances.find((i) => i.address.toLowerCase() === PONS_V2_FACTORY.toLowerCase() && i.family === "pons-v2");
  if (!ponsInstance) throw new Error("local database needs an enabled Pons V2 factory row for this fixture");
  const fixtureTokens = [TOKEN_PONS, TOKEN_V4, TOKEN_REVERTED];
    const v4Fixture = v4InitLog(TOKEN_V4, TX_V4);
  const collision = await pool.query("select token_address from launches where token_address = any($1::text[]) limit 1", [fixtureTokens]);
  const poolCollision = await pool.query("select pool_id from v4_pools where pool_id = $1 limit 1", [v4Fixture.poolId]);
  const workCollision = await pool.query("select id from sequencer_work where id = any($1::text[]) limit 1", [[...WORK_IDS, ...PONS_WORK_IDS, META_WORK_ID]]);
  const checkpointCollision = await pool.query("select stream from sequencer_checkpoints where stream = any($1::text[]) limit 1", [CHECKPOINTS.filter((k) => !k.startsWith("provider:"))]);
  const budgetCollision = await pool.query("select account_id from sequencer_budgets where day = $1 and account_id = $2 limit 1", [BUDGET_DAY.toISOString().slice(0, 10), BUDGET_STORAGE_KEY]);
  assert.equal(collision.rowCount, 0, "fixture token address already exists");
  assert.equal(poolCollision.rowCount, 0, "fixture pool id already exists");
  assert.equal(workCollision.rowCount, 0, "fixture work id already exists");
  assert.equal(checkpointCollision.rowCount, 0, "fixture checkpoint already exists");
  assert.equal(budgetCollision.rowCount, 0, "fixture budget account already exists");
  safeCleanup = true;

  try {
    process.env.SEQUENCER_BLOCKSCOUT_FALLBACK = "true";
    process.env.EXPLORER_API_KEYS = "sequencer-local-e2e-key";
    process.env.EXPLORER_API_KEY = "sequencer-local-e2e-key";
    runtimeDeps.enqueue = async (work) => enqueueSequencerWork({ ...work, availableAt: FUTURE_AT() });
    runtimeDeps.retry = async (id, retry) => retrySequencerWork(id, { ...retry, availableAt: FUTURE_AT() });
    runtimeDeps.metric = async () => undefined;
    runtimeDeps.enrich = async (drafts) => drafts; // E2E exercises storage/runtime without enrichment RPC.
    executionDeps.read = async (key) => memoryCheckpoints.get(key) ?? null;
    executionDeps.write = async (key, value) => { memoryCheckpoints.set(key, value); };
    executionDeps.reserve = async () => true;
    executionDeps.spend = async () => undefined;
    executionDeps.metric = async () => undefined;
    executionDeps.fetch = async (url) => {
      const parsedUrl = new URL(url);
      const hash = mockRequestHash(parsedUrl);
      if (parsedUrl.hostname.includes("blockscout")) {
        blockscoutFetches++;
        if (!parsedUrl.searchParams.has("apikey")) blockscoutPublicFetches++;
        if (hash === TX_PROVIDER) return new Response("{}", { status: 429, headers: { "retry-after": "60" } });
      } else robinscanFetches++;
      if (!hash || !plans.has(hash)) return jsonResponse({ status: 599 });
      return jsonResponse(plans.get(hash)!);
    };

    // Confirmed PumpDev launch followed by its metadata update, both through durable work.
    await enqueuePonsEvent(ponsLaunch(TOKEN_PONS, TX_PONS, POOL_PONS));
    const ponsWorkId = PONS_WORK_IDS[0];
    await processSequencerWork(await loadWork(ponsWorkId));
    await enqueuePonsEvent(ponsMeta(TOKEN_PONS));
    await processSequencerWork(await loadWork(META_WORK_ID));
    let row = await pool.query("select name, symbol, source from launches where token_address = $1", [TOKEN_PONS]);
    assert.equal(row.rowCount, 1);
    assert.equal(row.rows[0].name, "Sequencer E2E");
    assert.equal(row.rows[0].symbol, "E2E");
    assert.equal(row.rows[0].source, "ingest");
    queuedAssertions.push("confirmed-pons-and-meta");

    // Replaying the same confirmed feed item is idempotent and does not overwrite later metadata.
    await enqueuePonsEvent(ponsLaunch(TOKEN_PONS, TX_PONS, POOL_PONS));
    await processSequencerWork(await loadWork(ponsWorkId));
    row = await pool.query("select count(*)::int as n, max(name) as name from launches where token_address = $1", [TOKEN_PONS]);
    assert.equal(row.rows[0].n, 1);
    assert.equal(row.rows[0].name, "Sequencer E2E");
    queuedAssertions.push("duplicate-pons-idempotence");

    // A PumpDev graduation starts as unresolved synthetic evidence; recovery's real log upgrades that row.
    const graduation = normalizePonsEvent({ type: "graduation", status: "confirmed", token: TOKEN_PONS, block: 102, txHash: TX_GRADUATION });
    assert.ok(graduation && graduation.type === "graduation");
    await enqueuePonsEvent(graduation);
    await processSequencerWork(await loadWork(PONS_WORK_IDS[1]));
    row = await pool.query("select log_index, pool_ref from launch_events where token_address = $1 and kind = 'GRADUATED' and tx_hash = $2", [TOKEN_PONS, TX_GRADUATION]);
    assert.equal(row.rowCount, 1);
    assert.equal(row.rows[0].log_index, -1);
    planEvidence(TX_GRADUATION, [graduationLog(TOKEN_PONS, TX_GRADUATION)], 1, 103);
    const recoveredEvidence = await executionDepsEvidence(TX_GRADUATION);
    await persistExecution(recoveredEvidence, undefined, "recovery");
    row = await pool.query("select log_index, block_number from launch_events where token_address = $1 and kind = 'GRADUATED' and tx_hash = $2", [TOKEN_PONS, TX_GRADUATION]);
    assert.equal(row.rowCount, 1);
    assert.equal(row.rows[0].log_index, 2);
    assert.equal(Number(row.rows[0].block_number), 103);
    const beforePoolSkip = robinscanFetches;
    await processSequencerWork(await loadWork(`pool:${TX_GRADUATION}`));
    assert.equal(robinscanFetches, beforePoolSkip, "confirmed recovery scope should complete the pool job without another provider request");
    queuedAssertions.push("graduation-recovery-upgrade");

    // Real mocked receipt logs pass through execution normalization, confirmed decoding, and durable commit.
    const launchAndV4 = tokenLaunchedLog(TOKEN_V4, fixtureAddress(14), TX_V4);
    planEvidence(TX_V4, [launchAndV4, v4Fixture.log]);
    await enqueueSequencerWork({ id: TX_V4, kind: "tx", payload: { hash: TX_V4 }, availableAt: FUTURE_AT() });
    await processSequencerWork(await loadWork(TX_V4));
    const v4Check = await pool.query("select pool_id from v4_pools where pool_id = $1", [v4Fixture.poolId]);
    assert.equal(v4Check.rowCount, 1);
    await conn.delete(launches).where(eq(launches.tokenAddress, TOKEN_V4));
    const survivingPool = await pool.query("select pool_id from v4_pools where pool_id = $1", [v4Fixture.poolId]);
    assert.equal(survivingPool.rowCount, 1);
    queuedAssertions.push("v4-pool-survives-launch-delete");

    // A reverted execution is acknowledged without publishing launch evidence and removes its work row.
    const revertedLog = tokenLaunchedLog(TOKEN_REVERTED, fixtureAddress(15), TX_REVERTED);
    planEvidence(TX_REVERTED, [revertedLog], 0);
    await enqueueSequencerWork({ id: TX_REVERTED, kind: "tx", payload: { hash: TX_REVERTED }, availableAt: FUTURE_AT() });
    await processSequencerWork(await loadWork(TX_REVERTED));
    const [revertedLaunch, revertedWork] = await Promise.all([
      pool.query("select token_address from launches where token_address = $1", [TOKEN_REVERTED]),
      pool.query("select id from sequencer_work where id = $1", [TX_REVERTED]),
    ]);
    assert.equal(revertedLaunch.rowCount, 0);
    assert.equal(revertedWork.rowCount, 0);
    queuedAssertions.push("reverted-not-published");

    // First budget reservation fills this isolated historical test account; the next request is denied.
    const isolatedLimits = { accountDaily: 100, totalDaily: 200 };
    assert.equal(await reserveSequencerCredits(BUDGET_ACCOUNT, 100, isolatedLimits, BUDGET_DAY), true);
    assert.equal(await reserveSequencerCredits(BUDGET_ACCOUNT, 1, isolatedLimits, BUDGET_DAY), false);
    queuedAssertions.push("isolated-budget-cap");

    // Repeated Robinscan 404s reach public then PRO; each 429 sets its independent cooldown.
    plans.set(TX_PROVIDER, { status: 404 });
    await enqueueSequencerWork({ id: TX_PROVIDER, kind: "tx", payload: { hash: TX_PROVIDER }, availableAt: FUTURE_AT() });
    const beforeBlockscout = blockscoutFetches;
    for (let pass = 0; pass < 3; pass++) {
      const work = await loadWork(TX_PROVIDER);
      await processSequencerWork(work);
      const blockedWork = await pool.query("select attempts from sequencer_work where id = $1", [TX_PROVIDER]);
      assert.equal(blockedWork.rowCount, 1);
    }
    assert.equal(blockscoutFetches - beforeBlockscout, 2);
    assert.equal(blockscoutPublicFetches, 1);
    const queueAfter429 = await pool.query("select attempts, last_error from sequencer_work where id = $1", [TX_PROVIDER]);
    assert.equal(Number(queueAfter429.rows[0].attempts), 3);
    assert.match(String(queueAfter429.rows[0].last_error), /blockscout_429/);
    await processSequencerWork(await loadWork(TX_PROVIDER));
    assert.equal(blockscoutFetches - beforeBlockscout, 2, "cooldown skips must avoid another public or PRO Blockscout HTTP attempt");
    const queueAfterCooldown = await pool.query("select attempts, last_error from sequencer_work where id = $1", [TX_PROVIDER]);
    assert.equal(Number(queueAfterCooldown.rows[0].attempts), 4);
    assert.match(String(queueAfterCooldown.rows[0].last_error), /blockscout_cooldown/);
    queuedAssertions.push("provider-429-queued-retry-and-cooldown-skip");

    console.log(JSON.stringify({ ok: true, assertions: queuedAssertions, blockscoutFetches, blockscoutPublicFetches, robinscanFetches }));
  } finally {
    Object.assign(executionDeps, originalExecution);
    runtimeDeps.metric = originalMetric;
    runtimeDeps.enrich = originalEnrich;
    runtimeDeps.enqueue = originalEnqueue;
    runtimeDeps.retry = originalRetry;
    if (originalEnv.fallback === undefined) delete process.env.SEQUENCER_BLOCKSCOUT_FALLBACK; else process.env.SEQUENCER_BLOCKSCOUT_FALLBACK = originalEnv.fallback;
    if (originalEnv.oneKey === undefined) delete process.env.EXPLORER_API_KEY; else process.env.EXPLORER_API_KEY = originalEnv.oneKey;
    if (originalEnv.manyKeys === undefined) delete process.env.EXPLORER_API_KEYS; else process.env.EXPLORER_API_KEYS = originalEnv.manyKeys;
    if (safeCleanup) {
      await pool.query("delete from sequencer_work where id = any($1::text[])", [[...WORK_IDS, ...PONS_WORK_IDS, META_WORK_ID]]);
      await pool.query("delete from launch_events where token_address = any($1::text[])", [fixtureTokens]);
      await pool.query("delete from launches where token_address = any($1::text[])", [fixtureTokens]);
      await pool.query("delete from v4_pools where pool_id = $1", [v4Fixture.poolId]);
      await pool.query("delete from sequencer_checkpoints where stream = any($1::text[])", [CHECKPOINTS.filter((k) => !k.startsWith("provider:"))]);
      await pool.query("delete from sequencer_budgets where day = $1 and account_id = $2", [BUDGET_DAY.toISOString().slice(0, 10), BUDGET_STORAGE_KEY]);
    }
  }
  } finally {
    await pool.end();
    await appPool?.end();
  }
}

const memoryCheckpoints = new Map<string, Record<string, unknown>>();
void main().catch((error: unknown) => {
  console.error(JSON.stringify({ ok: false, message: error instanceof Error ? error.message.slice(0, 180) : "sequencer local e2e failed" }));
  process.exitCode = 1;
});
