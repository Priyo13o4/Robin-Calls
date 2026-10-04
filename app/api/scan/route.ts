import { NextRequest, NextResponse } from "next/server";
import { ScanError, scanToken } from "@/lib/scanner/pipeline";
import { normalizeAddress } from "@/lib/scanner/metadata";
import { readTokenRecord } from "@/lib/scanner/record";
import { latestVerdictRowForToken } from "@/lib/data/ledger";
import { isOwnToken } from "@/lib/sale/token";
import type { Verdict } from "@/lib/types";
import { flags } from "@/lib/config/flags";
import {
  createScanContext,
  runWithScanContext,
  type ScanProgressEvent,
} from "@/lib/observability/context";
import { reportError } from "@/lib/observability/reporter";
import { persistScanRun } from "@/lib/observability/scan-run";
import {
  collectUncertainties,
  persistUncertainties,
} from "@/lib/observability/uncertainties";
import {
  clientIpFrom,
  hashClientIp,
  scanControlConfig,
  scanCoordinator,
  CoordinationUnavailableError,
  type CachedScanResult,
  type ScanCoordinator,
} from "@/lib/scan-control";
import {
  buildScanMeta,
  ownTokenScanBody,
  capacityHeaders,
  ledgerFromRow,
  verdictFromRow,
  CAPACITY_COPY,
  type ScanMeta,
} from "@/lib/scan-control/serve";

export const maxDuration = 180; // lock-wait + pipeline must fit the route budget

const ROUTE = "/api/scan";

/** Seconds until the daily receipt/pipeline counters roll over (UTC midnight). */
function secondsUntilUtcMidnight(nowMs = Date.now()): number {
  const now = new Date(nowMs);
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1
  );
  return Math.max(1, Math.ceil((next - nowMs) / 1000));
}

/**
 * Scan orchestration — PRD §7 state machine, steps 1–8 and 13–15.
 * Receipt policy (steps 9–12) stays legacy until Wave C: a completed fresh
 * pipeline still always appends (unless ENABLE_LEDGER_APPEND is off).
 *
 *   validate → cooldown cache → DB pointer → fresh admission (atomic) →
 *   token lock → run | join → cache result → release → scanMeta
 */
export async function POST(req: NextRequest) {
  if (!flags.publicScan) {
    return NextResponse.json(
      { error: "Scanning is temporarily unavailable.", code: "RC_SCAN_DISABLED" },
      { status: 503, headers: { "Retry-After": "300" } }
    );
  }

  let address: unknown;
  try {
    ({ address } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (typeof address !== "string") {
    return NextResponse.json({ error: "address is required." }, { status: 400 });
  }

  const ctx = createScanContext(req.headers.get("x-request-id") ?? undefined);
  const headers = { "X-Request-Id": ctx.requestId };

  // Step 1 — reject malformed input before touching any provider or counter.
  const normalized = normalizeAddress(address);
  if (!normalized) {
    return NextResponse.json(
      { error: "Not a valid contract address.", code: "RC_SCAN_INVALID_ADDRESS" },
      { status: 422, headers }
    );
  }
  ctx.tokenAddress = normalized;

  const cfg = scanControlConfig();
  const coordinator = scanCoordinator();
  const nowMs = Date.now();

  // Steps 4–5 — recent-result read: Upstash first, database pointer on miss.
  const cached = coordinator ? await coordinator.readTokenResult(normalized) : null;
  if (cached?.kind === "result") {
    const ageSeconds = (nowMs - Date.parse(cached.scannedAt)) / 1000;
    if (ageSeconds <= cfg.tokenCooldownSeconds) {
      return serveCached(cached, "cache", cfg.tokenCooldownSeconds, ctx.requestId, headers);
    }
  }
  if (cached?.kind === "failure") {
    return NextResponse.json(
      {
        error: "The last scan attempt for this token just failed. Please retry shortly.",
        code: cached.code,
      },
      { status: 503, headers: { ...headers, "Retry-After": String(cfg.failureCacheSeconds) } }
    );
  }

  if (!cached) {
    const row = await latestVerdictRowForToken(normalized);
    if (row) {
      const ageSeconds = (nowMs - Date.parse(row.created_at)) / 1000;
      if (ageSeconds <= cfg.tokenCooldownSeconds) {
        const record = await readTokenRecord(row.token_address);
        const body = {
          verdict: verdictFromRow(row),
          ledger: ledgerFromRow(row),
          record,
          // DB pointer serves a stored receipt; the trader table is a live-market
          // read that only fresh pipelines produce.
          traders: null,
        };
        const dexProtocols = row.dex_protocols ?? [];
        // Backfill the cache so the next cooldown hit skips the DB read.
        if (coordinator) {
          const remaining = Math.floor(cfg.tokenCooldownSeconds - ageSeconds);
          if (remaining > 5) {
            await coordinator.writeTokenResult(
              normalized,
              {
                kind: "result",
                scannedAt: row.created_at,
                body,
                receiptAction: "appended",
                completeness: "complete",
                dexProtocols,
              },
              Math.min(cfg.resultCacheSeconds, remaining)
            );
          }
        }
        return NextResponse.json(
          {
            ...(isOwnToken(normalized) ? ownTokenScanBody(body) : body),
            scanMeta: buildScanMeta({
              source: "database",
              receiptAction: "appended",
              completeness: "complete",
              dexProtocols,
              scannedAt: row.created_at,
              cooldownSeconds: cfg.tokenCooldownSeconds,
              requestId: ctx.requestId,
            }),
          },
          { headers }
        );
      }
    }
  }

  // Fresh work begins here — both kill switches gate it (§20.6, §10.4).
  if (!flags.freshScan) {
    return NextResponse.json(
      {
        error:
          "Fresh scans are temporarily paused. Existing verdicts and receipts remain available.",
        code: "RC_SCAN_FRESH_PAUSED",
      },
      { status: 503, headers: { ...headers, "Retry-After": "600" } }
    );
  }
  if (!coordinator) {
    return NextResponse.json(
      {
        error:
          "Fresh scans are unavailable until scan coordination is configured. Existing verdicts remain available.",
        code: "RC_SCAN_COORDINATION_UNAVAILABLE",
      },
      { status: 503, headers }
    );
  }

  try {
    // Step 6 — every fresh-pipeline budget, checked and consumed atomically.
    const admission = await coordinator.admitFreshPipeline(
      hashClientIp(clientIpFrom(req.headers)),
      nowMs
    );
    if (!admission.ok) {
      return NextResponse.json(
        { error: CAPACITY_COPY[admission.scope], code: "RC_SCAN_CAPACITY_EXCEEDED" },
        { status: 429, headers: { ...headers, ...capacityHeaders(admission) } }
      );
    }

    // "settled" covers both endings: released right here, or handed to the
    // stream, which then owns the release.
    let slotSettled = false;
    try {
      // Step 7 — one pipeline per token.
      const lock = await coordinator.acquireTokenLock(normalized);
      if (!lock.acquired) {
        // Step 8 — join the in-flight winner instead of scanning twice.
        await coordinator.releasePipelineSlot();
        slotSettled = true;
        return await joinInFlightScan(coordinator, normalized, cfg, ctx.requestId, headers);
      }

      // Step 14 — the token lock and the pipeline slot are handed to the
      // stream, which frees them when the pipeline actually ends. Releasing
      // them here freed both the moment `start()` reached its first await, so
      // joinInFlightScan never found a lock to join and globalMaxConcurrent
      // was inert. `lockTtlSeconds` (config.ts) is sized for the hold this
      // release was cancelling.
      let handedOff = false;
      try {
        const response = runFreshPipeline(
          coordinator,
          normalized,
          ctx,
          cfg,
          headers,
          lock.lockToken
        );
        handedOff = true;
        slotSettled = true;
        return response;
      } finally {
        // Only reachable when runFreshPipeline threw before the stream existed.
        if (!handedOff) await coordinator.releaseTokenLock(normalized, lock.lockToken);
      }
    } finally {
      if (!slotSettled) await coordinator.releasePipelineSlot();
    }
  } catch (err) {
    if (err instanceof CoordinationUnavailableError) {
      // §10.4 — configured but unreachable: fail closed for fresh pipelines.
      await reportError({
        code: "RC_SCAN_COORDINATION_UNAVAILABLE",
        message: "Upstash coordination unreachable — fresh scan refused",
        route: ROUTE,
        operation: "scan.coordination",
        error: err,
        httpStatus: 503,
        requestOutcome: "failed",
      });
      return NextResponse.json(
        {
          error: "Scan coordination is temporarily unreachable. Please retry shortly.",
          code: "RC_SCAN_COORDINATION_UNAVAILABLE",
        },
        { status: 503, headers: { ...headers, "Retry-After": "60" } }
      );
    }
    throw err;
  }
}

/** Cached bodies are untyped JSON; only a body whose verdict names our token is redacted. */
function ownTokenRedacted(body: CachedScanResult["body"]) {
  const verdict = body.verdict as Verdict | undefined;
  return verdict && isOwnToken(verdict.tokenAddress)
    ? ownTokenScanBody(body as typeof body & { verdict: Verdict; ledger: unknown })
    : body;
}

function serveCached(
  cached: CachedScanResult,
  source: ScanMeta["source"],
  cooldownSeconds: number,
  requestId: string,
  headers: Record<string, string>
) {
  return NextResponse.json(
    {
      ...ownTokenRedacted(cached.body),
      scanMeta: buildScanMeta({
        source,
        receiptAction: cached.receiptAction,
        // Defaults guard against an in-flight cache entry written by a prior
        // deploy that predates these fields (entries expire within ~15 min).
        completeness: cached.completeness ?? "complete",
        dexProtocols: cached.dexProtocols ?? [],
        scannedAt: cached.scannedAt,
        cooldownSeconds,
        requestId,
      }),
    },
    { headers }
  );
}

/**
 * Step 8 — poll for the lock winner's published result. On wait expiry:
 * 429 with token scope and a Retry-After derived from the remaining lock TTL,
 * and never a second pipeline (§7 step 8).
 */
async function joinInFlightScan(
  coordinator: ScanCoordinator,
  tokenAddress: string,
  cfg: ReturnType<typeof scanControlConfig>,
  requestId: string,
  headers: Record<string, string>
): Promise<NextResponse> {
  const deadline = Date.now() + cfg.lockWaitSeconds * 1000;
  const POLL_MS = 2_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    const entry = await coordinator.readTokenResult(tokenAddress);
    if (entry?.kind === "result") {
      return serveCached(entry, "cache", cfg.tokenCooldownSeconds, requestId, headers);
    }
    if (entry?.kind === "failure") {
      return NextResponse.json(
        {
          error: "The scan running for this token just failed. Please retry shortly.",
          code: entry.code,
        },
        {
          status: 503,
          headers: { ...headers, "Retry-After": String(cfg.failureCacheSeconds) },
        }
      );
    }
  }

  const remainingTtl = (await coordinator.tokenLockTtlSeconds(tokenAddress)) ?? cfg.lockTtlSeconds;
  return NextResponse.json(
    { error: CAPACITY_COPY.token, code: "RC_SCAN_CAPACITY_EXCEEDED" },
    {
      status: 429,
      headers: {
        ...headers,
        ...capacityHeaders({
          ok: false,
          scope: "token",
          limit: 1,
          remaining: 0,
          retryAfterSeconds: remainingTtl,
        }),
      },
    }
  );
}

/**
 * Steps 9–13 + 15 — run the pipeline, publish the result, answer honestly.
 *
 * Streamed as NDJSON (one `ScanProgressEvent` per line) instead of a single
 * buffered JSON body: the pipeline can take 10-60s, and a client waiting on
 * one `await res.json()` learned nothing until the very end — including
 * when the explorer had already faulted early and every remaining check
 * was work already decided to throw away. Every side effect below (failure
 * cache, reportError, persistScanRun, receipt bookkeeping) is unchanged from
 * the old buffered version; only the terminal `NextResponse.json(status)`
 * calls became a final `"done"`/`"error"` line, since a stream commits to
 * its HTTP status before the outcome is known. The real outcome — success,
 * `RC_EXPLORER_UNAVAILABLE`, capacity-exceeded — lives in that line's
 * `type`/`code`/`httpStatus` fields instead.
 *
 * Runtime Safety Amendment (2026-07-20): a production scan ran 101.0s past
 * the platform's `maxDuration`; a platform can close the response stream and a
 * later `send()` threw `Invalid state: Controller is already closed` into
 * the pipeline, which the UI then misreported as "the chain did not
 * answer." Fixed two ways: (1) the pipeline races `ctx.deadline` — a
 * request-scoped terminal cutoff well inside `maxDuration` — so the client
 * gets an explicit `RC_SCAN_DEADLINE_EXCEEDED` line instead of riding the
 * platform to a forced close; the loser promise keeps running unobserved
 * (Node can't cancel an in-flight `await`) but never reaches a cache write,
 * a second `persistScanRun`, or a `send`, since only the race's winning
 * branch executes that code; (2) `send`/stream-close are idempotent no-ops
 * on a second call or a platform-already-closed controller, so neither a
 * duplicate terminal event nor a client disconnect can throw.
 */
function runFreshPipeline(
  coordinator: ScanCoordinator,
  tokenAddress: string,
  ctx: ReturnType<typeof createScanContext>,
  cfg: ReturnType<typeof scanControlConfig>,
  headers: Record<string, string>,
  lockToken: string
): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let streamClosed = false;
      const send = (event: ScanProgressEvent) => {
        if (streamClosed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The stream is already torn down (client disconnect, proxy
          // timeout) — a lost audience, not a pipeline failure.
          streamClosed = true;
        }
      };
      const closeStream = () => {
        if (streamClosed) return;
        streamClosed = true;
        try {
          controller.close();
        } catch {
          // Already closed by the platform — safe no-op.
        }
      };
      ctx.onEvent = send;

      let deadlineTimer: ReturnType<typeof setTimeout>;
      const deadlineFired = new Promise<{ kind: "deadline" }>((resolve) => {
        deadlineTimer = setTimeout(
          () => resolve({ kind: "deadline" }),
          Math.max(0, ctx.deadline.remainingMs())
        );
      });

      try {
        // §9.2 — the pipeline reserves a daily receipt slot only when it
        // decides to APPEND, and releases it if the append then fails.
        // Refuses once the terminal deadline has passed so a late-finishing
        // pipeline can never newly reserve/append a receipt after the
        // client has already been told the scan is over.
        const receiptBudget = {
          reserve: () => {
            if (ctx.deadline.expired()) return Promise.resolve(false);
            return coordinator.reserveReceiptSlot(Date.now());
          },
          release: () => coordinator.releaseReceiptSlot(Date.now()),
        };
        const pipelineRun = runWithScanContext(ctx, () =>
          scanToken(tokenAddress, { receiptBudget })
        );

        const race = await Promise.race([
          pipelineRun.then((outcome) => ({ kind: "outcome" as const, outcome })),
          deadlineFired,
        ]);
        clearTimeout(deadlineTimer!);

        if (race.kind === "deadline") {
          // The real pipeline is still running unobserved; discard whatever
          // it eventually resolves to instead of awaiting it further — no
          // cache write, no second persistScanRun, no send happens for it.
          pipelineRun.catch(() => undefined);
          await persistScanRun(ctx, { outcome: "failed", errorCode: "RC_SCAN_DEADLINE_EXCEEDED" });
          send({
            type: "error",
            code: "RC_SCAN_DEADLINE_EXCEEDED",
            message: "The scan took too long to finish. Please retry.",
            httpStatus: 504,
          });
          return;
        }

        const outcome = race.outcome;

        // §9.2 — APPEND was required but today's receipt budget is
        // exhausted. The complete verdict is not presented as an official
        // receipt (§18.2 → 429).
        if (outcome.receiptCapacityExceeded) {
          await persistScanRun(ctx, {
            outcome: "complete",
            source: "fresh",
            receiptAction: "none",
            score: outcome.verdict.score,
            tier: outcome.verdict.tier,
            dexProtocols: outcome.dexProtocols,
          });
          send({
            type: "error",
            code: "RC_SCAN_CAPACITY_EXCEEDED",
            message: CAPACITY_COPY["receipt-daily"],
            httpStatus: 429,
          });
          return;
        }

        const staleFallback = outcome.source === "stale-fallback" && outcome.row !== null;

        // §19.1 — a degraded refresh serves the last complete verdict
        // WITHOUT rescoring it. Otherwise show the freshly-computed verdict.
        const shownVerdict = staleFallback ? verdictFromRow(outcome.row!) : outcome.verdict;
        const record = await readTokenRecord(shownVerdict.tokenAddress);
        const body = {
          verdict: shownVerdict,
          ledger: outcome.row ? ledgerFromRow(outcome.row) : null,
          record,
          // v1.9 top-traders table (M18) — relocated off the critical path;
          // the pipeline no longer computes it, the client fetches it
          // separately from GET /api/scan/[address]/traders after this
          // response renders.
          traders: null,
        };

        // §18.3 cache honesty — scannedAt is the shown verdict's read time:
        // `now` for a fresh/reused read, the original receipt time for a
        // stale fallback.
        const scannedAt = staleFallback ? outcome.row!.created_at : new Date().toISOString();

        // Step 13 — publish for cooldown hits and lock-waiters, but only a
        // COMPLETE result (append or reuse). A partial/stale attempt must
        // not pin the cache; the next request should retry fresh.
        if (outcome.completeness === "complete" && outcome.receiptAction !== "none") {
          await coordinator.writeTokenResult(
            tokenAddress,
            {
              kind: "result",
              scannedAt,
              body,
              receiptAction: outcome.receiptAction,
              completeness: "complete",
              dexProtocols: outcome.dexProtocols,
            },
            cfg.resultCacheSeconds
          );
        }

        await persistScanRun(ctx, {
          outcome: outcome.completeness === "partial" ? "partial" : "complete",
          source: outcome.source,
          receiptAction: outcome.receiptAction,
          verdictId: outcome.row?.id ?? null,
          score: shownVerdict.score,
          tier: shownVerdict.tier,
          dexProtocols: outcome.dexProtocols,
          evidenceBytes: Buffer.byteLength(JSON.stringify(shownVerdict), "utf8"),
        });

        // Log every indefinite conclusion for manual review (/admin/review) —
        // only for a freshly computed verdict; a stale fallback re-serves old
        // findings and must not re-bump the review queue.
        if (!staleFallback) {
          await persistUncertainties(
            {
              tokenAddress: outcome.verdict.tokenAddress,
              scanId: ctx.scanId,
              verdictId: outcome.row?.id ?? null,
            },
            collectUncertainties(outcome.verdict),
          );
        }

        send({
          type: "done",
          body: {
            ...(isOwnToken(tokenAddress) ? ownTokenScanBody(body) : body),
            scanMeta: buildScanMeta({
              source: outcome.source,
              receiptAction: outcome.receiptAction,
              completeness: outcome.completeness,
              dexProtocols: outcome.dexProtocols,
              scannedAt,
              cooldownSeconds: cfg.tokenCooldownSeconds,
              requestId: ctx.requestId,
              providerStates: ctx.providerStates,
              degradedAttempt: outcome.degradedAttempt,
              historyIncomplete: outcome.historyIncomplete,
            }),
          },
        });
      } catch (err) {
        if (err instanceof ScanError) {
          if (err.code === "RC_EXPLORER_UNAVAILABLE" || err.code === "RC_RPC_UNAVAILABLE") {
            // Infra outage, not a domain rejection: the pipeline refused to
            // score without the explorer or a fully-answered RPC pool/
            // liquidity-pull read (optimistic-degradation gate, see A1 in
            // docs/KNOWN-PROBLEMS.md). Cache the failure briefly to absorb a
            // stampede; the client should retry, and no verdict — fresh or
            // stale — is minted.
            await coordinator.writeTokenResult(
              tokenAddress,
              { kind: "failure", code: err.code, failedAt: new Date().toISOString() },
              cfg.failureCacheSeconds
            );
            await reportError({
              code: err.code,
              message:
                err.code === "RC_EXPLORER_UNAVAILABLE"
                  ? "scan refused: explorer unavailable (no-verdict gate)"
                  : "scan refused: RPC unavailable (no-verdict gate)",
              route: ROUTE,
              operation: "scan.pipeline",
              httpStatus: 503,
              requestOutcome: "failed",
            });
            await persistScanRun(ctx, { outcome: "failed", errorCode: err.code, terminalCause: err.detail ?? null });
            send({ type: "error", code: err.code, message: err.message, httpStatus: 503 });
          } else {
            // Domain rejection (not-a-contract, pool input): cheap, honest, no cache.
            await persistScanRun(ctx, { outcome: "rejected", errorCode: err.code });
            send({ type: "error", code: err.code, message: err.message, httpStatus: 422 });
          }
        } else {
          // Step 13 (failure half) — suppress a stampede onto a failing token.
          await coordinator.writeTokenResult(
            tokenAddress,
            { kind: "failure", code: "RC_SCAN_PIPELINE_FAILED", failedAt: new Date().toISOString() },
            cfg.failureCacheSeconds
          );
          await reportError({
            code: "RC_SCAN_PIPELINE_FAILED",
            message: "scan pipeline threw an unexpected error",
            route: ROUTE,
            operation: "scan.pipeline",
            error: err,
            httpStatus: 500,
            requestOutcome: "failed",
          });
          await persistScanRun(ctx, { outcome: "failed", errorCode: "RC_SCAN_PIPELINE_FAILED" });
          send({
            type: "error",
            code: "RC_SCAN_PIPELINE_FAILED",
            message: "Scan failed. The chain did not answer. Try again.",
            httpStatus: 500,
          });
        }
      } finally {
        clearTimeout(deadlineTimer!);
        // The pipeline is over — completed, failed, or past its terminal
        // deadline — so this is where the token frees. Released BEFORE the
        // stream closes, so a client that retries the instant it sees the
        // final line cannot race its own lock. Both releases swallow their
        // own faults inside the coordinator and both keys carry a TTL, so
        // neither can throw into the stream nor leak the slot for good.
        await coordinator.releaseTokenLock(tokenAddress, lockToken);
        await coordinator.releasePipelineSlot();
        closeStream();
      }
    },
  });

  return new Response(stream, {
    headers: { ...headers, "Content-Type": "application/x-ndjson" },
  });
}
