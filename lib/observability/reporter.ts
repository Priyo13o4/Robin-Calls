import { createHash } from "crypto";
import { errorCodeSpec, type ErrorCategory, type ErrorCode, type ErrorCodeSpec, type ErrorSeverity } from "./codes";
import { capJsonBytes, redactDetails, redactStack, redactString } from "./redact";
import { currentScanContext } from "./context";

/**
 * Central server-side error reporter (PRD §20.2).
 *
 * One funnel for every application error that affects correctness,
 * completeness, persistence, auth, administration, or upstream access.
 * Invariants:
 *   - NEVER throws and never fails the original request.
 *   - Redacts before persisting; detail payloads are byte-capped.
 *   - Expected domain outcomes (no pool, deterministic revert) do NOT come
 *     through here — they belong in scan evidence and scan_runs counters.
 *   - Same-fingerprint bursts (a circuit tripping open, e.g.) collapse to one
 *     row per dedup window instead of one row per failed request — see
 *     "recurrence suppression" below. This is amplification control, not a
 *     metrics counter — the count of raw events stays intact.
 */

const DETAIL_MAX_BYTES = envInt("APP_ERROR_DETAIL_MAX_BYTES", 16_384);

function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function loggingEnabled(): boolean {
  return process.env.APP_ERROR_LOGGING_ENABLED !== "false";
}

// ── recurrence suppression ──────────────────────────────────────
//
// A provider circuit opening once can fire the same RC_RPC_NO_HEALTHY_PROVIDER
// on every in-flight request for minutes — 426 rows in 25 minutes in the
// incident that prompted this. Collapse repeats of the same fingerprint
// (narrowed by providerId when present, since two providers failing
// independently are two problems) to one real insert per window; the rest
// are counted in-memory and folded into the next window's row so the signal
// isn't lost, just de-amplified.

const DEDUP_WINDOW_SECONDS = envInt("APP_ERROR_DEDUP_WINDOW_SECONDS", 60);
const DEDUP_WINDOW_MS = DEDUP_WINDOW_SECONDS * 1_000;

// Read/write happens synchronously with no `await` in between (see call site),
// so there's no interleaving hazard despite this being shared mutable state.
interface DedupEntry {
  windowStart: number;
  suppressedCount: number;
  lastSeenAt: number;
}

let dedupState = new Map<string, DedupEntry>();

// Belt-and-suspenders cap: the live key space (code x route x operation x
// provider) is small and self-pruning below, but a runaway cardinality
// source should never turn this into a real leak.
const DEDUP_MAX_ENTRIES = 500;

function dedupKey(fingerprint: string, providerId?: string): string {
  return providerId ? `${fingerprint}|${providerId}` : fingerprint;
}

function pruneDedupState(now: number): void {
  if (dedupState.size > DEDUP_MAX_ENTRIES) {
    dedupState.clear();
    return;
  }
  for (const [key, entry] of dedupState) {
    if (now - entry.lastSeenAt > DEDUP_WINDOW_MS * 5) dedupState.delete(key);
  }
}

interface DedupDecision {
  shouldInsert: boolean;
  /** Set only when this insert is a window rollover following suppressed occurrences. */
  suppressedOccurrences?: number;
}

function evaluateDedup(key: string, now: number): DedupDecision {
  pruneDedupState(now);
  const entry = dedupState.get(key);
  if (!entry || now - entry.windowStart >= DEDUP_WINDOW_MS) {
    const priorSuppressed = entry?.suppressedCount ?? 0;
    dedupState.set(key, { windowStart: now, suppressedCount: 0, lastSeenAt: now });
    return priorSuppressed > 0
      ? { shouldInsert: true, suppressedOccurrences: priorSuppressed }
      : { shouldInsert: true };
  }
  entry.suppressedCount += 1;
  entry.lastSeenAt = now;
  return { shouldInsert: false };
}

function buildDetails(
  details: Record<string, unknown> | undefined,
  dedup: DedupDecision
): unknown {
  if (dedup.suppressedOccurrences === undefined) {
    return details ? capJsonBytes(redactDetails(details), DETAIL_MAX_BYTES) : null;
  }
  const merged = {
    ...(details ? (redactDetails(details) as Record<string, unknown>) : {}),
    suppressedOccurrences: dedup.suppressedOccurrences,
    windowSeconds: DEDUP_WINDOW_SECONDS,
  };
  return capJsonBytes(merged, DETAIL_MAX_BYTES);
}

/** Test hook: clears in-memory dedup state so tests don't leak windows into each other. */
export function resetErrorDedupForTests(): void {
  dedupState = new Map();
}

export interface ReportErrorInput {
  code: ErrorCode;
  message: string;
  /** Override the registry default for this occurrence. */
  severity?: ErrorSeverity;
  category?: ErrorCategory;
  route?: string;
  /** Logical operation, e.g. "honeypot.deepPass" or "ledger.append". */
  operation?: string;
  /** Original thrown value; the sanitized stack is derived from it. */
  error?: unknown;
  details?: Record<string, unknown>;
  tokenAddress?: string;
  providerId?: string;
  dexAdapter?: string;
  httpStatus?: number;
  requestOutcome?: "completed" | "degraded" | "failed";
}

/**
 * Recurrence identity: same code at the same place is the same problem,
 * regardless of the per-occurrence message noise.
 */
export function errorFingerprint(code: string, route?: string, operation?: string): string {
  return createHash("sha256")
    .update(`${code}|${route ?? ""}|${operation ?? ""}`)
    .digest("hex")
    .slice(0, 16);
}

export interface ReportErrorDeps {
  _mockWrite?: (row: Parameters<typeof writeAppErrorEventRecord>[0]) => Promise<void>;
}

function defaultDeps(): ReportErrorDeps {
  return {};
}


import { writeAppErrorEventRecord } from "../data/observability";

const UNREGISTERED_SPEC: ErrorCodeSpec = { category: "config", severity: "ERROR", retryable: false };

export async function reportError(
  input: ReportErrorInput,
  deps: ReportErrorDeps = defaultDeps()
): Promise<void> {
  // An unregistered code (a cast, or a code added without its codes.ts entry) must not break "never throws".
  const spec = errorCodeSpec(input.code) ?? UNREGISTERED_SPEC;
  const severity = input.severity ?? spec.severity;
  const ctx = currentScanContext();
  const fingerprint = errorFingerprint(input.code, input.route, input.operation);

  const dedup = evaluateDedup(dedupKey(fingerprint, input.providerId), Date.now());
  if (!dedup.shouldInsert) return;

  const row = {
    severity,
    category: input.category ?? spec.category,
    code: input.code,
    message: redactString(input.message).slice(0, 500),
    fingerprint,
    // KNOWN-PROBLEMS F3a. Was `VERCEL_GIT_COMMIT_SHA`, which this project has
    // never set anywhere — so every error row ever written carried `release:
    // null` and no fault could be tied to the build that produced it.
    // `APP_GIT_SHA` is stamped by scripts/deploy-remote.sh from the checkout it
    // just pulled: it identifies the DEPLOY, and equals the image only because
    // the same commit builds `:latest`.
    release: process.env.APP_GIT_SHA ?? null,
    runtime: "node",
    route: input.route ?? null,
    operation: input.operation ?? null,
    requestId: ctx?.requestId ?? null,
    scanId: ctx?.scanId ?? null,
    tokenAddress: input.tokenAddress ?? ctx?.tokenAddress ?? null,
    providerId: input.providerId ?? null,
    dexAdapter: input.dexAdapter ?? null,
    httpStatus: input.httpStatus ?? null,
    retryable: spec.retryable,
    requestOutcome: input.requestOutcome ?? null,
    stack: redactStack(input.error),
    details: buildDetails(input.details, dedup),
  };

  try {
    if (!loggingEnabled()) throw new Error("logging disabled");
    if (deps._mockWrite) {
      await deps._mockWrite(row);
    } else {
      await writeAppErrorEventRecord(row);
    }
  } catch {
    console.error(`[${row.code}] ${row.severity} ${row.route ?? ""} ${row.message}`, {
      fingerprint: row.fingerprint,
      scanId: row.scanId,
      operation: row.operation,
    });
  }
}
