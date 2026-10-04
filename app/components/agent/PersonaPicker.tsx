"use client";

import { useMemo, useState } from "react";

import type { PersonaBundle, PersonaSummary } from "@/lib/agent/types";
import { InfoTooltip } from "../ui/InfoTooltip";
import { LABEL, MONO } from "./MessageStates";

/**
 * Who you are asking — a segmented control, never a dropdown.
 *
 * The choice changes what the agent *can do*, not how it sounds, so it stays
 * visible at all times. The tool list is a feature and is shown as one: what a
 * persona cannot call, it cannot call, because `Dispatcher.authorize` refuses
 * it before the request reaches our backend. That is enforcement, not a line in
 * a prompt asking the model nicely.
 *
 * Everything load-bearing here comes from `GET /agent/config` — the names, the
 * titles, and the allowlists. Only the one-line description is local copy, and
 * it deliberately does not assert any capability: "can run a fresh scan" is
 * derived from the allowlist itself, so it cannot drift from what the server
 * will actually permit.
 */

const BLURBS: Record<string, string> = {
  interrogator: "Deep-dives into a token's verdict, check deductions, and score changes.",
  historian: "Timeline of past token scans, deployer rap sheets, and funding lineage.",
  rwa_analyst: "Tokenized stock verification, issuer beacons, and vault backing.",
  bodyguard: "Pre-trade risk check: sellability, liquidity age, and critical traps.",
  auditor: "Smart contract audit: owner powers, upgrade keys, mint/pause gates and any other dangerous functions.",
  trade_assistant: "Current token market context, recorded risk evidence, and sourced research into catalysts or impersonation claims.",
};

/**
 * The longer dossier behind each persona's "i", for the moment of actually
 * choosing one — the card's blurb is a label, this is the answer to "which of
 * these five do I want".
 *
 * SUBJECT MATTER ONLY. Not one line here says what a persona can or cannot
 * call: that belongs to `capabilityClause`, which derives it from the
 * allowlist, for the same reason the blurbs don't assert capability either. A
 * hand-written "it cannot run a fresh scan" is true until the day a persona
 * regains the tool, and then it is a lie the server will happily contradict.
 */
const DOSSIERS: Record<string, string> = {
  interrogator:
    "Dissects a token's verdict and scoring history. Explains why specific checks passed or failed, where points were deducted, and how the score changed across scans.",
  historian:
    "Examines the historical record across time. Browses past scans in the ledger feed, uncovers deployer launch history, traces funding lineage, and checks the Wanted Board.",
  rwa_analyst:
    "Specialized verification for tokenized real-world assets (RWAs). Checks official issuer fingerprints, maps shared upgradeable beacons and omnibus vaults, and explains known proxy false positives.",
  bodyguard:
    "The frontline triage before buying or trading. Checks whether the token can be sold, who controls the liquidity pool, active honeypot marks, and whether the verdict is fresh or stale.",
  auditor:
    "Deep static and live analysis of contract permissions. Maps proxies, uncovers privileged capabilities (mint, pause, blacklist, fee change), and verifies whether admin keys are active or renounced.",
  trade_assistant:
    "A focused companion for the Robinhood Chain terminal. Checks current token and pool data by exact contract address, reads RobinCalls' recorded risk evidence, and researches dated public sources for catalysts or impersonation claims. It cites what it finds and separates confirmed details from unresolved claims.",
};

const SCAN_TOOL = "scan_token";

/**
 * The one-line capability note under each persona.
 *
 * This used to be a CAN SCAN / NO FRESH SCAN split, back when the Bodyguard was
 * the one persona that could launch a pipeline. No chat persona can any more —
 * a scan writes to the ledger, so it belongs to /scan — so the interesting
 * thing to say is no longer which persona is the exception but what the whole
 * surface is: read-only.
 *
 * The tool COUNT is not repeated here; the caller already prints it beside
 * this string. Still derived from the allowlist rather than restated by hand,
 * so it cannot claim a capability the server would refuse.
 *
 * `SCAN_TOOL` stays referenced deliberately: if a persona ever regains it, the
 * picker says so out loud rather than quietly presenting a writing surface as
 * a reading one.
 */
function constraintOf(persona: PersonaSummary): string {
  return persona.tools.includes(SCAN_TOOL) ? "WRITES TO THE LEDGER" : "READS ONLY";
}

/**
 * The capability half of the tooltip, read off the allowlist rather than
 * written down — so it cannot claim a power the dispatcher would refuse, or
 * deny one it has quietly been granted.
 */
function capabilityClause(persona: PersonaSummary): string {
  const n = persona.tools.length;
  const tools = `${n} tool${n === 1 ? "" : "s"}`;
  return persona.tools.includes(SCAN_TOOL)
    ? `It is allowed ${tools}, one of which writes to the ledger.`
    : `It is allowed ${tools}, all of which only read the record: nothing it does can move a published verdict.`;
}

function dossierOf(persona: PersonaSummary): string {
  const subject = DOSSIERS[persona.name] ?? "A reader of the record.";
  return `${subject} ${capabilityClause(persona)}`;
}

export function PersonaPicker({
  personas,
  active,
  onPick,
  compact = false,
  bundle,
}: {
  personas: PersonaSummary[];
  active: string;
  onPick(name: string): void;
  compact?: boolean;
  /**
   * The active persona's bundle, when it has loaded.
   *
   * Only used to caption the tool list. The descriptions come from
   * `GET /agent/persona/{name}`, which serves `tools.toml` verbatim — the same
   * strings the MODEL is given as its documentation. That is deliberate and it
   * is the whole reason this is not a local copy table: a hand-written UI
   * caption is a second description of a tool that can quietly stop matching
   * what the tool does, and the model's own docs are the one version that
   * cannot, because changing them changes behaviour.
   */
  bundle?: PersonaBundle | null;
}) {
  const [expanded, setExpanded] = useState(false);
  /**
   * In the docked rail and the phone sheet the grid is collapsed to the active
   * persona until asked for.
   *
   * At four personas the strip was affordable. At five it is three rows of
   * cards above a conversation that has, at that point, nothing in it — the
   * chooser outweighed the thing being chosen for. Collapsed, the current
   * persona and its constraint stay visible (which is the part that has to be,
   * since it decides what the agent can do); the alternatives are one tap away.
   *
   * Never collapsed on the standalone page, where the strip is the page's own
   * introduction to what the four — now five — surfaces are.
   */
  const [picking, setPicking] = useState(false);

  const allTools = useMemo(() => {
    const union = new Set<string>();
    for (const persona of personas) persona.tools.forEach((t) => union.add(t));
    return [...union].sort();
  }, [personas]);

  const current = personas.find((p) => p.name === active);
  const withheld = current ? allTools.filter((t) => !current.tools.includes(t)) : [];
  const showGrid = !compact || picking;

  /** name -> the model-facing description, once the bundle has arrived. */
  const describe = useMemo(() => {
    const map = new Map<string, string>();
    for (const tool of bundle?.tools ?? []) map.set(tool.name, tool.description);
    return map;
  }, [bundle]);

  if (personas.length === 0) return null;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className={`${LABEL} text-[#b4b4b4]`}>PERSONA</span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={`${LABEL} text-[#b4b4b4] hover:text-[#ccff00]`}
        >
          {expanded ? "HIDE TOOLS" : `${current?.tools.length ?? 0} TOOLS ALLOWED`}
        </button>
      </div>

      {compact && !picking && current && (
        // Collapsed, this row IS the persona — on a phone it is the only place
        // one is shown, so the "i" matters more here than on the grid.
        <div className="flex items-center gap-2 border border-[#ccff00] bg-[#141414] pr-2.5">
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="flex min-w-0 flex-1 items-center justify-between gap-2 px-2.5 py-2 text-left"
          >
            <span className="min-w-0">
              <span className={`${LABEL} block truncate text-[#ededea]`}>
                {current.title.replace(/^The /, "").toUpperCase()}
              </span>
              <span className={`${MONO} mt-1 block text-[9px] text-[#8a8a8a]`}>
                {current.tools.length} TOOLS · {constraintOf(current)}
              </span>
            </span>
            <span className={`${LABEL} flex-none text-[#b4b4b4]`}>CHANGE ▾</span>
          </button>
          <span className="flex-none">
            <InfoTooltip
              text={dossierOf(current)}
              label={current.title.replace(/^The /, "")}
              align="right"
            />
          </span>
        </div>
      )}

      {showGrid && (
        <div
          className={
            compact
              ? "grid grid-cols-2 gap-1.5"
              : // A cell grid, not a single row: at five personas a fixed
                // `grid-cols-4` wrapped, and the "border-r on all but the last"
                // trick drew its separators in the wrong places the moment it
                // did. Borders belong to the cells; the container supplies the
                // top and left edge so the outline stays closed at any count.
                "grid grid-cols-2 border-l-2 border-t-2 border-[#2a2a2a] bg-[#141414] sm:grid-cols-3 xl:grid-cols-5"
          }
        >
          {personas.map((persona) => {
            const isActive = persona.name === active;
            return (
              /*
                The "i" is a SIBLING of the card, not a child. InfoTooltip
                renders a real <button>, and the card is itself a button —
                nesting them is invalid HTML and the inner click never reaches
                the picker. So the cell owns the positioning and holds both.
              */
              <div key={persona.name} className="relative flex">
                <button
                  type="button"
                  onClick={() => {
                    onPick(persona.name);
                    setPicking(false);
                  }}
                  aria-pressed={isActive}
                  className={
                    compact
                      ? `w-full border bg-[#141414] px-2.5 py-2.5 text-left ${
                          isActive ? "border-[#ccff00]" : "border-[#2a2a2a] hover:border-[#3d3d3d]"
                        }`
                      : // `flex flex-col` + `mt-auto` on the meta line: the blurbs
                        // wrap to different heights, and without this the tool
                        // counts sit at different baselines across the strip.
                        "flex w-full flex-col border-b-2 border-r-2 border-[#2a2a2a] px-4 py-3.5 text-left hover:bg-[#181818]"
                  }
                >
                  {isActive && !compact && (
                    <span className="absolute inset-x-0 top-0 block h-[3px] bg-[#ccff00]" />
                  )}
                  <span className={`${LABEL} block ${compact ? "pr-5" : ""} text-[#ededea]`}>
                    {persona.title.replace(/^The /, "").toUpperCase()}
                  </span>
                  {!compact && (
                    <span className="mt-1.5 block text-xs leading-relaxed text-[#b4b4b4]">
                      {BLURBS[persona.name] ?? "A reader of the record."}
                    </span>
                  )}
                  {/* pr- clears the "i", which sits on THIS line rather than
                      beside the title: at xl the strip is five columns and
                      INTERROGATOR is a 93px unbreakable word in a ~104px cell,
                      so a badge on the title line ran straight under it. This
                      line wraps, so the reserved corner costs nothing. */}
                  <span className={`${MONO} mt-auto block ${compact ? "" : "pr-6"} pt-1.5 text-[9px] text-[#8a8a8a]`}>
                    {persona.tools.length} TOOLS · {constraintOf(persona)}
                  </span>
                </button>
                {/*
                  Deliberately NO z here. A z-index on the cell makes it a
                  stacking context, which CAPS the open tooltip inside it — and
                  since every cell then stacks equally, the cards after this one
                  paint over the panel. InfoTooltip raises its own trigger while
                  open instead, which lifts the panel above every sibling.

                  align="auto" because the 280px panel always overhangs a card
                  this narrow, and the chat column is `overflow-x-hidden` —
                  it clips rather than scrolls (measured: 18px off the second
                  card). The grid is 2/3/5 columns responsively, so only a
                  measurement knows which side has room.
                */}
                <span className={`absolute ${compact ? "right-2 top-2" : "bottom-3 right-2.5"}`}>
                  <InfoTooltip
                    text={dossierOf(persona)}
                    label={persona.title.replace(/^The /, "")}
                    align="auto"
                  />
                </span>
              </div>
            );
          })}
        </div>
      )}

      {expanded && current && (
        <div className="border border-[#2a2a2a] bg-[#0f0f0f] p-3.5">
          <p className="text-xs leading-relaxed text-[#b4b4b4]">
            The dispatcher refuses any call outside this list before it reaches our backend. What
            this persona cannot do, it cannot do, whatever the model decides.
          </p>
          {/*
            `min-w-0` on every flex child and `break-all` on the names.
            Tool names are long mono strings with no spaces — `get_verdict_evidence`
            is 20 characters — and in the 420px rail they overran their row and
            printed straight through the DENIED label beside them. A flex item
            will not shrink below its content width without `min-w-0`, so the
            fix is on the child, not the container.
          */}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="min-w-0">
              <div className={`${LABEL} mb-1.5 text-[#8a8a8a]`}>MAY CALL</div>
              <ul className="flex flex-col border border-[#2a2a2a]">
                {current.tools.map((tool) => (
                  <li
                    key={tool}
                    className="flex items-start gap-2 border-b border-[#1c1c1c] px-2.5 py-1.5 last:border-b-0"
                  >
                    <span className="mt-1.5 block h-1 w-1 flex-none bg-[#ccff00]" />
                    <span className={`${MONO} min-w-0 flex-1 break-all text-[11px] text-[#ededea]`}>
                      {tool}
                    </span>
                    <span className="mt-px flex-none">
                      <InfoTooltip
                        text={describe.get(tool)}
                        label="What this tool does"
                        align="right"
                      />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            {withheld.length > 0 && (
              <div className="min-w-0">
                <div className={`${LABEL} mb-1.5 text-[#8a8a8a]`}>WITHHELD</div>
                <ul className="flex flex-col gap-1">
                  {withheld.map((tool) => (
                    <li
                      key={tool}
                      className="flex items-start gap-2 border border-[#1c1c1c] bg-[#0d0d0d] px-2.5 py-1.5"
                    >
                      <span
                        className={`${MONO} min-w-0 flex-1 break-all text-[11px] text-[#6a6a6a] line-through decoration-[#2a2a2a]`}
                      >
                        {tool}
                      </span>
                      <span className={`${LABEL} flex-none text-[#6a6a6a]`}>DENIED</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Persona-specific openers. Local copy — the server serves capability, not voice. */
export const OPENERS: Record<string, string[]> = {
  interrogator: [
    "Why is this score what it is?",
    "Which check cost it the most points?",
    "What does the LP custody status actually mean here?",
    "Is anything on this token capped or overridden?",
  ],
  historian: [
    "Has this deployer rugged before?",
    "What has the scanner said about this token over time?",
    "Show me the funding lineage behind this wallet.",
    "How many deployers are on the Wanted Board?",
  ],
  rwa_analyst: [
    "Is this actually a tokenized stock?",
    "Why does every stock token raise a proxy WARN?",
    "Who operates the omnibus vault behind this?",
    "Does this token match the issuer fingerprint?",
  ],
  bodyguard: [
    "Should I be careful with this right now?",
    // No "run a fresh scan" opener any more — no persona can, and an opener
    // that always ends in a refusal is worse than one fewer opener.
    "How old is the verdict I am about to act on?",
    "What is the worst thing on this token today?",
    "Is the honeypot check current?",
  ],
  auditor: [
    "What privileged powers does this contract have?",
    "Who can upgrade or mint on this?",
    "Is the owner key still live?",
    "How complete was the audit on this address?",
  ],
};
