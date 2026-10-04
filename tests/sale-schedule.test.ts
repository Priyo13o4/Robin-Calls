import test from "node:test";
import assert from "node:assert/strict";
import { readSaleSchedule } from "@/lib/sale/schedule";
import { clockPhase, remaining } from "@/lib/sale/schedule-clock";

const deps = (configured: boolean, read: () => Promise<Record<string, string>>) => ({ configured: () => configured, read });
const never = async (): Promise<Record<string, string>> => { throw new Error("must not read"); };

test("no DB and a failed read are unavailable, never TBA", async () => {
  assert.deepEqual(await readSaleSchedule(deps(false, never)), { kind: "unavailable" });
  assert.deepEqual(await readSaleSchedule(deps(true, async () => { throw new Error("down"); })), { kind: "unavailable" });
});

test("reads the two admin keys; a missing or garbage value is unset", async () => {
  const r = await readSaleSchedule(deps(true, async () => ({ token_sale_starts_at: "2026-10-10T16:00:00.000Z", token_sale_ends_at: "soon" })));
  assert.deepEqual(r, { kind: "read", startsAt: Date.parse("2026-10-10T16:00:00.000Z"), endsAt: null });
});

test("phase walks tba, starts in, ends in, ended", () => {
  const s = { kind: "read", startsAt: 1_000, endsAt: 5_000 } as const;
  assert.deepEqual(clockPhase({ kind: "unavailable" }, 0), { kind: "unknown" });
  assert.deepEqual(clockPhase({ kind: "read", startsAt: null, endsAt: 5_000 }, 0), { kind: "tba" });
  assert.deepEqual(clockPhase(s, 999), { kind: "starts", at: 1_000 });
  assert.deepEqual(clockPhase(s, 1_000), { kind: "ends", at: 5_000 });
  assert.deepEqual(clockPhase(s, 5_000), { kind: "ended" });
  assert.deepEqual(clockPhase({ kind: "read", startsAt: 1_000, endsAt: null }, 2_000), { kind: "live" });
});

test("remaining rounds minutes up and splits days, hours, minutes", () => {
  const day = 86_400_000;
  assert.deepEqual(remaining(2 * day + 3 * 3_600_000 + 4 * 60_000 + 1, 0), { days: 2, hours: 3, minutes: 5 });
  assert.deepEqual(remaining(59_000, 0), { days: 0, hours: 0, minutes: 1 });
  assert.deepEqual(remaining(0, 10), { days: 0, hours: 0, minutes: 0 });
});

test("a read contract state outranks the announced window", async () => {
  const { reconcilePhase } = await import("@/lib/sale/schedule-clock");
  const now = Date.UTC(2026, 9, 1);
  const future = { kind: "read" as const, startsAt: now + 86_400_000, endsAt: now + 3 * 86_400_000 };
  assert.deepEqual(reconcilePhase(future, now), { kind: "starts", at: future.startsAt });
  // Owner started early: count down to the close, not to an opening that already happened.
  assert.deepEqual(reconcilePhase(future, now, "live"), { kind: "ends", at: future.endsAt });
  assert.deepEqual(reconcilePhase({ kind: "read", startsAt: null, endsAt: null }, now, "live"), { kind: "live" });
  assert.deepEqual(reconcilePhase(future, now, "closed"), { kind: "ended" });
  assert.deepEqual(reconcilePhase(future, now, "cancelled"), { kind: "ended" });
  // An unread schedule with no contract word stays unknown, never TBA.
  assert.deepEqual(reconcilePhase({ kind: "unavailable" }, now), { kind: "unknown" });
});

test("sale-page chip reads the same schedule as the clock", async () => {
  const { scheduleChip } = await import("@/lib/sale/schedule-clock");
  const now = Date.UTC(2026, 9, 1);
  assert.equal(scheduleChip({ kind: "unavailable" }, now), "SALE DATE —");
  assert.equal(scheduleChip({ kind: "read", startsAt: null, endsAt: null }, now), "SALE DATE TBA");
  assert.equal(scheduleChip({ kind: "read", startsAt: Date.UTC(2026, 9, 5, 14), endsAt: null }, now), "OPENS OCT 5");
  assert.equal(scheduleChip({ kind: "read", startsAt: now - 1, endsAt: null }, now), "OPENING SOON");
});
