"use client";

import { useState } from "react";

import type {
  FaultSource,
  ToolPayload,
  TraceEntry,
  TraceOutcome,
  TurnNotice,
} from "@/lib/agent/types";

/**
 * The message states that carry the product's honesty.
 *
 * These are not edge cases dressed up — they are most of what a user actually
 * sees, and a generic chat UI gets every one of them wrong in the same
 * direction: it renders absence, outage and finding as one undifferentiated
 * "result". This product sells a verdict, so the three must never look alike.
 *
 * The rules the components below encode, in the order they matter:
 *
 * 1. **`found: false` is never lime.** "No rug history for this deployer" is
 *    not "this deployer is safe". An empty shelf reads as absence of
 *    information — dim, unstriped, no status colour, no tick.
 * 2. **`transient: true` is never a hazard stripe.** Infrastructure not
 *    answering is a statement about infrastructure, not about the token. Flat
 *    amber, with a retry, and visually impossible to confuse with a FAIL. Whose
 *    infrastructure it was is carried by `source` and must be named: under BYOK
 *    the model call never reaches us, so blaming ourselves for it is a false
 *    confession that misdirects the only person able to fix it.
 * 3. **A stripped claim reads as integrity, not malfunction.** Quiet, factual,
 *    no alarm colour.
 * 4. **Audit findings say plainly whether they moved the number — including
 *    "we cannot tell from this payload".** They are NOT weightless: the audit
 *    drives the scored `dangerous_selectors` check whenever it resolves.
 * 5. **The memory boundary is never silent.** The page keeps messages the model
 *    was not given; unexplained, that reads as random forgetting.
 */

export const LABEL = "text-[10px] font-bold uppercase tracking-[0.2em]";
export const MONO = "font-mono text-[10px] tracking-[0.12em]";

const HAZARD =
  "repeating-linear-gradient(135deg, #1a0505, #1a0505 6px, #2a0a0a 6px, #2a0a0a 12px)";

/** The five words, with the treatment each one has everywhere else in the product. */
export function OutcomeWord({ outcome }: { outcome: TraceOutcome }) {
  if (outcome === "found")
    return <span className={`${LABEL} text-[#ccff00]`}>OK</span>;
  if (outcome === "empty")
    return <span className={`${LABEL} text-[#8a8a8a]`}>NOTHING ON RECORD</span>;
  if (outcome === "transient")
    return <span className={`${LABEL} text-[#f5c433]`}>DID NOT ANSWER</span>;
  if (outcome === "denied")
    return <span className={`${LABEL} text-[#8a8a8a]`}>NOT ALLOWED</span>;
  return (
    <span
      className={`${LABEL} px-1.5 py-0.5 text-[#ff5c5c]`}
      style={{ background: HAZARD, border: "1px solid #3a0b0b" }}
    >
      FAILED
    </span>
  );
}

/**
 * (a) The tool-call trace — collapsed by default, and a trust feature rather
 * than a debug panel. Watching the agent read the ledger is what makes deciding
 * whether to believe it unnecessary.
 */
export function ToolTrace({ entries, live = false }: { entries: TraceEntry[]; live?: boolean }) {
  const [open, setOpen] = useState(false);
  if (entries.length === 0) return null;

  const total = entries.reduce((sum, e) => sum + e.durationMs, 0);

  return (
    <div className="border border-[#2a2a2a] bg-[#141414]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-[#181818]"
      >
        <span className="flex items-center gap-2">
          <span className={`${LABEL} text-[#8a8a8a]`}>
            {live ? "READING THE RECORD" : "READ THE RECORD"}
          </span>
          <span className={`${MONO} text-[#8a8a8a]`}>
            {entries.length} {entries.length === 1 ? "TOOL" : "TOOLS"} · {(total / 1000).toFixed(2)}s
          </span>
        </span>
        <span className={`${LABEL} text-[#ededea]`}>{open ? "HIDE" : "SHOW"}</span>
      </button>

      {open && (
        <div className="border-t border-[#2a2a2a]">
          {entries.map((entry) => (
            <TraceRow key={`${entry.id}-${entry.name}`} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

function TraceRow({ entry }: { entry: TraceEntry }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-[#2a2a2a] last:border-b-0">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className={`${MONO} truncate text-[11px] text-[#ededea]`}>
            {entry.name.toUpperCase()}
          </span>
          {entry.locale === "client" && (
            <span className={`${MONO} border border-[#2a2a2a] px-1.5 py-0.5 text-[9px] text-[#8a8a8a]`}>
              YOUR BROWSER
            </span>
          )}
        </span>
        <span className="flex flex-none items-center gap-2.5">
          <OutcomeWord outcome={entry.outcome} />
          <span className={`${MONO} text-[#8a8a8a]`}>{entry.durationMs}ms</span>
          {entry.payload && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className={`${LABEL} text-[#b4b4b4] hover:text-[#ededea]`}
            >
              {open ? "CLOSE" : "PAYLOAD"}
            </button>
          )}
        </span>
      </div>

      {open && entry.payload && (
        <pre className="max-h-56 overflow-auto border-t border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 font-mono text-[10px] leading-relaxed text-[#b4b4b4]">
          {JSON.stringify(entry.payload, null, 2)}
        </pre>
      )}

      {!entry.payload && (
        // Not an empty payload — the result never left the server on this path,
        // and rendering a blank box here would read as "the tool returned
        // nothing", which is the exact confusion this whole file exists to stop.
        <p className={`${MONO} border-t border-[#2a2a2a] bg-[#111111] px-3 py-1.5 text-[#6a6a6a]`}>
          RESULT STAYED ON THE SERVER · WE RUN THIS MODE, SO THE BODY IS NOT SENT TO THE PAGE
        </p>
      )}
    </div>
  );
}

/**
 * A turn the user stopped. Neither a failure nor an answer.
 *
 * It must not wear the citation strip (that would present a stop as a validated
 * empty reply) and it must not wear amber or the hazard stripe (nothing broke).
 * Plain, dim, and it says what happens next.
 */
export function StoppedTurn() {
  return (
    <div className="flex items-center gap-3 border border-[#2a2a2a] bg-[#111111] px-3.5 py-3">
      <span className="block h-1.5 w-1.5 flex-none bg-[#3d3d3d]" />
      <span className={`${MONO} text-[#8a8a8a]`}>
        STOPPED. NOTHING WAS ANSWERED, SO NOTHING WAS ADDED TO THE RECORD OF THIS CONVERSATION.
      </span>
    </div>
  );
}

/** (b) `found: false` — an empty shelf, not a pass. Never lime. */
export function NothingOnRecord({ tool, detail }: { tool?: string; detail?: string }) {
  return (
    <div
      className="border border-[#2a2a2a]"
      style={{
        background:
          "repeating-linear-gradient(135deg, #0d0d0d, #0d0d0d 7px, #111111 7px, #111111 14px)",
      }}
    >
      <div className="flex items-center justify-between gap-2 border-b border-[#1c1c1c] px-3.5 py-2.5">
        <span className={`${LABEL} border border-[#2a2a2a] bg-[#111111] px-2 py-0.5 text-[#8a8a8a]`}>
          NOT ON RECORD
        </span>
        {tool && <span className={`${MONO} text-[#6a6a6a]`}>{tool.toUpperCase()}</span>}
      </div>
      <div className="px-3.5 py-4">
        <p className="text-sm leading-relaxed text-[#dadada]">
          {detail ??
            "Nothing is filed here. No rugs, no dead launches, no funding stain — because there is no file. Not because the file is clean."}
        </p>
        <div className="mt-3.5 flex items-start gap-3 border-t border-[#1c1c1c] pt-3">
          <span className="mt-2 h-px w-5 flex-none bg-[#3d3d3d]" />
          <span className="font-serif text-sm italic leading-relaxed text-[#8a8a8a]">
            The record lists what we have indicted. Not everything that deserves it.
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * (c) `transient: true` — an outage. Flat amber, never a hazard stripe.
 *
 * **Whose outage is part of the message.** Under BYOK the model request never
 * touches our servers: it goes from this browser to the reader's own provider
 * account on the reader's own key. Printing "our infrastructure did not answer"
 * over their exhausted quota is a false confession, and worse than merely
 * false — it points the one person who can fix it at the one party who cannot.
 * `source` is carried on the error from where the failure happened, so a stored
 * case file keeps the right attribution when it is replayed later.
 *
 * The billing line is ours-only for the same reason: under BYOK there is no
 * meter to reassure anyone about, and mentioning one invents a relationship
 * that does not exist.
 */
export function TransientFault({
  message,
  code,
  onRetry,
  source = "ours",
}: {
  message: string;
  code?: string;
  onRetry?: () => void;
  source?: FaultSource;
}) {
  const yours = source === "yours";
  return (
    <div className="border border-[#5a5a2a] bg-[#1a1a0e]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#5a5a2a] px-3.5 py-2.5">
        <span className={`${LABEL} border border-[#5a5a2a] px-2 py-0.5 text-[#f5c433]`}>
          {yours ? "YOUR MODEL PROVIDER DID NOT ANSWER" : "OUR INFRASTRUCTURE DID NOT ANSWER"}
        </span>
        {code && <span className={`${MONO} text-[#f5c433]`}>{code}</span>}
      </div>
      <div className="px-3.5 py-4">
        <p className="text-sm leading-relaxed text-[#f5c433]">{message}</p>
        <p className="mt-2 text-xs leading-relaxed text-[#c9a83a]">
          {yours
            ? "That is between your key and your provider — your own browser made that request, and we were not in it. Nothing here is about this token, and nothing here is an all-clear."
            : "That is about our infrastructure, not about this token. It is not a failure and not an all-clear."}
        </p>
        {onRetry && (
          <div className="mt-3.5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onRetry}
              className={`${LABEL} border-2 border-[#eab308] px-3.5 py-2 text-[#f5c433] hover:bg-[#2a2410]`}
            >
              ASK AGAIN
            </button>
            <span className={`${MONO} text-[#c9a83a]`}>
              {yours ? "YOUR KEY · CHECK ITS QUOTA OR PICK ANOTHER MODEL" : "THIS TURN IS NOT BILLABLE"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A definite failure — a fact, not an outage. Hazard stripe, no retry framing.
 *
 * `REFUSED` unqualified reads as *we* refused, which is wrong for the BYOK
 * shape it most often carries: a 401 or 403 is the reader's provider rejecting
 * the reader's key, and mislabelling that sends them to our support instead of
 * their billing page.
 */
export function DefiniteFailure({
  message,
  code,
  source = "ours",
}: {
  message: string;
  code?: string;
  source?: FaultSource;
}) {
  return (
    <div style={{ background: HAZARD, border: "1px solid #3a0b0b" }} className="px-3.5 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className={`${LABEL} text-[#ff5c5c]`}>
          {source === "yours" ? "YOUR PROVIDER REFUSED" : "REFUSED"}
        </span>
        {code && <span className={`${MONO} text-[#ff5c5c]`}>{code}</span>}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-[#ff5c5c]">{message}</p>
    </div>
  );
}

/**
 * (d) A claim was removed. Quiet, and framed as integrity.
 *
 * The removed sentences themselves are shown only when we have them — the
 * validator runs in this browser under BYOK, and server-side under our-models,
 * where only a count comes back. Claiming to show text we were never sent would
 * be exactly the invention this component exists to report.
 */
export function StrippedClaims({ count, sentences }: { count: number; sentences?: string[] }) {
  const [open, setOpen] = useState(false);
  if (!count) return null;

  return (
    <div className="border-t border-[#2a2a2a]">
      <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
        <span className="flex items-center gap-2.5">
          <span className="h-px w-3.5 bg-[#3d3d3d]" />
          <span className={`${MONO} text-[#8a8a8a]`}>
            {count === 1 ? "ONE SENTENCE WAS REMOVED" : `${count} SENTENCES WERE REMOVED`} — IT
            STATED A NUMBER NO TOOL RETURNED
          </span>
        </span>
        {sentences && sentences.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className={`${LABEL} flex-none text-[#b4b4b4] hover:text-[#ededea]`}
          >
            {open ? "HIDE" : "SHOW"}
          </button>
        )}
      </div>
      {open && sentences && (
        <div className="border-t border-[#2a2a2a] bg-[#1a1a1a] px-3.5 py-3">
          <div className={`${MONO} mb-2 text-[#6a6a6a]`}>REMOVED</div>
          {sentences.map((sentence) => (
            <p
              key={sentence}
              className="text-[13px] leading-relaxed text-[#8a8a8a] line-through decoration-[#2a2a2a]"
            >
              {sentence}
            </p>
          ))}
          <p className="mt-2.5 font-serif text-[13px] italic leading-relaxed text-[#b4b4b4]">
            No tool returned that figure, so it does not reach the page. Ask again and the check
            gets read.
          </p>
        </div>
      )}
    </div>
  );
}

/** Browser reads name their actual source; web research does not verify chain state. */
export function ClientReadFooter({ entries }: { entries: TraceEntry[] }) {
  const reads = entries.filter((e) => e.locale === "client" && e.provenance);
  if (reads.length === 0) return null;
  const chainReads = reads.filter((e) => e.provenance?.source === "client-rpc" && e.provenance.chainId === 4663 && (e.provenance.blockNumber ?? 0) > 0);
  const block = Math.max(0, ...chainReads.map((e) => e.provenance?.blockNumber ?? 0));
  const external = [...new Set(reads.flatMap((e) => e.provenance?.source === "parallel-mcp" ? ["Parallel Search"] : e.provenance?.source === "dexscreener" ? ["DexScreener"] : []))];

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-[#2a2a2a] bg-[#1a1a1a] px-3.5 py-2.5">
      <span className={`${LABEL} border border-[#2a2a2a] bg-[#111111] px-2 py-0.5 text-[#b4b4b4]`}>
        READ IN YOUR BROWSER
      </span>
      {chainReads.length > 0 && <span className={`${MONO} text-[#b4b4b4]`}>CHAIN 4663 · BLOCK {block.toLocaleString('en-US')}</span>}
      {external.length > 0 && <span className={`${MONO} text-[#b4b4b4]`}>{external.join(" · ")} · advisory</span>}
    </div>
  );
}

/** A browser source read is in flight. */
export function ReadingTheChain({ tool }: { tool?: string }) {
  return (
    <div className="flex items-center gap-3 border border-[#2a2a2a] bg-[#141414] px-3.5 py-3">
      <PulseDots />
      <span className={`${MONO} text-[11px] text-[#ededea]`}>READING SOURCES…</span>
      <span className={`${MONO} ml-auto text-[#b4b4b4]`}>
        {tool ? `${tool.toUpperCase()} · ` : ""}YOUR BROWSER
      </span>
    </div>
  );
}

export function PulseDots({ tone = "#ccff00" }: { tone?: string }) {
  return (
    <span className="flex flex-none gap-1">
      {[0, 0.18, 0.36].map((delay) => (
        <span
          key={delay}
          className="block h-1.5 w-1.5 animate-pulse"
          style={{ background: tone, animationDelay: `${delay}s`, animationDuration: "1.1s" }}
        />
      ))}
    </span>
  );
}

/** (f) Where the agent's memory begins. Never silent. */
export function MemoryDivider({ dropped }: { dropped: number }) {
  return (
    <div className="flex flex-col gap-2 py-1">
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-[#2a2a2a]" />
        <span className={`${LABEL} whitespace-nowrap border border-[#2a2a2a] bg-[#0f0f0f] px-2.5 py-1 text-[#8a8a8a]`}>
          THE AGENT&apos;S MEMORY BEGINS HERE
        </span>
        <span className="h-px flex-1 bg-[#2a2a2a]" />
      </div>
      <p className={`${MONO} text-center leading-relaxed text-[#6a6a6a]`}>
        {dropped} OLDER {dropped === 1 ? "MESSAGE IS" : "MESSAGES ARE"} STILL ON THIS PAGE BUT
        {dropped === 1 ? " WAS" : " WERE"} NOT SENT TO THE MODEL FOR THIS ANSWER
      </p>
    </div>
  );
}

/**
 * (g) Contract-audit findings, and whether they moved the number.
 *
 * **Three states, not two, and the third is the point.** This badge said
 * "ADVISORY · DID NOT AFFECT THE NUMBER" unconditionally until 2026-08-03, and
 * that was false: formula v1.17 lets the audit's capabilities and authorities
 * REPLACE the bytecode scan as the scored signal for `dangerous_selectors`
 * (`lib/scanner/checks.ts` §4.2b). A badge printing "did not affect the number"
 * over a finding that produced the deduction is the worst version of the
 * mistake this whole file exists to prevent — the narrator misdescribing how
 * the engine reached its number.
 *
 * `scored === null` means the payload could not tell us, and it renders as
 * exactly that rather than falling back to the reassuring answer. Paper on
 * black either way: louder than any status colour precisely because it is not
 * one of them.
 */
export function AdvisoryBadge({
  scored,
  source,
}: {
  scored?: boolean | null;
  source?: string;
}) {
  const headline =
    scored === true
      ? "SCORED · DROVE DANGEROUS_SELECTORS"
      : scored === false
        ? "ADVISORY · DID NOT MOVE THIS NUMBER"
        : "AUDIT FINDINGS · SCORED STATUS UNKNOWN HERE";

  return (
    <div className="flex items-stretch border border-[#2a2a2a]">
      <span
        className={`${LABEL} flex items-center whitespace-nowrap px-3.5 py-2.5 ${
          scored === true ? "bg-[#ccff00] text-[#0a0a0a]" : "bg-[#ededea] text-[#0a0a0a]"
        }`}
      >
        {headline}
      </span>
      <span
        className={`${MONO} flex flex-1 items-center justify-end border-l border-[#2a2a2a] px-3.5 py-2.5 text-[#8a8a8a]`}
      >
        {(source ?? "CONTRACT AUTHORITY AUDIT").toUpperCase()}
      </span>
    </div>
  );
}

/**
 * (h) The header strip above an answer body.
 *
 * Honest about a real limitation: **neither path streams prose.** `llm.complete`
 * is a single non-streaming call and all three BYOK adapters build non-streaming
 * requests, so text arrives whole, already validated. What *is* progressive is
 * the trace — tool rows land one at a time — and that is the trust surface
 * anyway. So `arriving` renders the working state above an empty body; it never
 * renders unchecked prose as though it had been checked.
 */
export function AnswerStrip({
  arriving,
  strippedClaims,
}: {
  arriving?: boolean;
  strippedClaims?: number;
}) {
  if (arriving) {
    return (
      <div
        className="flex items-center gap-2.5 border-b border-[#2a2a2a] px-3.5 py-2.5"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg,#141414,#141414 12px,#171717 12px,#171717 24px)",
        }}
      >
        <span className={`${LABEL} text-[#8a8a8a]`}>ARRIVING</span>
        <span className={`${MONO} text-[#6a6a6a]`}>NOT YET CHECKED AGAINST THE RECORD</span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2.5 border-b border-[#2a2a2a] px-3.5 py-2.5">
      <span className="block h-1.5 w-1.5 bg-[#ccff00]" />
      <span className={`${LABEL} text-[#8a8a8a]`}>ON THE RECORD</span>
      <span className={`${MONO} text-[#6a6a6a]`}>
        EVERY FIGURE CITED · {strippedClaims ?? 0} REMOVED
      </span>
    </div>
  );
}

/** A turn-level notice from either path (history trimmed, budget reached). */
export function NoticeLine({ notice }: { notice: TurnNotice }) {
  return (
    <p className={`${MONO} border border-[#2a2a2a] bg-[#111111] px-3 py-2 leading-relaxed text-[#8a8a8a]`}>
      {notice.message.toUpperCase()}
    </p>
  );
}

/** Shared by the trace payload viewer and the specimen gallery. */
export function payloadHeadline(payload: ToolPayload): string {
  if (payload.ok === false) return payload.error ?? "The lookup did not complete.";
  if (!payload.found) return payload.note ?? "Nothing is on record for this query.";
  return "";
}

/**
 * No verdict exists for this token, and no chat surface can make one.
 *
 * The other half of taking `scan_token` off the chat plane. A scan spends our
 * RPC budget and appends a permanent ledger entry, so it belongs to /scan where
 * the person asking for it can see what it costs — but "we cannot do that here"
 * is a dead end unless it comes with the door.
 *
 * Deliberately NOT lime and NOT a hazard: an unscanned token is an empty shelf,
 * exactly like `NothingOnRecord`, and this must never read as either an
 * accusation or an all-clear. The model is told the same thing in prose; this is
 * the rendered version, so the link is real rather than a URL the model typed.
 */
export function RunAScan({ address }: { address: string }) {
  return (
    <div className="flex flex-col gap-2.5 border border-[#2a2a2a] bg-[#111111] px-3.5 py-3">
      <span className={`${MONO} text-[#8a8a8a]`}>
        NO VERDICT ON RECORD FOR THIS TOKEN. THAT IS AN ABSENCE OF EVIDENCE, NOT A CLEAN ONE.
      </span>
      <a
        href={`/scan/${address}`}
        className={`${LABEL} w-fit border border-[#3d3d3d] px-3 py-1.5 text-[#ededea] transition-colors hover:border-[#ccff00] hover:text-[#ccff00]`}
      >
        RUN A SCAN →
      </a>
    </div>
  );
}
