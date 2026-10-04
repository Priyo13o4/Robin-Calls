/**
 * The product phase ladder — one definition, read by every surface that shows it.
 *
 * Before this module there were five, and they disagreed: `FEATURE_TOUR` on the
 * landing page, `RoadmapData` behind the 3D city, `LoadingScreen`, `/compare`,
 * and the tokenomics copy each hardcoded their own answer. Two were actively
 * wrong in opposite directions — the roadmap listed the Robin Knight as *soon*
 * while it was already live in production, and both the landing page and the
 * roadmap advertised a bot-swarm detector that has never had a single line of
 * implementation behind it.
 *
 * The rule this module exists to enforce: **a phase entry is a claim about what
 * is shipped, and it must be true.** If a capability has no implementation, it
 * does not get a phase — it gets left off until it does. That is the same call
 * that removed the swarm detector (see `docs/ways-of-work/plan/swarm-detector/PRD.md`
 * D1: don't ship half-features, omit them).
 *
 * ## Why 2a and 2b split where they do
 *
 * 2a ships the meter; 2b ships what you spend it on. That is a dependency, not
 * a preference — hosted inference cannot ship before the entitlement layer
 * without paying model costs with no way to charge for them.
 *
 * ## The token is deliberately not on the ladder
 *
 * Deferred, no date. It previously headlined "Phase 2" in the roadmap and the
 * tokenomics copy, which dated a launch that has no schedule. It stays a stated
 * future intention with no phase attached; give it one when it has one.
 */

export type PhaseId =
  | "record"
  | "robin-knight"
  | "access"
  | "terminal"
  | "multichain";

/**
 * `live` — shipped and in production today.
 * `next` — the phase actually being built next.
 * `planned` — committed direction, not started.
 */
export type PhaseStatus = "live" | "next" | "planned";

export interface Phase {
  id: PhaseId;
  /** The public tag. Never an internal doc number — see `docs/STATUS.md`, which
   *  carries three rival numbering schemes that do not agree with each other. */
  label: string;
  title: string;
  status: PhaseStatus;
  /** One sentence. Used on the roadmap marker and anywhere a phase is explained. */
  summary: string;
}

export const PHASES: Phase[] = [
  {
    id: "record",
    label: "PHASE 1",
    title: "The Record",
    status: "live",
    summary:
      "Contract scanning, hash-chained verdicts anchored on-chain, the Wanted board, the Night Market, the RWA registry and the verified Ecosystem directory.",
  },
  {
    id: "robin-knight",
    label: "PHASE 2 · BETA",
    title: "The Robin Knight",
    status: "live",
    summary:
      "An analyst that reads a verdict back to you and cites the evidence behind every number. It explains the record; it never produces it.",
  },
  {
    id: "access",
    label: "PHASE 2A",
    title: "Machine Access",
    status: "next",
    summary:
      "One wallet-keyed credential over two transports — MCP for agents, REST for backends — with tiers, quotas and metering.",
  },
  {
    id: "terminal",
    label: "PHASE 2B",
    title: "The Terminal",
    status: "planned",
    summary:
      "Hosted models on our own keys, and a routed swap terminal for RWAs and token trading.",
  },
  {
    id: "multichain",
    label: "PHASE 3",
    title: "Beyond One Chain",
    status: "planned",
    summary:
      "The record extended past Robinhood Chain, with every verdict still re-derivable and chain-scoped end to end.",
  },
];

const BY_ID = new Map(PHASES.map((p) => [p.id, p]));

export function phase(id: PhaseId): Phase {
  const found = BY_ID.get(id);
  // Loud rather than silent: a surface tagging a phase that does not exist would
  // otherwise render an empty label and read as a styling bug.
  if (!found) throw new Error(`phases: unknown phase id "${id}"`);
  return found;
}

/** The public tag for a phase, e.g. `PHASE 2 · BETA`. */
export function phaseLabel(id: PhaseId): string {
  return phase(id).label;
}

/**
 * The furthest-along phase that is actually live — what the site should lead
 * with. Derived rather than written down so it cannot fall behind the ladder.
 */
export function currentLivePhase(): Phase {
  const live = PHASES.filter((p) => p.status === "live");
  return live[live.length - 1] ?? PHASES[0];
}
