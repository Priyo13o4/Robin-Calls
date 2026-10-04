import test from "node:test";
import assert from "node:assert/strict";
import { createScanContext, runWithScanContext } from "../lib/observability/context";
import { explorerFetch, ExplorerFault } from "../lib/explorer/http";

/**
 * Explorer request dedupe (explorer plan §1).
 *
 * A scan reads the same explorer resource from several independent checks. On
 * the PRO gateway that is ~3.5s a call, and with only 3 concurrency slots a
 * duplicate also evicts a different call from the queue, so the waste
 * compounds.
 *
 * The dangerous half of this is what must NOT be reused: a fault replayed as an
 * answer is how a transient outage becomes a confident wrong verdict
 * (CLAUDE.md §4). These assert both directions.
 */

const BASE = "https://explorer.invalid/api/v2";

/** Swap global fetch for a counting stub; returns a restore function. */
function stubFetch(handler: (url: string, n: number) => Promise<Response> | Response) {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls += 1;
    return handler(String(input), calls);
  }) as typeof fetch;
  return {
    restore: () => {
      globalThis.fetch = original;
    },
    count: () => calls,
  };
}

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

test("two concurrent identical reads collapse to ONE network call", async () => {
  const ctx = createScanContext();
  const f = stubFetch(async () => {
    await new Promise((r) => setTimeout(r, 20));
    return ok({ hash: "0xabc" });
  });
  try {
    const [a, b, c] = await runWithScanContext(ctx, () =>
      Promise.all([
        explorerFetch<{ hash: string }>("blockscout", BASE, "/addresses/0xaaa"),
        explorerFetch<{ hash: string }>("blockscout", BASE, "/addresses/0xaaa"),
        explorerFetch<{ hash: string }>("blockscout", BASE, "/addresses/0xaaa"),
      ]),
    );
    assert.equal(f.count(), 1, "each concurrent caller made its own request");
    assert.deepEqual(a, { hash: "0xabc" });
    assert.deepEqual(b, a);
    assert.deepEqual(c, a);
    assert.equal(ctx.upstream.explorerCalls, 1);
    assert.equal(ctx.upstream.explorerDeduped, 2);
  } finally {
    f.restore();
  }
});

test("a SEQUENTIAL repeat within one scan is served from the memo", async () => {
  // The in-flight join cannot help here — the first request has already
  // settled. This is the case the per-scan memo exists for.
  const ctx = createScanContext();
  const f = stubFetch(async () => ok({ hash: "0xdef" }));
  try {
    await runWithScanContext(ctx, async () => {
      const first = await explorerFetch<{ hash: string }>("blockscout", BASE, "/addresses/0xbbb");
      const second = await explorerFetch<{ hash: string }>("blockscout", BASE, "/addresses/0xbbb");
      assert.deepEqual(second, first);
    });
    assert.equal(f.count(), 1, "the sequential repeat hit the network again");
    assert.equal(ctx.upstream.explorerDeduped, 1);
  } finally {
    f.restore();
  }
});

test("different paths are never conflated", async () => {
  const ctx = createScanContext();
  const seen: string[] = [];
  const f = stubFetch(async (url) => {
    seen.push(url);
    return ok({ url });
  });
  try {
    await runWithScanContext(ctx, async () => {
      await explorerFetch("blockscout", BASE, "/addresses/0xaaa");
      await explorerFetch("blockscout", BASE, "/addresses/0xbbb");
      await explorerFetch("blockscout", BASE, "/tokens/0xaaa/holders");
    });
    assert.equal(f.count(), 3);
    assert.equal(new Set(seen).size, 3);
    assert.equal(ctx.upstream.explorerDeduped, 0);
  } finally {
    f.restore();
  }
});

test("a scoring read and a shadow-audit read of the same path do NOT satisfy each other", async () => {
  // They are classified and reported separately (explorer: vs explorer-shadow:),
  // so sharing one response would corrupt both sides' provider states.
  const ctx = createScanContext();
  const f = stubFetch(async () => ok({ ok: true }));
  try {
    await runWithScanContext(ctx, async () => {
      await explorerFetch("blockscout", BASE, "/smart-contracts/0xaaa");
      await explorerFetch("blockscout", BASE, "/smart-contracts/0xaaa", { domain: "shadow-audit" });
    });
    assert.equal(f.count(), 2, "the shadow read was answered by the scoring read");
  } finally {
    f.restore();
  }
});

test("a FAULT is never memoized — the next read retries instead of replaying it", async () => {
  // The core §4 rule. If a transient 500 were cached, every later check in the
  // scan would inherit "unavailable" as though it were an answer.
  const ctx = createScanContext();
  // A 5xx is retried (TRANSIENT_ATTEMPTS=3, real 2000ms gaps — L59) before it
  // becomes a fault, so the whole first read has to fail on EVERY attempt, not
  // just its first, to produce the terminal ExplorerFault this test is about.
  let failing = true;
  const f = stubFetch(async () =>
    failing ? new Response("boom", { status: 500 }) : ok({ recovered: true }),
  );
  try {
    await runWithScanContext(ctx, async () => {
      await assert.rejects(
        () => explorerFetch("blockscout", BASE, "/addresses/0xccc"),
        (e: unknown) => e instanceof ExplorerFault,
      );
      failing = false;
      const second = await explorerFetch<{ recovered: boolean }>("blockscout", BASE, "/addresses/0xccc");
      assert.deepEqual(second, { recovered: true }, "a fault was replayed as an answer");
    });
    assert.equal(f.count(), 4, "expected 3 failed attempts + 1 clean retry");
    assert.equal(ctx.upstream.explorerDeduped, 0, "a fault must not count as a dedupe hit");
  } finally {
    f.restore();
  }
});

test("a 404 IS reused — it is a domain answer, not a fault", async () => {
  const ctx = createScanContext();
  const f = stubFetch(async () => new Response("not found", { status: 404 }));
  try {
    await runWithScanContext(ctx, async () => {
      assert.equal(await explorerFetch("blockscout", BASE, "/addresses/0xddd"), null);
      assert.equal(await explorerFetch("blockscout", BASE, "/addresses/0xddd"), null);
    });
    assert.equal(f.count(), 1, "a known-absent resource was re-fetched");
    assert.equal(ctx.upstream.explorerDeduped, 1);
  } finally {
    f.restore();
  }
});

test("the memo does not leak between scans", async () => {
  // Two scans are two moments. Sharing a response across them would be an
  // unbounded process-global cache wearing a memo's clothes.
  const f = stubFetch(async () => ok({ v: 1 }));
  try {
    const first = createScanContext();
    await runWithScanContext(first, () => explorerFetch("blockscout", BASE, "/addresses/0xeee"));
    const second = createScanContext();
    await runWithScanContext(second, () => explorerFetch("blockscout", BASE, "/addresses/0xeee"));
    assert.equal(f.count(), 2, "the second scan reused the first scan's response");
    assert.equal(second.upstream.explorerDeduped, 0);
  } finally {
    f.restore();
  }
});

test("outside a scan context the dedupe degrades to plain fetching", async () => {
  const f = stubFetch(async () => ok({ v: 2 }));
  try {
    assert.deepEqual(await explorerFetch("blockscout", BASE, "/addresses/0xfff"), { v: 2 });
    assert.deepEqual(await explorerFetch("blockscout", BASE, "/addresses/0xfff"), { v: 2 });
    assert.equal(f.count(), 2, "a background job silently shared a cross-call cache");
  } finally {
    f.restore();
  }
});
