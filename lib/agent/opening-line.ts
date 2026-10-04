/**
 * The Robin Knight's opening line about one verdict — derived, never generated.
 *
 * ## Why this is computed rather than asked for
 *
 * The scan page's preview shows a line in the agent's voice before any turn has
 * been spent. There were two ways to produce it and only one of them is
 * allowed here.
 *
 * A **live model call** on every verdict view would be a real Robin Knight
 * sentence, and it is the wrong build: it costs a turn per page view, it cannot
 * run at all under BYOK before a key is connected (which is every first visit),
 * and it can invent — the one failure this product cannot absorb. A **hand
 * written teaser** is worse still: it would be a quote attributed to our own
 * agent that the agent never said, about a token it never read.
 *
 * So the line is assembled from `verdict.checks[]` — the same record
 * `get_latest_verdict` hands the model. Every figure in it is on the page
 * already and re-derivable from the ledger. It cannot drift from the verdict
 * because it *is* the verdict, and it satisfies citation-or-silence by
 * construction rather than by validation.
 *
 * ## What it must never do
 *
 * **A SKIP is not a PASS** (CLAUDE.md §4). A verdict that deducted nothing
 * because three checks could not look is not a clean one, and the single most
 * damaging thing this line could do is open with "nothing was deducted" over a
 * pool nobody could read. `leadFor` ranks an incomplete read ABOVE a clean
 * sweep for exactly that reason, and says the word "could not".
 */

import type { CheckResult, Verdict } from "../types";

export type OpeningKind = "critical" | "deduction" | "incomplete" | "clean" | "empty";

export interface OpeningLine {
  kind: OpeningKind;
  /** The whole line, ready to render. One or two sentences. */
  text: string;
  /**
   * The question the composer is pre-filled with — what a reader would ask
   * next, phrased as they would ask it. Never auto-sent; see `RobinKnightPreview`.
   */
  prompt: string;
  /** The check this line is about, when it is about one. */
  checkId: string | null;
}

/** Deducting checks, worst first. Ties break on weight so the heavier check leads. */
function byImpact(a: CheckResult, b: CheckResult): number {
  if (b.deduction !== a.deduction) return b.deduction - a.deduction;
  return (b.weight ?? 0) - (a.weight ?? 0);
}

function subjectOf(verdict: Verdict): string {
  return verdict.tokenSymbol?.trim() || verdict.tokenName?.trim() || "This token";
}

export function openingLineFor(verdict: Verdict): OpeningLine {
  const subject = subjectOf(verdict);
  const opener = `${subject} scores ${verdict.score} — ${verdict.tier}.`;

  // The clean branch is the default arm, so an empty list would fall into it and
  // publish "every check ran" over a verdict that ran none — §8.9, the empty
  // value read as an affirmative one.
  if (verdict.checks.length === 0) {
    return {
      kind: "empty",
      text: `${opener} There are no checks on this record to explain — ask me what the scanner covers before you read anything into that number.`,
      prompt: `What does the scanner check, and why does this verdict carry no checks?`,
      checkId: null,
    };
  }

  // A CRITICAL override is not one deduction among many; it replaced the
  // arithmetic. Naming anything else first would bury the only fact that
  // decided the tier.
  const critical = verdict.checks.find((c) => c.status === "CRITICAL");
  if (critical) {
    return {
      kind: "critical",
      text: `${opener} ${critical.name} capped it outright — the other checks did not get a vote. Ask me what that means before you trade it.`,
      prompt: `Why did ${critical.name} cap this verdict?`,
      checkId: critical.id,
    };
  }

  const worst = [...verdict.checks].filter((c) => c.deduction > 0).sort(byImpact)[0];
  if (worst) {
    return {
      kind: "deduction",
      text: `${opener} ${worst.name} is the one that moved it, ${worst.deduction} points off. Ask me why.`,
      prompt: `Why did ${worst.name} cost this token ${worst.deduction} points?`,
      checkId: worst.id,
    };
  }

  // Nothing deducted. Before calling that clean, ask whether anything was
  // actually looked at — §4's empty-result rule, stated to the reader in the
  // one sentence they are most likely to read.
  const skipped = verdict.checks.filter((c) => c.status === "SKIP");
  if (skipped.length > 0) {
    const plural = skipped.length === 1 ? "check" : "checks";
    return {
      kind: "incomplete",
      text: `${opener} Nothing was deducted — but ${skipped.length} ${plural} could not complete, and that is not the same as clean. Ask me which.`,
      prompt: `Which checks could not complete on this token, and what would they have told me?`,
      checkId: skipped[0].id,
    };
  }

  return {
    kind: "clean",
    text: `${opener} Every check ran and none of them took points off. Ask me what was actually tested.`,
    prompt: `What did the scanner actually check on this token?`,
    checkId: null,
  };
}
