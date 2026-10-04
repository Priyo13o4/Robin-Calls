"use client";

import { useEffect, useRef, type ReactNode } from "react";

import type { ChatMessage, TraceEntry } from "@/lib/agent/types";
import type { LiveTurn } from "./useRobinKnight";
import { InlineAddressChip, useCopy } from "../site/CopyAddressChip";
import {
  AdvisoryBadge,
  AnswerStrip,
  ClientReadFooter,
  DefiniteFailure,
  LABEL,
  MONO,
  MemoryDivider,
  NoticeLine,
  PulseDots,
  ReadingTheChain,
  RunAScan,
  StoppedTurn,
  StrippedClaims,
  ToolTrace,
  TransientFault,
} from "./MessageStates";
import { AuditCard, findAuditPayload } from "./AuditCard";

/**
 * The conversation, rendered.
 *
 * One rule governs the whole file: **an agent-authored number never gets the
 * authority of a verdict number.** The verdict's score is display-scale Cinzel
 * on the page beside this panel; nothing rendered here is ever set that way.
 * The answer body is body text, the tool trace is the evidence for it, and the
 * strip above it says whether the citation validator has been over it yet.
 */

/**
 * The contract-audit block from this turn's tool results, if one arrived.
 *
 * Returns the server's tri-state `scored` verbatim — `undefined` when no audit
 * block was seen at all, `null` when one was seen and the payload could not say
 * whether it moved the number. Collapsing those two would mean the badge
 * silently disappearing in one case and asserting in the other.
 */
function auditScored(trace: TraceEntry[] | undefined): boolean | null | undefined {
  if (!trace) return undefined;
  for (const entry of trace) {
    const value = entry.payload?.value;
    if (!value || typeof value !== "object") continue;
    const audit = (value as Record<string, unknown>).contractAudit;
    if (audit && typeof audit === "object" && "advisory" in audit) {
      return (audit as { scored?: boolean | null }).scored ?? null;
    }
  }
  return undefined;
}

const PHASE_COPY: Record<LiveTurn["phase"], string> = {
  thinking: "CONSULTING THE RECORD…",
  reading: "READING THE RECORD…",
  browser_reading: "READING SOURCES…",
  validating: "CHECKING EVERY FIGURE…",
};

/**
 * Did this turn look for a verdict and find none?
 *
 * Read off the TRACE, not the prose. The tool outcome is a fact the dispatcher
 * reported; whether the model chose to mention it is a separate question, and
 * the whole point of the trace is that the two can be compared. This is also
 * why the scan link is rendered rather than left to the model: a URL it typed
 * is a claim, a URL we rendered is a control.
 */
function foundNoVerdict(trace: TraceEntry[] | undefined): boolean {
  if (!trace) return false;
  return trace.some((entry) => entry.name === "get_latest_verdict" && entry.outcome === "empty");
}

/**
 * Copy one message's text.
 *
 * **It copies what the reader can see, and only that.** For an assistant turn
 * that is `message.text` — the validated prose, after the citation check, with
 * any stripped sentence already gone. It deliberately does not gather the tool
 * trace or the audit card: those are separately rendered evidence, and a
 * clipboard that quietly bundled them would let a paste claim to be the answer
 * while carrying material the answer did not. Whole-conversation export exists
 * for the full record, and it says so in the case-file menu.
 *
 * Always visible below `lg`, hover-revealed above it. A control that only
 * appears on hover does not exist on a phone, which is where the rail and the
 * sheet live; on a wide screen a button per message is noise until wanted.
 *
 * **A glyph, and under the text it copies.** The word COPY set in the same
 * letterspaced caps as ON THE RECORD and NOTHING ON RECORD read as another
 * status line — this surface spends uppercase type on assertions about the
 * record, so a control wearing that type competes with them for the reader's
 * attention and, worse, borrows their authority. An icon is unmistakably a
 * control. Below the prose rather than beside it because beside it the button
 * shares a row with the first line of the answer and takes width from it on
 * narrow screens; the copy target is the whole message, so the control belongs
 * at its end.
 *
 * Clipboard comes from `useCopy` (`CopyAddressChip.tsx`) rather than a third
 * hand-rolled `navigator.clipboard` call — it carries the `execCommand`
 * fallback for insecure origins and in-app browsers.
 */
function CopyMessage({ text, tone = "dark" }: { text: string; tone?: "dark" | "light" }) {
  const { copied, copy } = useCopy(text);
  if (!text.trim()) return null;
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Message copied" : "Copy this message"}
      title={copied ? "Copied" : "Copy this message"}
      // `p-1.5` around a 13px glyph is a 25px target. Not the 44px a touch
      // guideline asks for, but this control is always visible below `lg` and
      // sits directly under the text it copies, so it is not competing with a
      // neighbour for a mistaken tap — and a 44px box would tower over the
      // 21px rows it shares this surface with.
      className={`flex-none p-1.5 transition-opacity lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 ${
        copied
          ? "text-[#ccff00] lg:opacity-100"
          : tone === "light"
            ? "text-[#6a6a6a] hover:text-[#ededea]"
            : "text-[#4d5a3a] hover:text-[#c9f24a]"
      }`}
    >
      {/* `strokeLinecap="square"` and unrounded corners: every other edge in
          this product is a hard corner, and a rounded clipboard glyph reads as
          borrowed from a different UI kit. */}
      <svg
        width="13"
        height="13"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="square"
        aria-hidden="true"
        focusable="false"
      >
        {copied ? (
          <path d="M3.5 8.5 L6.5 11.5 L12.5 4.5" />
        ) : (
          <>
            <rect x="5.75" y="5.75" width="7.75" height="7.75" />
            <path d="M10.25 5.75 V2.5 H2.5 V10.25 H5.75" />
          </>
        )}
      </svg>
    </button>
  );
}

export function Transcript({
  messages,
  live,
  onRetry,
  subject,
}: {
  messages: ChatMessage[];
  live: LiveTurn | null;
  onRetry?: () => void;
  /** The address this conversation is about, when it is about one. */
  subject?: string | null;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  /**
   * Follow the conversation by scrolling the panel's OWN scroll container —
   * never `scrollIntoView`.
   *
   * `scrollIntoView` scrolls every scrollable ancestor, the document included.
   * On `/robin-knight` that yanked the whole page down as each tool row landed,
   * leaving the reader staring at empty background with the panel off-screen;
   * on `/scan` it would drag the page away from the verdict the user is asking
   * about. Seen in the browser, which is the only place it exists.
   *
   * Pinned to the bottom only when the reader is already near it: scrolling
   * someone away from a trace row they are reading is worse than not following.
   */
  useEffect(() => {
    const end = endRef.current;
    if (!end) return;
    let node = end.parentElement;
    while (node) {
      const overflow = getComputedStyle(node).overflowY;
      if ((overflow === "auto" || overflow === "scroll") && node.scrollHeight > node.clientHeight) {
        const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
        if (distanceFromBottom < 240) node.scrollTop = node.scrollHeight;
        return;
      }
      node = node.parentElement;
    }
  }, [messages.length, live?.trace.length, live?.phase]);

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      {messages.map((message) => (
        <div key={message.id} className="flex flex-col gap-2.5">
          {message.memoryStartsHere && <MemoryDivider dropped={countBefore(messages, message.id)} />}
          {message.personaChanged && message.persona && (
            <div className="py-2 text-center text-[12px] text-[#b7bbb7]">
              Switched to {message.persona.replaceAll("_", " ")}
            </div>
          )}

          {message.role === "user" ? (
            // The copy control sits OUTSIDE the bubble and below it, so it
            // neither reflows the text nor overlaps a pasted address. Aligned
            // to the bubble's right edge because the bubble is right-aligned:
            // the control tracks the block it acts on, not the column.
            <div className="group ml-auto flex max-w-[92%] flex-col items-end">
              {/* `break-words`: people paste bare addresses, and a 42-character
                  unbroken string is exactly what blew the rail's width open. */}
              <div className="min-w-0 self-stretch break-words border border-[#2a2a2a] bg-[#1c1c1c] px-3.5 py-2.5 text-[13px] leading-relaxed text-[#ededea]">
                {message.text}
              </div>
              {/* `-mr-1.5` for the same reason the assistant side uses
                  `-ml-1.5`, mirrored: this column is right-aligned, so the
                  glyph lines up with the bubble's right edge. */}
              <div className="-mr-1.5 mt-1 flex">
                <CopyMessage text={message.text} tone="light" />
              </div>
            </div>
          ) : (
            <AssistantMessage message={message} onRetry={onRetry} subject={subject} />
          )}
        </div>
      ))}

      {live && <LiveMessage live={live} />}
      <div ref={endRef} />
    </div>
  );
}

function countBefore(messages: ChatMessage[], id: string): number {
  const index = messages.findIndex((m) => m.id === id);
  return index < 0 ? 0 : index;
}

function AssistantMessage({
  message,
  onRetry,
  subject,
}: {
  message: ChatMessage;
  onRetry?: () => void;
  subject?: string | null;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      {message.notices?.map((notice) => (
        <NoticeLine key={notice.message} notice={notice} />
      ))}

      {message.trace && message.trace.length > 0 && <ToolTrace entries={message.trace} />}

      {/*
        The audit's evidence, beside the answer written from it.

        Above the prose on purpose: it is what the reader should have in hand
        while reading the paragraph, and the qualifiers it renders — confidence
        tier, the function a capability came from, the modifiers gating it — are
        exactly what a paragraph loses first. It renders only when the payload
        actually reached the browser (every live audit; a recorded one only on
        the BYOK path), because there is nothing honest to draw otherwise.
      */}
      <AuditCardIfAny trace={message.trace} />

      {message.stopped ? (
        <StoppedTurn />
      ) : message.error ? (
        message.error.transient ? (
          <TransientFault
            message={message.error.message}
            code={message.error.code}
            source={message.error.source}
            onRetry={onRetry}
          />
        ) : (
          <DefiniteFailure
            message={message.error.message}
            code={message.error.code}
            source={message.error.source}
          />
        )
      ) : (
        <div className="group border border-[#2a2a2a] bg-[#141414]">
          <AnswerStrip strippedClaims={message.strippedClaims} />
          {/* The copy control sits under the prose, never in the strip above
              it: the strip states whether the citation validator has been over
              this answer, and hanging a control off that line would make an
              assertion about the record look like a button. */}
          <div className="px-3.5 py-3.5">
            <div className="min-w-0">
              <Prose text={message.text} />
            </div>
            {/* `-ml-1.5` cancels the button's own padding so the glyph's left
                edge lines up with the prose above it rather than sitting a few
                pixels inside it. */}
            <div className="-ml-1.5 mt-1 flex">
              <CopyMessage text={message.text} />
            </div>
          </div>
          <StrippedClaims count={message.strippedClaims ?? 0} sentences={message.strippedText} />
          {message.trace && <ClientReadFooter entries={message.trace} />}
        </div>
      )}

      <AuditBadgeIfAny trace={message.trace} />

      {subject && foundNoVerdict(message.trace) && <RunAScan address={subject} />}
    </div>
  );
}

function AuditCardIfAny({ trace }: { trace?: TraceEntry[] }) {
  const audit = findAuditPayload(trace);
  if (!audit) return null;
  return <AuditCard value={audit.value} live={audit.live} />;
}

function AuditBadgeIfAny({ trace }: { trace?: TraceEntry[] }) {
  const scored = auditScored(trace);
  if (scored === undefined) return null;
  return <AdvisoryBadge scored={scored} />;
}

/**
 * The assistant's own voice.
 *
 * Neither tier is the brand's `#ccff00`: that is the SCORE colour, and prose
 * the model wrote must never borrow the one visual signal reserved for a number
 * the engine computed. Weight and size are off-limits for the same reason —
 * authority here is carried by display-scale Cinzel, not by hue.
 */
/*
 * TWO tiers, because one was unreadable.
 *
 * Setting every glyph in `#c9f24a` made the whole answer one flat wall of
 * saturated green: body, headings and emphasis all the same, so nothing could
 * be emphasis and a long answer had no shape at all. Saturated green at body
 * length is also just tiring to read — the colour that was meant to say
 * "machine output" ended up saying nothing, because everything said it.
 *
 * The signal survives without flooding every character. Hierarchy is carried by
 * SATURATION rather than hue: the body is off-white with a green cast, still
 * unmistakably not engine prose, and the saturated green is spent only on
 * headings, bold and code — where it now actually marks something.
 *
 * Measured rather than eyeballed, because "looks readable" is how the flat
 * version shipped. On `#141414`: body `#b4bba6` is 9.3:1 and accent `#c9f24a`
 * is 14.3:1 — both past AAA — and the two are 1.54:1 apart, which is what makes
 * bold read as bold. The first attempt at this used a lighter `#d3d8c6`; it
 * scored better in isolation (12.6:1) and was WORSE in practice, because at
 * 1.13:1 from the accent it had no separation left to spend on emphasis.
 *
 * The original constraint is untouched: neither tier is `#ccff00`. That is the
 * SCORE colour, and AI-authored prose must never wear it. Weight and size stay
 * off-limits too — authority belongs to display-scale Cinzel, not to hue.
 */
/** Body copy — the bulk of every answer. Recedes; readable at length. */
const AGENT_TEXT = "text-[#b4bba6]";
/** Headings, bold and inline code. Rare on purpose. */
const AGENT_ACCENT = "text-[#c9f24a]";

/**
 * Assistant prose.
 *
 * **Not a markdown renderer** — a deliberately closed subset: paragraphs, list
 * dashes, headings flattened to a small label, and inline `**bold**` / `` `code` ``.
 * Nothing here can produce a heading size, a colour, or a link.
 *
 * That ceiling is the point. A full markdown pipeline hands model output the
 * ability to choose its own typographic weight, which is exactly how an
 * AI-authored number ends up wearing a verdict number's authority. Bold at body
 * weight is emphasis; a display face is a claim, and only the engine gets one.
 *
 * The subset is not optional decoration either: the model does emit markdown
 * (measured — a live Gemini turn returned `**91**` and backticked addresses),
 * and rendering the asterisks literally is its own kind of dishonesty about
 * what the agent said.
 */
type ProseGroup = { kind: "heading" | "list" | "paragraph"; lines: string[] };

/**
 * Split assistant text into heading / list / paragraph runs.
 *
 * A heading is always exactly one line. Consecutive bullets become one list.
 * Everything else accumulates into a paragraph until a blank line, a heading,
 * or a bullet ends it — which is what lets a heading immediately followed by
 * body text render as two different things.
 */
function groupLines(text: string): ProseGroup[] {
  const groups: ProseGroup[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length) groups.push({ kind: "paragraph", lines: paragraph });
    paragraph = [];
  };

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (/^#{1,6}\s+/.test(line)) {
      flush();
      groups.push({ kind: "heading", lines: [line] });
      continue;
    }
    if (/^[-*•]\s+/.test(line)) {
      flush();
      const last = groups.at(-1);
      if (last?.kind === "list") last.lines.push(line);
      else groups.push({ kind: "list", lines: [line] });
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return groups;
}

function Prose({ text }: { text: string }) {
  if (!text.trim()) {
    return <p className="text-sm italic leading-relaxed text-[#6a6a6a]">No answer was returned.</p>;
  }
  return (
    <div className="flex flex-col gap-2.5">
      {/*
        Grouped LINE by line, not block by block.
        The block-level version tested `/^#{1,6}\s+/` against a whole
        blank-line-delimited chunk and, on a match, set the ENTIRE chunk in the
        small grey label face. Models do not reliably put a blank line after a
        heading, so one `### Heading` swallowed the paragraph under it — seen in
        the browser, a full LP-custody explanation rendered as unreadable grey
        micro-caps. A heading is one line; everything else is prose.
      */}
      {groupLines(text).map((group, index) => {
          if (group.kind === "list") {
            return (
              <ul key={index} className="flex flex-col gap-1.5">
                {group.lines.map((line) => (
                  <li key={line} className={`flex min-w-0 gap-2.5 break-words text-sm leading-relaxed ${AGENT_TEXT}`}>
                    <span className="mt-2 h-px w-2.5 flex-none bg-[#4d6a00]" />
                    <span>{inline(line.replace(/^\s*[-*•]\s+/, ""))}</span>
                  </li>
                ))}
              </ul>
            );
          }

          if (group.kind === "heading") {
            return (
              <div key={index} className={`${LABEL} pt-1 ${AGENT_ACCENT}`}>
                {group.lines[0].replace(/^#{1,6}\s+/, "").replace(/\*\*/g, "")}
              </div>
            );
          }

          const block = group.lines.join(" ");
          return (
            <p key={index} className={`break-words text-sm leading-relaxed ${AGENT_TEXT}`}>
              {inline(block)}
            </p>
          );
        })}
    </div>
  );
}

/** A full 0x address, anywhere in the prose — backticked by the model or not. */
const ADDRESS_RE = /(0x[0-9a-fA-F]{40})/;

/**
 * `**bold**`, `` `code` ``, and addresses — and nothing else.
 *
 * Split-and-map over React nodes rather than any HTML string, so there is no
 * path from model output to markup at all — the closed subset is enforced by
 * construction, not by escaping.
 *
 * **Addresses are recognised, not authored.** The model cannot emit a chip; it
 * can only mention an address, and this decides what an address looks like.
 * That is the same rule the scan link follows: a URL the model typed is a
 * claim, a control we rendered is a control. Matching is on the literal
 * 40-hex-digit form, so a truncated `0x736d…7f35` in prose stays plain text —
 * a chip that copied an abbreviation would be worse than no chip at all.
 */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).flatMap((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={index} className={`font-bold ${AGENT_ACCENT}`}>
          {withAddresses(part.slice(2, -2), index)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      const body = part.slice(1, -1);
      // A backticked address is still an address — render the chip rather than
      // a plain code span, so both spellings copy.
      if (ADDRESS_RE.test(body.trim())) {
        return <InlineAddressChip key={index} address={body.trim()} />;
      }
      return (
        <code
          key={index}
          className={`break-all border border-[#2a2a2a] bg-[#111811] px-1 py-0.5 font-mono text-[11px] ${AGENT_ACCENT}`}
        >
          {body}
        </code>
      );
    }
    return withAddresses(part, index);
  });
}

/** Bare addresses inside a run of plain text become chips; nothing else changes. */
function withAddresses(text: string, keyBase: number): ReactNode[] {
  return text.split(ADDRESS_RE).map((piece, i) =>
    ADDRESS_RE.test(piece) && piece.length === 42 ? (
      <InlineAddressChip key={`${keyBase}-${i}`} address={piece} />
    ) : (
      piece
    ),
  );
}

/**
 * The turn in flight.
 *
 * What is progressive here is the **trace**, not the prose: neither path streams
 * tokens (`llm.complete` is one non-streaming call, and all three BYOK adapters
 * build non-streaming requests). So this shows the reads landing one at a time —
 * which is the trust surface anyway — above an ARRIVING strip, and never renders
 * unchecked prose as though it had been through the validator.
 */
function LiveMessage({ live }: { live: LiveTurn }) {
  const inFlightClientTool =
    live.phase === "browser_reading"
      ? live.trace.filter((e) => e.locale === "client").at(-1)?.name
      : undefined;

  return (
    <div className="flex flex-col gap-2.5">
      {live.notices.map((notice) => (
        <NoticeLine key={notice.message} notice={notice} />
      ))}

      {live.trace.length > 0 && <ToolTrace entries={live.trace} live />}

      {live.phase === "browser_reading" && <ReadingTheChain tool={inFlightClientTool} />}

      <div className="border border-[#2a2a2a] bg-[#141414]">
        <AnswerStrip arriving />
        <div className="flex items-center gap-3 px-3.5 py-4">
          <PulseDots tone="#8a8a8a" />
          <span className={`${MONO} text-[11px] text-[#b4b4b4]`}>{PHASE_COPY[live.phase]}</span>
          {live.usage.outputTokens > 0 && (
            <span className={`${LABEL} ml-auto text-[#6a6a6a]`}>
              {live.usage.inputTokens.toLocaleString('en-US')} IN
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
