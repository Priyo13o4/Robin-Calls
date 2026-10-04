import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { flags } from "@/lib/config/flags";
import { requireJobAuth, jobDisabled } from "@/lib/security/job-auth";
import { redisClient } from "@/lib/redis/client";
import { reportError } from "@/lib/observability/reporter";
import { processLogBatch } from "@/lib/data/analytics-ingest";
import {
  readIngestCursor,
  saveIngestCursor,
  persistBatchResult,
} from "@/lib/data/analytics";

export const maxDuration = 60;

const LOG_PATH =
  process.env.ANALYTICS_LOG_PATH || "/var/log/nginx/analytics.log";
// The rotation sidecar (docker-compose.yml: nginx-logrotate) renames the live
// file to this fixed suffix and signals nginx to reopen — see that service's
// comment for the full rename+USR1 mechanics.
const ROTATED_LOG_PATH = `${LOG_PATH}.1`;
const MAX_BYTES_PER_RUN = 10 * 1024 * 1024; // 10MB chunk per invocation (~50k lines)
const LOCK_KEY = "analytics:ingest:lock";
const LOCK_TTL_SECONDS = 55;

export interface ChunkResult {
  lines: string[];
  bytesConsumed: number;
}

/**
 * Read a bounded, newline-aligned chunk starting at `startOffset`.
 *
 * Normally we only keep bytes up to the last `\n` — a mid-write line must
 * wait for its terminator on the next run. `forceDrainAtEof` skips that wait:
 * it's for the rotated file, which nginx will never write to again, so a
 * missing trailing newline can only mean a crash mid-write, and holding the
 * cursor there forever (waiting for a byte that will never arrive) is worse
 * than discarding one malformed tail line.
 */
export function readChunk(
  path: string,
  startOffset: number,
  sizeAtRead: number,
  forceDrainAtEof: boolean,
): ChunkResult | null {
  if (startOffset >= sizeAtRead) return { lines: [], bytesConsumed: 0 };

  const bytesToRead = Math.min(sizeAtRead - startOffset, MAX_BYTES_PER_RUN);
  const fd = fs.openSync(path, "r");
  const buffer = Buffer.alloc(bytesToRead);
  try {
    fs.readSync(fd, buffer, 0, bytesToRead, startOffset);
  } finally {
    fs.closeSync(fd);
  }

  const lastNewlineIdx = buffer.lastIndexOf(0x0a); // '\n'
  const reachedEof = startOffset + bytesToRead >= sizeAtRead;

  if (lastNewlineIdx === -1) {
    if (forceDrainAtEof && reachedEof) {
      // No terminator anywhere in the remainder and there's nothing more
      // coming — consume it all; processLogBatch drops the malformed line.
      return { lines: [buffer.toString("utf8")], bytesConsumed: bytesToRead };
    }
    return { lines: [], bytesConsumed: 0 };
  }

  const text = buffer.subarray(0, lastNewlineIdx).toString("utf8");
  return { lines: text.split("\n"), bytesConsumed: lastNewlineIdx + 1 };
}

/**
 * Analytics log ingestion job (PRD: docs/ways-of-work/plan/first-party-analytics/PRD.md).
 *
 * Reads structured JSON access logs written by nginx into the shared `nginx_logs`
 * volume, aggregates metrics into hourly/daily rollup tables in Postgres, and
 * advances the single-row byte cursor.
 *
 * Invariants:
 * - Gated twice: timing-safe job secret AND ENABLE_ANALYTICS_INGEST flag.
 * - Distributed locking via Valkey prevents overlapping cron executions.
 * - Inode-aware cursor handles log rotation and truncation safely.
 * - Raw IPs never hit Postgres — only UTC-day salted HMAC hashes.
 *
 * Rotation (PRD §7.2): when the live file's inode no longer matches the
 * stored cursor, the old data hasn't vanished — the nginx-logrotate sidecar
 * renamed it to `${LOG_PATH}.1` before signalling nginx to reopen. We drain
 * that file from the stored offset to its end BEFORE reading anything from
 * the new file, so the last batch written under the old name is never
 * skipped. A rotated file larger than one run's budget is drained across
 * multiple ticks — the cursor stays pinned to the old inode until it's
 * fully consumed, and only then flips to the new file at offset 0.
 */
export async function POST(req: NextRequest) {
  const unauthorized = requireJobAuth(req);
  if (unauthorized) return unauthorized;

  if (!flags.analyticsIngest) {
    return jobDisabled("Analytics ingestion is disabled (ENABLE_ANALYTICS_INGEST is off).");
  }

  // Fail closed (AGENTS.md §6): a missing salt must never fall back to a
  // literal committed to the repo. That literal is public, so every visitor
  // hash it produced would be trivially reversible over the IPv4 space —
  // the exact privacy guarantee this table exists to provide.
  const saltSecret = process.env.ANALYTICS_SALT_SECRET;
  if (!saltSecret || saltSecret.trim() === "") {
    await reportError({
      code: "RC_JOB_FAILED",
      message: "Analytics ingest job failed: ANALYTICS_SALT_SECRET is unset.",
      operation: "job.analyticsIngest",
    });
    return NextResponse.json(
      { ok: false, error: "ANALYTICS_SALT_SECRET is unset; refusing to hash visitor IPs with a fallback salt." },
      { status: 500 },
    );
  }

  const redis = redisClient();
  let lockAcquired = false;

  if (redis) {
    try {
      const acquired = await redis.set(LOCK_KEY, "1", "EX", LOCK_TTL_SECONDS, "NX");
      if (!acquired) {
        return NextResponse.json({
          ok: true,
          locked: true,
          message: "Another analytics ingest job is currently running.",
        });
      }
      lockAcquired = true;
    } catch {
      // Valkey blip: degrade gracefully, proceed with DB-level cursor tracking
    }
  }

  try {
    if (!fs.existsSync(LOG_PATH)) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: `Log file not found at ${LOG_PATH}`,
      });
    }

    const stat = fs.statSync(LOG_PATH);
    const currentInode = Number(stat.ino);
    const currentSize = stat.size;

    const cursor = await readIngestCursor();

    // ── Rotation drain: the inode changed under us ──────────────────────
    // Finish the old file (renamed to `.1` by the sidecar) before touching
    // the new one, so the tail written just before rotation isn't skipped.
    if (cursor && cursor.fileInode !== currentInode) {
      let rotatedStat: fs.Stats | null = null;
      try {
        rotatedStat = fs.statSync(ROTATED_LOG_PATH);
      } catch {
        rotatedStat = null;
      }

      const rotatedMatchesCursor =
        rotatedStat && Number(rotatedStat.ino) === cursor.fileInode;

      if (rotatedMatchesCursor && rotatedStat) {
        const chunk = readChunk(
          ROTATED_LOG_PATH,
          cursor.byteOffset,
          rotatedStat.size,
          /* forceDrainAtEof */ true,
        );
        if (chunk && chunk.bytesConsumed > 0) {
          const batch = processLogBatch(chunk.lines, saltSecret);
          await persistBatchResult(batch);
          const nextOffsetInRotated = cursor.byteOffset + chunk.bytesConsumed;
          // Still bytes left in the rotated file beyond this run's budget —
          // stay pinned to the old inode; the new file waits for next tick.
          if (nextOffsetInRotated < rotatedStat.size) {
            await saveIngestCursor(cursor.fileInode, nextOffsetInRotated);
            return NextResponse.json({
              ok: true,
              rotationDrain: true,
              complete: false,
              linesProcessed: batch.linesProcessed,
              linesSkipped: batch.linesSkipped,
            });
          }
        }
        // Rotated file fully drained (or had nothing left) — flip the
        // cursor to the new file. Its own content is read on the next tick;
        // returning here keeps each run's failure mode single-purpose.
        await saveIngestCursor(currentInode, 0);
        return NextResponse.json({ ok: true, rotationDrain: true, complete: true });
      }

      // Inode changed but there's no matching `.1` to recover from — either
      // rotation happened more than once between ticks, or something
      // deleted it. We cannot recover the gap; say so instead of pretending
      // this was a clean first run (§4: never launder unknown into silence).
      if (cursor) {
        await reportError({
          code: "RC_JOB_FAILED",
          message: `Analytics ingest: log rotated but ${ROTATED_LOG_PATH} is missing or doesn't match the tracked cursor — a gap in coverage is being accepted.`,
          operation: "job.analyticsIngest",
          severity: "WARN",
        });
      }
      await saveIngestCursor(currentInode, 0);
      return NextResponse.json({ ok: true, rotationGapAccepted: true });
    }

    // ── Normal path: same file as last run ──────────────────────────────
    let startOffset = cursor ? cursor.byteOffset : 0;
    if (cursor && currentSize < cursor.byteOffset) {
      startOffset = 0; // truncated in place (e.g. a copytruncate-style rotation)
    }

    if (startOffset >= currentSize) {
      return NextResponse.json({
        ok: true,
        linesProcessed: 0,
        bytesRead: 0,
        currentOffset: startOffset,
      });
    }

    const chunk = readChunk(LOG_PATH, startOffset, currentSize, false);
    if (!chunk || chunk.bytesConsumed === 0) {
      return NextResponse.json({
        ok: true,
        linesProcessed: 0,
        bytesRead: 0,
        partial: true,
        message: "No complete newline found in chunk",
      });
    }

    const batch = processLogBatch(chunk.lines, saltSecret);
    await persistBatchResult(batch);

    const nextOffset = startOffset + chunk.bytesConsumed;
    await saveIngestCursor(currentInode, nextOffset);

    return NextResponse.json({
      ok: true,
      linesProcessed: batch.linesProcessed,
      linesSkipped: batch.linesSkipped,
      bytesIngested: chunk.bytesConsumed,
      cursor: {
        fileInode: currentInode,
        byteOffset: nextOffset,
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await reportError({
      code: "RC_JOB_FAILED",
      message: `Analytics ingest job failed: ${errorMsg}`,
      operation: "job.analyticsIngest",
      error: err,
    });

    return NextResponse.json(
      { ok: false, error: errorMsg },
      { status: 500 },
    );
  } finally {
    if (redis && lockAcquired) {
      try {
        await redis.del(LOCK_KEY);
      } catch {
        /* ignore lock release error */
      }
    }
  }
}
