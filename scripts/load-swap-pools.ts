import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { upsertSwapPools } from "@/lib/data/swap-pools";
import type { swapPools } from "@/lib/db/schema";

export interface RawNdjsonPool {
  pool?: string | null;
  dex?: string | null;
  protocol?: string | null;
  factory?: string | null;
  token0?: string | null;
  token1?: string | null;
  fee?: number | null;
  tickSpacing?: number | null;
  createdBlock?: number | null;
}

export function parseNdjsonPoolLine(line: string): typeof swapPools.$inferInsert | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const raw = JSON.parse(trimmed) as RawNdjsonPool;
  if (!raw.pool || !raw.dex || !raw.protocol || !raw.factory) return null;
  if (raw.protocol !== "v2" && raw.protocol !== "v3") return null;
  // Token0 or token1 may be null when a read failed: skip those rows and never insert a null token
  if (!raw.token0 || !raw.token1) return null;
  return {
    pool: raw.pool.toLowerCase(),
    dex: raw.dex,
    protocol: raw.protocol,
    factory: raw.factory.toLowerCase(),
    token0: raw.token0.toLowerCase(),
    token1: raw.token1.toLowerCase(),
    fee: raw.fee == null ? null : Number(raw.fee),
    tickSpacing: raw.tickSpacing == null ? null : Number(raw.tickSpacing),
    createdBlock: raw.createdBlock == null ? null : Number(raw.createdBlock),
  };
}

export function parseNdjsonLines(lines: readonly string[]): {
  valid: (typeof swapPools.$inferInsert)[];
  skipped: number;
  total: number;
} {
  let total = 0;
  let skipped = 0;
  const valid: (typeof swapPools.$inferInsert)[] = [];
  for (const l of lines) {
    if (!l.trim()) continue;
    total++;
    const r = parseNdjsonPoolLine(l);
    if (!r) skipped++;
    else valid.push(r);
  }
  return { valid, skipped, total };
}

export async function loadNdjsonFile(filePath: string): Promise<{ file: string; inserted: number; skipped: number; total: number }> {
  // A missing file must not read as "0 pools": that is a coverage gap, not an empty factory.
  if (!existsSync(filePath)) throw new Error(`${filePath} not found`);
  const fileStream = createReadStream(filePath, { encoding: "utf8" });
  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

  let total = 0;
  let skipped = 0;
  let inserted = 0;
  const BATCH_SIZE = 1000;
  let batch: (typeof swapPools.$inferInsert)[] = [];

  for await (const line of rl) {
    if (!line.trim()) continue;
    total++;
    const row = parseNdjsonPoolLine(line);
    if (!row) {
      skipped++;
      continue;
    }
    batch.push(row);
    if (batch.length >= BATCH_SIZE) {
      inserted += await upsertSwapPools(batch);
      batch = [];
    }
  }

  if (batch.length > 0) {
    inserted += await upsertSwapPools(batch);
  }

  return { file: filePath, inserted, skipped, total };
}

const FILES = ["v2.ndjson", "v3.ndjson", "slipstream.ndjson"];
const DIR = "output/swap-pools-backfill";

export async function main(): Promise<void> {
  for (const name of FILES) {
    const fullPath = `${DIR}/${name}`;
    const res = await loadNdjsonFile(fullPath);
    console.log(`${name}: inserted ${res.inserted}, skipped ${res.skipped}, total ${res.total}`);
  }
}

const isDirectRun = process.argv[1]?.endsWith("load-swap-pools.ts");
if (isDirectRun) {
  main().then(() => process.exit(0)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
