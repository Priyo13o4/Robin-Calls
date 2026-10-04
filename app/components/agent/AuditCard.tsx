"use client";

import {
  isObj,
  emptyFindingsReason,
  readFindings,
  readSurface,
  verificationOf,
  type AuditFinding,
  type SurfaceSummary,
  type Verification,
} from "@/lib/agent/audit-view";
import { LABEL, MONO } from "./MessageStates";

/**
 * The contract audit, rendered from the tool result rather than from prose.
 *
 * Why this exists: the audit payload is dense and precisely qualified —
 * capability, confidence tier, the actual function signature, the modifiers
 * gating it, the probe outcome — and asking a language model to carry all of
 * that in a paragraph loses the qualifiers first. In the transcript that
 * prompted this, a `SUPPLY_MINT` finding at `heuristic` confidence on a
 * function called `deposit()` was narrated as a mint function, flatly. Every
 * fact needed to doubt that was in the payload; none of it reached the reader.
 *
 * So the qualifiers are rendered as structure. The confidence tier is a chip
 * beside the capability, the function it came from is printed underneath, and a
 * pattern match cannot be typeset to look like a source reading. The model
 * still writes the answer; this is the evidence it answered from, shown next to
 * it so the two can be compared — the same idea as the tool trace one component
 * over. A claim you can check is worth more than a claim you must trust.
 *
 * All interpretation lives in `lib/agent/audit-view.ts` and is tested there.
 * This file is typography.
 *
 * **Nothing here is a verdict.** No score, no tier, no display face — that
 * belongs to the verdict page. A capability is a power the code contains, and
 * this card's job is to say so precisely enough that a reader can judge it.
 */

type Json = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** rank → the colour that says the same thing the word says. */
const TIER_TONE: Record<number, { text: string; border: string }> = {
  3: { text: "#ededea", border: "#4a4a4a" },
  2: { text: "#d9a441", border: "#5a4520" },
  1: { text: "#8a8a8a", border: "#2a2a2a" },
  0: { text: "#8a8a8a", border: "#2a2a2a" },
};

export { findAuditPayload } from "@/lib/agent/audit-view";

export function AuditCard({ value, live }: { value: Json; live: boolean }) {
  const identity = isObj(value.identity) ? value.identity : {};
  const surface = readSurface(identity);
  const findings = readFindings(value);
  const authorities = (Array.isArray(value.authorities) ? value.authorities : []).filter(isObj);
  const completeness = str(value.completeness) ?? "unresolved";
  const verification = verificationOf(identity.sourceVerified, identity.sourceMatch);
  const name = str(identity.name);
  const compiler = str(identity.compilerVersion);

  const inventory = isObj(identity.inventory) ? identity.inventory : {};
  const notInAbi = Array.isArray(inventory.selectorsNotInAbi)
    ? (inventory.selectorsNotInAbi as unknown[])
    : null;

  return (
    <div className="border border-[#2a2a2a] bg-[#141414]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-[#2a2a2a] px-3.5 py-2.5">
        <span className={`${LABEL} text-[#8a8a8a]`}>CONTRACT AUDIT</span>
        <span className={`${MONO} text-[#6a6a6a]`}>
          {live ? "RAN IN YOUR BROWSER · NOT ON RECORD" : "FROM THE RECORD"}
        </span>
      </div>

      {/* ── who this is ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-1 px-3.5 py-3">
        <span className="font-serif text-[15px] text-[#ededea]">
          {name ?? <span className="text-[#8a8a8a]">Name not established</span>}
        </span>
        <span className={`${MONO} flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[#8a8a8a]`}>
          <VerificationWord verification={verification} />
          <Dot />
          <span>{surface.countLabel}</span>
          {compiler && (
            <>
              <Dot />
              <span>{compiler}</span>
            </>
          )}
        </span>
      </div>

      {/* ── the powers ──────────────────────────────────────────────────── */}
      <div className="border-t border-[#2a2a2a]">
        <div className="px-3.5 pt-2.5">
          <span className={`${LABEL} text-[#8a8a8a]`}>POWERS IN THE CODE</span>
        </div>
        {findings.length === 0 ? (
          <EmptyFindings
            completeness={completeness}
            verification={verification}
            surface={surface}
          />
        ) : (
          <div className="flex flex-col">
            {findings.map((f) => (
              <FindingRow key={`${f.capability}-${f.signatures[0] ?? ""}`} finding={f} />
            ))}
          </div>
        )}
      </div>

      {/* ── who holds them ──────────────────────────────────────────────── */}
      {authorities.length > 0 && (
        <div className="border-t border-[#2a2a2a] px-3.5 py-2.5">
          <span className={`${LABEL} text-[#8a8a8a]`}>WHO CAN USE THEM</span>
          <div className="mt-1.5 flex flex-col gap-1">
            {authorities.map((a, i) => (
              <span key={i} className={`${MONO} flex flex-wrap gap-x-2 text-[#b4b4b4]`}>
                <span className="text-[#ededea]">
                  {(str(a.kind) ?? "unknown").replace(/-/g, " ").toUpperCase()}
                </span>
                <span className="break-all">{str(a.controller) ?? "CONTROLLER NOT RESOLVED"}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── what this can and cannot support ────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-[#2a2a2a] bg-[#111111] px-3.5 py-2">
        <span className={`${MONO} text-[#8a8a8a]`}>EVIDENCE {completeness.toUpperCase()}</span>
        {str(value.truncationReason) && (
          <>
            <Dot />
            <span className={`${MONO} text-[#8a8a8a]`}>
              {str(value.truncationReason)!.replace(/-/g, " ").toUpperCase()}
            </span>
          </>
        )}
        {notInAbi !== null && notInAbi.length > 0 && (
          <>
            <Dot />
            <span className={`${MONO} text-[#d9a441]`}>
              {notInAbi.length} SELECTOR{notInAbi.length === 1 ? "" : "S"} NOT IN THE ABI
            </span>
          </>
        )}
        <Dot />
        {/*
          Stated on the card, not left to the prose. An audit can show a power
          is present; it can never establish that none is (CLAUDE.md §4), and
          that goes double for the live path, whose RPC belongs to the reader.
        */}
        <span className={`${MONO} text-[#6a6a6a]`}>THIS CANNOT CLEAR A CONTRACT</span>
      </div>
    </div>
  );
}

function Dot() {
  return <span className="text-[#3d3d3d]">·</span>;
}

const VERIFICATION_WORD: Record<Verification, { text: string; tone: string }> = {
  verified: { text: "SOURCE VERIFIED", tone: "#b4b4b4" },
  // Amber, not grey. This one is a caveat the reader has to act on: the source
  // matches the bytecode but not this address's metadata, so it is very likely
  // the right code and is not provably it. Drawn identically to a full match,
  // it licensed an all-clear it cannot support.
  partial: { text: "SOURCE PARTIALLY VERIFIED", tone: "#f5c433" },
  unverified: { text: "SOURCE NOT VERIFIED", tone: "#8a8a8a" },
  // Not "unverified". The explorer read failed; that is a fact about our
  // lookup, not about the contract.
  unestablished: { text: "VERIFICATION NOT ESTABLISHED", tone: "#8a8a8a" },
};

function VerificationWord({ verification }: { verification: Verification }) {
  const v = VERIFICATION_WORD[verification];
  return <span style={{ color: v.tone }}>{v.text}</span>;
}

function FindingRow({ finding }: { finding: AuditFinding }) {
  const tone = TIER_TONE[finding.tier.rank] ?? TIER_TONE[0];

  return (
    <div className="flex flex-col gap-1.5 border-b border-[#2a2a2a] px-3.5 py-2.5 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <span className={`${LABEL} text-[#ededea]`}>{finding.capability.replace(/_/g, " ")}</span>
        <span
          className={`${MONO} border px-1.5 py-0.5 text-[9px]`}
          style={{ color: tone.text, borderColor: tone.border }}
          title={finding.tier.hint}
        >
          {finding.tier.word}
        </span>
        {finding.probeStatus && finding.probeStatus !== "not-run" && (
          <span
            className={`${MONO} border border-[#2a2a2a] px-1.5 py-0.5 text-[9px] text-[#b4b4b4]`}
          >
            PROBED · {finding.probeStatus.toUpperCase()}
          </span>
        )}
      </div>

      {/*
        The function, printed. A capability label with nothing behind it cannot
        be checked by the reader, and an alarming label on an ordinary function
        is precisely how this surface misleads.
      */}
      {finding.signatures.length > 0 ? (
        <span className="font-mono text-[11px] leading-relaxed text-[#b4b4b4]">
          {finding.signatures.join("  ·  ")}
        </span>
      ) : (
        <span className={`${MONO} text-[#6a6a6a]`}>NO FUNCTION SIGNATURE RECORDED</span>
      )}

      {(finding.gatingModifiers.length > 0 || finding.otherModifiers.length > 0) && (
        <span className={`${MONO} text-[#8a8a8a]`}>
          {finding.gatingModifiers.length > 0 ? (
            <>ADMIN-GATED · {finding.gatingModifiers.join(" ")}</>
          ) : (
            // Only safety modifiers. They gate re-entrancy or pause state, not
            // authority; "gated by nonReentrant" would read as a lock.
            <>NO AUTHORITY MODIFIER · {finding.otherModifiers.join(" ")}</>
          )}
        </span>
      )}

      <span className="text-[11px] leading-relaxed text-[#6a6a6a]">{finding.tier.hint}</span>
    </div>
  );
}

/**
 * The empty case — the one worth building the card for.
 *
 * "No capabilities found" is the sentence that reads as an all-clear, and it is
 * returned identically by a contract that holds no privileged power and by one
 * whose source was never read. Neither is worth printing alone, so print what
 * was actually examined.
 */
function EmptyFindings({
  completeness,
  verification,
  surface,
}: {
  completeness: string;
  verification: Verification;
  surface: SurfaceSummary;
}) {
  // Why it is empty, not merely that it is. The branch order matters: an
  // unverified contract has `completeness: "unresolved"` by construction, so
  // testing completeness first would tell every unverified contract on the
  // chain that our analysis fell short — when in fact there was simply no
  // source to read.
  const reason = emptyFindingsReason(verification, completeness);
  return (
    <div className="flex flex-col gap-1.5 px-3.5 pb-3 pt-1.5">
      <span className="text-[12px] leading-relaxed text-[#b4b4b4]">
        {reason === "bytecode-only" ? (
          <>
            No privileged capability matched. There was no verified source to read, so this is a
            bytecode-only look at the dispatched selectors below — far less to go on than a source
            reading, and nothing here rules a power out.
          </>
        ) : reason === "lookup-failed" ? (
          <>
            No privileged capability matched — but we could not establish whether this contract
            has verified source at all, so we do not know what was missed. This is the weakest
            position the audit can be in.
          </>
        ) : reason === "partial-match" ? (
          <>
            No privileged capability matched — but the explorer&rsquo;s source is a{" "}
            <span className="text-[#f5c433]">partial match</span>: it compiles to this
            bytecode without matching this address&rsquo;s metadata, so it is very likely the
            right code and is not provably it. Read the finding as being about that source, not
            about this address.
          </>
        ) : reason === "incomplete" ? (
          <>
            No privileged capability was matched, but the analysis did not finish (
            <span className="text-[#ededea]">{completeness}</span>). That is &ldquo;we did not
            establish this&rdquo;, not &ldquo;the contract cannot do this&rdquo;.
          </>
        ) : (
          <>No privileged capability matched the verified source. What was examined is below.</>
        )}
      </span>
      {surface.entries.length > 0 ? (
        <span className="font-mono text-[11px] leading-relaxed text-[#8a8a8a]">
          {surface.entries.slice(0, 24).join("  ·  ")}
          {surface.entries.length > 24 ? `  ·  +${surface.entries.length - 24} more` : ""}
        </span>
      ) : (
        <span className={`${MONO} text-[#6a6a6a]`}>
          {surface.source === "none"
            ? "THE CALLABLE SURFACE COULD NOT BE ENUMERATED EITHER"
            : "NO ENTRY POINTS ENUMERATED"}
        </span>
      )}
    </div>
  );
}
