/** Client-safe half of ./schedule: pure clock math, no DB import. */
export type SaleSchedule =
  /** DB missing or unreachable: the clock shows "—", never "TBA" (§4, §8 #9). */
  | { kind: "unavailable" }
  /** Epoch ms; null when the admin has not set that end of the window. */
  | { kind: "read"; startsAt: number | null; endsAt: number | null };

export type ClockPhase =
  | { kind: "unknown" }
  | { kind: "tba" }
  | { kind: "starts"; at: number }
  | { kind: "ends"; at: number }
  /** Started with no end set: live, nothing to count down to. */
  | { kind: "live" }
  | { kind: "ended" };

export function clockPhase(s: SaleSchedule, now: number): ClockPhase {
  if (s.kind === "unavailable") return { kind: "unknown" };
  if (s.startsAt === null) return { kind: "tba" };
  if (now < s.startsAt) return { kind: "starts", at: s.startsAt };
  if (s.endsAt === null) return { kind: "live" };
  return now < s.endsAt ? { kind: "ends", at: s.endsAt } : { kind: "ended" };
}

/** Whole days, hours and minutes left, rounded UP so "0m" only shows at the moment itself. */
export function remaining(at: number, now: number) {
  const mins = Math.max(0, Math.ceil((at - now) / 60_000));
  return { days: Math.floor(mins / 1440), hours: Math.floor((mins % 1440) / 60), minutes: mins % 60 };
}

/** What the sale contract itself says, which outranks the admin's announced window. */
export type ContractPhase = "live" | "closed" | "cancelled";

/**
 * The announced window is display only and the owner can start() or close early,
 * so a read contract state wins. A cancelled sale reports as ended.
 */
export function reconcilePhase(s: SaleSchedule, now: number, contract?: ContractPhase): ClockPhase {
  const phase = clockPhase(s, now);
  if (contract === "closed" || contract === "cancelled") return { kind: "ended" };
  if (contract === "live") {
    if (phase.kind === "ends" || phase.kind === "live") return phase;
    const end = s.kind === "read" ? s.endsAt : null;
    return end !== null && now < end ? { kind: "ends", at: end } : { kind: "live" };
  }
  return phase;
}

const shortUtc = (ms: number) =>
  new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase();

/** Sale-page chip for when the contract has not said anything yet. Same source as the clock. */
export function scheduleChip(s: SaleSchedule, now: number): string {
  const phase = clockPhase(s, now);
  switch (phase.kind) {
    case "unknown": return "SALE DATE —";
    case "tba": return "SALE DATE TBA";
    case "starts": return `OPENS ${shortUtc(phase.at)}`;
    case "ended": return "SALE WINDOW PASSED";
    default: return "OPENING SOON";
  }
}
