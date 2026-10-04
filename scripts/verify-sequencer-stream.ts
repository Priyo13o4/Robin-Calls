import WebSocket from "ws";
import { decodeSequencerMessage } from "../lib/sequencer/decoder";
import { SequencerPipeline } from "../lib/sequencer/pipeline";

async function main() {
  console.log("=== Testing Real-Time Sequencer Relay Stream (ws://127.0.0.1:9642) ===");
  const ws = new WebSocket("ws://127.0.0.1:9642");

  let totalBatches = 0;
  let totalTxs = 0;
  let totalV4Pools = 0;
  let totalLaunches = 0;
  let totalTrades = 0;
  const startMs = Date.now();

  const pipeline = new SequencerPipeline({
    persistToDb: false, // Don't write in this test sampler
    onV4Pools: (pools) => {
      totalV4Pools += pools.length;
      for (const p of pools) {
        console.log(`[V4 Pool Initialized] poolId=${p.poolId} pair=${p.currency0}/${p.currency1} fee=${p.fee}`);
      }
    },
    onLaunches: (launches) => {
      totalLaunches += launches.length;
      for (const l of launches) {
        console.log(`[Launch Detected] family=${l.family} token=${l.tokenAddress} name=${l.name} symbol=${l.symbol}`);
      }
    },
    onTrades: (trades) => {
      totalTrades += trades.length;
      for (const t of trades.slice(0, 2)) {
        console.log(`[Live Trade Ticker] token=${t.tokenAddress} side=${t.side} amount=${t.amount}`);
      }
    },
    onGap: (gap) => {
      console.warn(`[Sequence Gap Detected] Expected ${gap.expectedSeq}, got ${gap.receivedSeq} (size ${gap.gapSize})`);
    },
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      resolve();
    }, 4000); // Sample 4 seconds

    ws.on("open", () => {
      console.log("[Relay] WebSocket connected to ws://127.0.0.1:9642");
    });

    ws.on("message", async (data: WebSocket.RawData) => {
      const text = data.toString("utf-8");
      const batches = decodeSequencerMessage(text);
      totalBatches += batches.length;

      for (const b of batches) {
        totalTxs += b.transactions.length;
        await pipeline.processBatch(b);
      }

      if (totalBatches >= 40) {
        clearTimeout(timer);
        ws.removeAllListeners();
        ws.terminate();
        resolve();
      }
    });

    ws.on("error", (err) => {
      console.error("[Relay Error]", err);
      reject(err);
    });
  });

  const durationSec = (Date.now() - startMs) / 1000;
  const cursorState = pipeline.getCursor().getState();

  console.log("\n=== Live Sequencer Relay Ingestion Results ===");
  console.log(`Duration: ${durationSec.toFixed(2)}s`);
  console.log(`Sequencer Batches Ingested: ${totalBatches} (${(totalBatches / durationSec).toFixed(1)} batches/s)`);
  console.log(`EVM Transactions Decoded: ${totalTxs} (${(totalTxs / durationSec).toFixed(1)} tx/s)`);
  console.log(`Last Sequence Number: ${cursorState.sequenceNumber}`);
  console.log(`Last L2 Block Number: ${cursorState.blockNumber}`);
  console.log(`Sequence Gaps: ${cursorState.gapsDetected}`);
  console.log(`V4 Pools Initialized: ${totalV4Pools}`);
  console.log(`Launches Detected: ${totalLaunches}`);
  console.log(`Live Trades Processed: ${totalTrades}`);
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
