import test from "node:test";
import assert from "node:assert/strict";
import { MemoryScanCoordinator } from "../lib/scan-control/memory-coordinator";

/**
 * Group R M17 — the background/cron admission primitive. This mirrors
 * `tests/scan-control.test.ts`'s convention: the Redis coordinator runs the
 * same admission policy as one Lua script (ADMIT_BACKGROUND_SCRIPT), so the
 * in-process coordinator is the testable stand-in for that policy.
 *
 * Primitive only (per the Group R scope boundary) — nothing here asserts
 * that any `lib/tracker/*` or `app/api/jobs/*` caller uses this yet; that
 * consumer-side wiring is a separate, already-in-progress track.
 */

function withEnv(vars: Record<string, string>, run: () => Promise<void>) {
  return async () => {
    const saved = new Map<string, string | undefined>();
    for (const [k, v] of Object.entries(vars)) {
      saved.set(k, process.env[k]);
      process.env[k] = v;
    }
    try {
      await run();
    } finally {
      for (const [k, v] of saved) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };
}

test(
  "background admission succeeds under the configured ceiling",
  withEnv({ SCAN_BACKGROUND_MAX_CONCURRENT: "2" }, async () => {
    const c = new MemoryScanCoordinator();
    const now = Date.now();
    const first = await c.admitBackgroundWork("curve-poll", now);
    assert.equal(first.ok, true);
    const second = await c.admitBackgroundWork("tracker-poll", now);
    assert.equal(second.ok, true, "a second job is admitted while under the ceiling of 2");
  })
);

test(
  "background admission denies at the ceiling, with a retry hint matching the Admission denial shape",
  withEnv({ SCAN_BACKGROUND_MAX_CONCURRENT: "1" }, async () => {
    const c = new MemoryScanCoordinator();
    const now = Date.now();
    assert.equal((await c.admitBackgroundWork("curve-poll", now)).ok, true);

    const denied = await c.admitBackgroundWork("tracker-poll", now);
    assert.equal(denied.ok, false);
    if (!denied.ok) {
      assert.equal(denied.scope, "background");
      assert.equal(denied.limit, 1);
      assert.equal(denied.remaining, 0);
      assert.ok(denied.retryAfterSeconds >= 1, "denial carries a positive retry hint");
    }
  })
);

test(
  "releasing a background slot frees it for the next admission",
  withEnv({ SCAN_BACKGROUND_MAX_CONCURRENT: "1" }, async () => {
    const c = new MemoryScanCoordinator();
    const now = Date.now();
    assert.equal((await c.admitBackgroundWork("curve-poll", now)).ok, true);
    assert.equal((await c.admitBackgroundWork("tracker-poll", now)).ok, false);

    await c.releaseBackgroundWork();

    assert.equal(
      (await c.admitBackgroundWork("tracker-poll", now)).ok,
      true,
      "slot freed by release is admitted"
    );
  })
);

test(
  "background reservation and interactive global concurrency are tracked independently — exhausting one can never deny the other",
  withEnv(
    { SCAN_BACKGROUND_MAX_CONCURRENT: "1", SCAN_GLOBAL_MAX_CONCURRENT: "1" },
    async () => {
      const c = new MemoryScanCoordinator();
      const now = Date.now();

      // Exhaust the background budget entirely.
      assert.equal((await c.admitBackgroundWork("curve-poll", now)).ok, true);
      const backgroundDenied = await c.admitBackgroundWork("tracker-poll", now);
      assert.equal(backgroundDenied.ok, false);

      // An interactive fresh-pipeline admission must be completely unaffected —
      // it is still at zero active pipelines, so it must succeed.
      const interactive = await c.admitFreshPipeline("ip-a", now);
      assert.equal(
        interactive.ok,
        true,
        "background exhaustion must not consume or deny the interactive globalActive slot"
      );
      await c.releasePipelineSlot();

      // Now do the reverse: exhaust the interactive global concurrency slot,
      // and confirm background admission is still governed only by its own
      // (already-exhausted, still-exhausted) counter — i.e. unaffected by
      // interactive state either way.
      assert.equal((await c.admitFreshPipeline("ip-b", now)).ok, true);
      const interactiveDenied = await c.admitFreshPipeline("ip-c", now);
      assert.equal(interactiveDenied.ok, false);
      assert.equal(interactiveDenied.ok, false);
      if (!interactiveDenied.ok) assert.equal(interactiveDenied.scope, "global");

      // Release the background slot from earlier — this must succeed and be
      // governed purely by the background counter, regardless of the
      // interactive global slot currently being fully consumed above.
      await c.releaseBackgroundWork();
      const backgroundReadmitted = await c.admitBackgroundWork("tracker-poll", now);
      assert.equal(
        backgroundReadmitted.ok,
        true,
        "background readmission unaffected by interactive global exhaustion"
      );
    }
  )
);

test(
  "background admission scope never appears from admitFreshPipeline, and global scope never appears from admitBackgroundWork",
  withEnv(
    { SCAN_BACKGROUND_MAX_CONCURRENT: "1", SCAN_GLOBAL_MAX_CONCURRENT: "1" },
    async () => {
      const c = new MemoryScanCoordinator();
      const now = Date.now();

      await c.admitBackgroundWork("curve-poll", now);
      const bgDenied = await c.admitBackgroundWork("tracker-poll", now);
      assert.equal(bgDenied.ok, false);
      if (!bgDenied.ok) assert.equal(bgDenied.scope, "background");

      await c.admitFreshPipeline("ip-a", now);
      const globalDenied = await c.admitFreshPipeline("ip-b", now);
      assert.equal(globalDenied.ok, false);
      if (!globalDenied.ok) assert.equal(globalDenied.scope, "global");
    }
  )
);
