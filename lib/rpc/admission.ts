import type { ProviderEndpoint } from "./provider-pool";
import { cuLimiter, resetCuLimiterForTests } from "./cu-limiter";
import {
  providerScheduler,
  rankEligibleProviders,
  resetProviderSchedulerForTests,
} from "./scheduler";

/**
 * Central provider admission gate (§11.2) — the ONE place that decides whether
 * a provider may take a request right now.
 *
 * WHY THIS EXISTS. Three independent throttles guard every outbound RPC:
 * a per-provider circuit breaker, a per-instance `maxConcurrentRequests`
 * ceiling, and CU/RPS token buckets. Until this module they were owned by three
 * different files and composed by hand inside `poolRequest`'s walk loop, which
 * produced two failure modes that were invisible in telemetry:
 *
 *  1. **"Saturated" was inferred, not known.** The loop decided the pool was
 *     merely busy (rather than broken) by testing `lastError === null` — i.e.
 *     "nobody threw, so everyone must have been skipped". That conflates a
 *     concurrency skip, a budget skip, and an empty eligible set, and it is why
 *     a scan could report RC_RPC_NO_HEALTHY_PROVIDER while the upstream
 *     dashboard showed nothing but HTTP 200s. The denial reason is now returned
 *     as data (`AdmissionDenied.reason`) instead of reconstructed from absence.
 *
 *  2. **Ordering was load-bearing but implicit.** `CuLimiter.tryAcquire` SPENDS
 *     tokens as a side effect of being asked, so it must run last — after the
 *     circuit and concurrency checks have already cleared. The old call sites
 *     happened to be in that order; nothing enforced it, and reordering two
 *     lines would have silently leaked budget on providers that were then
 *     skipped. `tryAdmit` fixes the order in one place and documents why.
 *
 * The mechanism classes stay separate and independently testable — a token
 * bucket and an inflight counter are different data structures with different
 * invariants. What is centralized is the DECISION: their composition, the
 * ordering constraint between them, and the transient/terminal classification
 * downstream retry logic depends on.
 *
 * PROCESS-LOCAL, like the state it composes. See `scheduler.ts` for what that
 * does and does not cover across instances; this module changes where the
 * decision is made, not how far it reaches.
 */

// ── circuit breaker (per provider, per process) ──────────────

export type CircuitPhase = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface Circuit {
  phase: CircuitPhase;
  consecutiveFailures: number;
  openedAtMs: number;
  lastProbeAtMs: number;
}

/**
 * The circuit-breaker knobs `poolConfig()` supplies. Declared here rather than
 * imported from provider-pool so the gate depends on a shape, not on the pool's
 * whole config object (which also carries timeouts this module never reads).
 */
export interface CircuitConfig {
  circuitFailureThreshold: number;
  circuitOpenSeconds: number;
  recoveryProbeSeconds: number;
}

export function newCircuit(): Circuit {
  return { phase: "CLOSED", consecutiveFailures: 0, openedAtMs: 0, lastProbeAtMs: 0 };
}

/** May this provider take a request now? HALF_OPEN admits one timed probe. */
export function circuitAllows(c: Circuit, cfg: CircuitConfig, nowMs: number): boolean {
  if (c.phase === "CLOSED") return true;
  const reopenAt = c.openedAtMs + cfg.circuitOpenSeconds * 1000;
  if (nowMs < reopenAt) return false;
  // recovery window reached — permit one probe per recovery interval
  if (nowMs - c.lastProbeAtMs < cfg.recoveryProbeSeconds * 1000) return false;
  c.phase = "HALF_OPEN";
  c.lastProbeAtMs = nowMs;
  return true;
}

export function circuitOnSuccess(c: Circuit): void {
  c.phase = "CLOSED";
  c.consecutiveFailures = 0;
}

export function circuitOnFailure(c: Circuit, cfg: CircuitConfig, nowMs: number): void {
  c.consecutiveFailures += 1;
  if (c.phase === "HALF_OPEN" || c.consecutiveFailures >= cfg.circuitFailureThreshold) {
    c.phase = "OPEN";
    c.openedAtMs = nowMs;
  }
}

// ── admission verdicts ───────────────────────────────────────

/**
 * Why a provider was refused. The distinction that matters to callers is
 * `transient` below, not the specific label — the label exists so telemetry can
 * say WHICH throttle bit, which is exactly what was unobservable before.
 */
export type AdmissionDenial = "circuit-open" | "at-concurrency" | "over-budget";

export interface AdmissionGrant {
  admitted: true;
  /**
   * Releases the concurrency slot this grant reserved. MUST be called in a
   * `finally` — the slot is taken the moment admission is granted, so an
   * un-released grant permanently shrinks the provider's usable concurrency.
   */
  release(): void;
}

export interface AdmissionDenied {
  admitted: false;
  reason: AdmissionDenial;
  /**
   * True when waiting a few milliseconds could change the answer: the provider
   * is healthy and merely busy or momentarily over budget, both of which
   * resolve on their own as calls finish and buckets refill.
   *
   * False for an open circuit, which is a 60-second condition — waiting out a
   * breaker inside a request's retry loop just burns the scan deadline.
   *
   * This flag is the whole reason the gate returns structured data: it replaces
   * `lastError === null` as the pool's saturation signal, so a genuinely broken
   * pool and a merely busy one stop looking identical.
   */
  transient: boolean;
}

export type Admission = AdmissionGrant | AdmissionDenied;

const DENIED_CIRCUIT: AdmissionDenied = {
  admitted: false,
  reason: "circuit-open",
  transient: false,
};
const DENIED_CONCURRENCY: AdmissionDenied = {
  admitted: false,
  reason: "at-concurrency",
  transient: true,
};
const DENIED_BUDGET: AdmissionDenied = {
  admitted: false,
  reason: "over-budget",
  transient: true,
};

// ── the gate ─────────────────────────────────────────────────

export class ProviderGate {
  private readonly circuits = new Map<string, Circuit>();

  /*
   * The scheduler and limiter are read through their process-wide getters on
   * every use rather than captured in the constructor. Capturing would pin this
   * gate to whichever instance existed when it was built, so a test calling
   * `resetProviderSchedulerForTests()` would silently leave the gate holding the
   * old one — the pool and the test would then be looking at two different
   * inflight counters. Both getters are memoized, so this costs a map lookup.
   */
  private get scheduler() {
    return providerScheduler();
  }
  private get limiter() {
    return cuLimiter();
  }

  /** The circuit for `id`, created CLOSED on first sight. */
  circuitFor(id: string): Circuit {
    let c = this.circuits.get(id);
    if (!c) {
      c = newCircuit();
      this.circuits.set(id, c);
    }
    return c;
  }

  phase(id: string): CircuitPhase {
    return this.circuitFor(id).phase;
  }

  inflightCount(id: string): number {
    return this.scheduler.inflightCount(id);
  }

  /**
   * Order providers for `method`: declared preference first, least-inflight
   * breaking ties within a preference tier. Pure ranking — it does not consult
   * admission, because a provider at its ceiling should still keep its place in
   * line rather than be reordered behind a provider the config ranked lower.
   */
  rank<T extends { endpoint: ProviderEndpoint }>(providers: readonly T[], method: string): T[] {
    return rankEligibleProviders(providers, method, this.scheduler);
  }

  /**
   * Decide whether `endpoint` may serve `method` right now, reserving its
   * concurrency slot when the answer is yes.
   *
   * The three checks run in a fixed order that is a correctness constraint, not
   * a style choice: the circuit and concurrency checks are pure predicates, but
   * spending CU/RPS tokens MUTATES the bucket. Budget therefore goes last, so a
   * provider refused by an earlier check never has budget deducted for a call
   * it was not allowed to make. Reversing these would leak budget silently —
   * the buckets would drain against requests that never went out, throttling a
   * healthy provider for traffic it never received.
   */
  tryAdmit(
    endpoint: ProviderEndpoint,
    method: string,
    cfg: CircuitConfig,
    nowMs: number = Date.now(),
  ): Admission {
    if (!circuitAllows(this.circuitFor(endpoint.id), cfg, nowMs)) return DENIED_CIRCUIT;

    const maxConcurrent = endpoint.maxConcurrentRequests;
    if (
      typeof maxConcurrent === "number" &&
      this.scheduler.inflightCount(endpoint.id) >= maxConcurrent
    ) {
      return DENIED_CONCURRENCY;
    }

    if (!this.limiter.tryAcquire(endpoint, method, nowMs)) return DENIED_BUDGET;

    // Reserve the slot as part of admission rather than leaving it to the
    // caller: a check-then-mark gap is a lie about the ceiling the moment two
    // callers interleave, and it is the caller's `finally` that closes it.
    this.scheduler.markInflight(endpoint);
    let released = false;
    return {
      admitted: true,
      release: () => {
        // Idempotent: a double release would under-count inflight and let the
        // provider exceed its ceiling, which is worse than a leaked no-op.
        if (released) return;
        released = true;
        this.scheduler.clearInflight(endpoint);
      },
    };
  }

  /** A provider answered — close its circuit. */
  onSuccess(endpoint: ProviderEndpoint): void {
    circuitOnSuccess(this.circuitFor(endpoint.id));
  }

  /** A transport-class fault — advance the circuit and report its new phase. */
  onFailure(endpoint: ProviderEndpoint, cfg: CircuitConfig, nowMs: number): CircuitPhase {
    const c = this.circuitFor(endpoint.id);
    circuitOnFailure(c, cfg, nowMs);
    return c.phase;
  }
}

let gate: ProviderGate | null = null;

/** Process-wide instance — one admission view per instance (see module doc). */
export function providerGate(): ProviderGate {
  if (!gate) gate = new ProviderGate();
  return gate;
}

/**
 * Test hook: drop ALL admission state — circuits, inflight counts, and budget
 * buckets. Resets the three together because they are one decision surface now;
 * clearing circuits while leaving a drained CU bucket in place would leave the
 * next test throttled for reasons it never set up.
 */
export function resetProviderGateForTests(): void {
  gate = null;
  resetProviderSchedulerForTests();
  resetCuLimiterForTests();
}
