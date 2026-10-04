import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The deploy applies schema, and applies it before it applies code.
 *
 * KNOWN-PROBLEMS G3. These assert the WIRING rather than the logic, which is
 * the lesson of CLAUDE.md §8.10: `primeTrustedLockers()` was correct, tested,
 * and had zero callers, so the test that injected its data could never fail on
 * the fact that nothing called it. A migration runner nobody invokes is that
 * bug again, and it would present exactly as G3 already does — silently.
 */
const root = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const deploy = read("scripts/deploy-remote.sh");
const runner = read("scripts/apply-migrations.sh");

test("the deploy actually invokes the migration runner", () => {
  assert.match(
    deploy,
    /scripts\/apply-migrations\.sh/,
    "scripts/deploy-remote.sh must call the runner — a runner with no caller is G3 with extra steps"
  );
});

test("migrations run before the app container is started", () => {
  const migrateAt = deploy.indexOf("scripts/apply-migrations.sh");
  const appUpAt = deploy.indexOf("dc up -d app");
  assert.ok(migrateAt >= 0 && appUpAt >= 0, "expected both the migrate step and the app rollout");
  assert.ok(
    migrateAt < appUpAt,
    "the migration step must precede `dc up -d app`. An image serving against an older schema is a " +
      "hard error on every column it selects; an additive migration against the older image is a no-op. " +
      "Only one order has an unsafe moment."
  );
});

test("the destructive reset can never be auto-applied", () => {
  // CLAUDE.md §10: "never run 0011_pre_launch_reset.sql against real data."
  // A directory-walking applier is precisely the thing that would.
  assert.match(
    runner,
    /DENY="0011_pre_launch_reset\.sql"/,
    "the runner must refuse 0011 by name"
  );
  assert.match(
    runner,
    /\[ "\$name" = "\$DENY" \]/,
    "the DENY constant must actually be compared against each file — an unread constant is not a guard"
  );
});

test("the baseline names a migration that exists", () => {
  const m = runner.match(/BASELINE="\$\{MIGRATION_BASELINE:-([^}]+)\}"/);
  assert.ok(m, "could not find the baseline default — update this test");
  const files = readdirSync(join(root, "supabase/migrations"));
  assert.ok(
    files.includes(m![1]),
    `the baseline default "${m![1]}" is not a real migration. On a first run everything through it is ` +
      "recorded as applied WITHOUT being executed, so a typo here silently replays history — which is " +
      "how the run would reach the reset file."
  );
});

test("the baseline sits below the migrations known to be unapplied on production", () => {
  // Verified against production 2026-08-07: 0045-0047 present, 0048-0052 not.
  // Baselining any of the latter would mark it applied without running it, and
  // the column the new code selects would never exist.
  const m = runner.match(/BASELINE="\$\{MIGRATION_BASELINE:-([^}]+)\}"/);
  assert.ok(m);
  const prefix = Number(m![1].slice(0, 4));
  assert.ok(
    prefix < 48,
    `baseline ${m![1]} would mark 0048+ as applied without running them; production does not have them`
  );
});

test("every migration is safe to wrap in a transaction", () => {
  // The runner puts each file inside begin/commit so a partial failure leaves
  // nothing behind. CREATE INDEX CONCURRENTLY cannot run in a transaction
  // block, and a file with its own BEGIN/COMMIT would nest. Either would fail
  // the deploy loudly rather than corrupt anything — but it would fail it, so
  // this is here to catch it at review time instead.
  const dir = join(root, "supabase/migrations");
  const offenders: string[] = [];
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(join(dir, name), "utf8")
      .replace(/--[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    if (/\bconcurrently\b/i.test(sql) || /^\s*(begin|commit|rollback)\s*;/im.test(sql)) {
      offenders.push(name);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "these migrations cannot be wrapped in a transaction by scripts/apply-migrations.sh. Either split " +
      "the CONCURRENTLY statement out, or teach the runner to run them unwrapped."
  );
});

test("0052 is held by default, and the hold is releasable from the environment", () => {
  // 0052 must not land until the curve rug-recovery has run: hourly retention
  // drains the expired launch_candidates backlog, and that backlog is the only
  // surviving record of the pool addresses the recovery joins against.
  //
  // Defaulting to held is the whole safety property. If the default were empty,
  // the first deploy carrying this script would apply 0052 with everything else
  // and destroy the recovery input ~26h later — and the person who forgot would
  // have no way to know until they went looking for rows that no longer exist.
  const m = runner.match(/HOLD="\$\{MIGRATION_HOLD(:?-)([^}]*)\}"/);
  assert.ok(m, "could not find the HOLD default — update this test");
  assert.match(
    m![2],
    /0052_launch_retention_hourly\.sql/,
    "0052 must be held by default; forgetting has to be the safe move"
  );
  assert.equal(
    m![1],
    "-",
    'must be ${MIGRATION_HOLD-…}, not ${MIGRATION_HOLD:-…}. With ":-" an explicit empty value falls ' +
      "back to the default, so the hold could never be released without editing this file — the same " +
      "trap docker-compose.yml documents for its own env defaults."
  );
  assert.match(runner, /in_hold "\$name"/, "the hold list must be consulted per file");
});

test("an applied migration that was edited is reported", () => {
  // CLAUDE.md §10: migrations are additive and never edited. If one changes
  // after the fact, whatever it now says is not what this database ran.
  assert.match(
    runner,
    /CHANGED SINCE IT WAS APPLIED/,
    "a checksum mismatch must be surfaced; a recorded checksum nobody compares is decoration"
  );
});
