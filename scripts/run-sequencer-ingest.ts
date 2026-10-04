import { SequencerClient } from "../lib/sequencer/client";
import { SequencerPipeline } from "../lib/sequencer/pipeline";
import { database } from "../lib/db/client";
import { sql } from "drizzle-orm";
import { launches, v4Pools } from "../lib/db/schema";

// Load .env.local and normalize DB / Redis hosts for local execution
try {
  process.loadEnvFile(".env.local");
} catch {
  // ambient environment
}

if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes("@pgbouncer:6432")) {
  process.env.DATABASE_URL = process.env.DATABASE_URL.replace("@pgbouncer:6432", "@127.0.0.1:6432");
}

if (process.env.REDIS_URL && process.env.REDIS_URL.includes("valkey:6379")) {
  process.env.REDIS_URL = process.env.REDIS_URL.replace("valkey:6379", "127.0.0.1:6379");
}

async function main() {
  console.log("==================================================================");
  console.log("   RobinCalls Real-Time Sequencer Relay Ingestion & Verification   ");
  console.log("==================================================================");

  const db = database();
  if (!db) {
    throw new Error("Local database unavailable. Ensure robincalls-pgbouncer-1 is running.");
  }

  // 1. Initial database baseline
  const [initLaunchesRow] = await db.select({ count: sql<number>`count(*)::int` }).from(launches);
  const [initV4PoolsRow] = await db.select({ count: sql<number>`count(*)::int` }).from(v4Pools);
  const baselineLaunches = initLaunchesRow?.count ?? 0;
  const baselineV4Pools = initV4PoolsRow?.count ?? 0;

  console.log(`[DB Baseline] launches: ${baselineLaunches.toLocaleString()}, v4_pools: ${baselineV4Pools.toLocaleString()}`);

  const detectedLaunches: any[] = [];
  const detectedV4Pools: any[] = [];
  let totalBatches = 0;
  let totalTxs = 0;
  let totalTrades = 0;
  const startMs = Date.now();

  const pipeline = new SequencerPipeline({
    persistToDb: true, // WRITE DIRECTLY TO LOCAL DATABASE
    onV4Pools: (pools) => {
      detectedV4Pools.push(...pools);
      for (const p of pools) {
        console.log(`\n⚡ [V4 Pool Event Persisted]`);
        console.log(`   PoolId:      ${p.poolId}`);
        console.log(`   Pair:        ${p.currency0} / ${p.currency1}`);
        console.log(`   Fee / Tick:  ${p.fee} / ${p.tickSpacing}`);
        console.log(`   Hooks:       ${p.hooks}`);
        console.log(`   Tx / Block:  ${p.txHash} (block ${p.blockNumber})`);
      }
    },
    onLaunches: (newLaunches) => {
      detectedLaunches.push(...newLaunches);
      for (const l of newLaunches) {
        console.log(`\n🚀 [Launch Event Persisted]`);
        console.log(`   Family:      ${l.family} (${l.launchpadId})`);
        console.log(`   Token:       ${l.tokenAddress} (${l.symbol})`);
        console.log(`   Name:        ${l.name}`);
        console.log(`   Creator:     ${l.creatorAddress ?? "null (unattributed)"}`);
        console.log(`   Tx / Block:  ${l.launchTxHash} (block ${l.createdBlock})`);
      }
    },
    onTrades: (trades) => {
      totalTrades += trades.length;
    },
    onGap: (gap) => {
      console.warn(`⚠️ [Sequence Gap Detected] Expected ${gap.expectedSeq}, received ${gap.receivedSeq} (size: ${gap.gapSize})`);
    },
  });

  const client = new SequencerClient({
    url: process.env.WS_FEED_URL || "ws://127.0.0.1:9642",
    pipeline,
    onBatch: (batch) => {
      totalBatches++;
      totalTxs += batch.transactions.length;
    },
    onError: (err) => {
      console.error("[Sequencer Client Error]", err);
    },
  });

  const isContinuous = process.argv.includes("--continuous") || process.env.CONTINUOUS === "1";
  const explicitDuration = process.env.RUN_DURATION_MS ? parseInt(process.env.RUN_DURATION_MS, 10) : null;
  const RUN_DURATION_MS = explicitDuration ?? (isContinuous ? 0 : 20_000);

  if (isContinuous || RUN_DURATION_MS === 0) {
    console.log(`[Relay Client] Starting continuous ingestion daemon (Ctrl+C to stop)...`);
    client.start();

    // Heartbeat every 15 seconds
    const heartbeatTimer = setInterval(async () => {
      const durationSec = (Date.now() - startMs) / 1000;
      const cursorState = pipeline.getCursor().getState();
      console.log(
        `💓 [Heartbeat ${durationSec.toFixed(0)}s] Batches: ${totalBatches} | Txs: ${totalTxs} | ` +
        `Trades: ${totalTrades} | Pools: ${detectedV4Pools.length} | Launches: ${detectedLaunches.length} | ` +
        `Head: #${cursorState.sequenceNumber} (Block: ${cursorState.blockNumber})`
      );
    }, 15_000);

    await new Promise<void>((resolve) => {
      const shutdown = () => {
        console.log(`\n[Relay Client] Graceful shutdown requested. Stopping client...`);
        clearInterval(heartbeatTimer);
        client.stop();
        resolve();
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    });
  } else {
    console.log(`[Relay Client] Starting timed ingestion for ${RUN_DURATION_MS / 1000}s...`);
    client.start();

    await new Promise<void>((resolve) => {
      setTimeout(() => {
        console.log(`[Relay Client] Ingestion window finished. Stopping client...`);
        client.stop();
        resolve();
      }, RUN_DURATION_MS);
    });
  }

  // Short pause for any inflight queue completion
  await new Promise((r) => setTimeout(r, 500));

  const durationSec = (Date.now() - startMs) / 1000;
  const cursorState = pipeline.getCursor().getState();

  // 2. Post-ingest database verification
  const [postLaunchesRow] = await db.select({ count: sql<number>`count(*)::int` }).from(launches);
  const [postV4PoolsRow] = await db.select({ count: sql<number>`count(*)::int` }).from(v4Pools);
  const postLaunches = postLaunchesRow?.count ?? 0;
  const postV4Pools = postV4PoolsRow?.count ?? 0;

  console.log("\n==================================================================");
  console.log("                     INGESTION RUN SUMMARY                        ");
  console.log("==================================================================");
  console.log(`Duration:                 ${durationSec.toFixed(2)} seconds`);
  console.log(`Sequencer Batches:        ${totalBatches} (${(totalBatches / durationSec).toFixed(1)} batches/sec)`);
  console.log(`EVM Transactions:         ${totalTxs} (${(totalTxs / durationSec).toFixed(1)} tx/sec)`);
  console.log(`Live Trades Ingested:     ${totalTrades}`);
  console.log(`V4 Pools Intercepted:     ${detectedV4Pools.length}`);
  console.log(`Launches Intercepted:     ${detectedLaunches.length}`);
  console.log(`Sequence Head:            ${cursorState.sequenceNumber}`);
  console.log(`L2 Block Head:            ${cursorState.blockNumber}`);
  console.log(`Sequence Gaps:            ${cursorState.gapsDetected}`);
  console.log("------------------------------------------------------------------");
  console.log(`Database Launches Count:  ${baselineLaunches.toLocaleString()} -> ${postLaunches.toLocaleString()} (+${postLaunches - baselineLaunches})`);
  console.log(`Database V4 Pools Count:  ${baselineV4Pools.toLocaleString()} -> ${postV4Pools.toLocaleString()} (+${postV4Pools - baselineV4Pools})`);
  console.log("==================================================================\n");

  if (detectedLaunches.length > 0 || detectedV4Pools.length > 0) {
    console.log("✅ Verified! Real records intercepted and written into Postgres tables!");
  } else {
    console.log("ℹ️ No new token launches or pool inits in this 20s window (swaps & trades ingested).");
  }
}

main().catch((err) => {
  console.error("Ingestion failed:", err);
  process.exit(1);
});
