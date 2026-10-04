"use client";

import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";

import { breakdownContext, type ContextBreakdown, type SliceKind } from "@/lib/agent/context-breakdown";
import type { ContextReading } from "@/lib/agent/context-meter";
import type { CanonicalMessage, ModelOption } from "@/lib/agent/providers";
import type { ByokSettings, ChatMode } from "@/lib/agent/types";
import { LABEL, MONO } from "./MessageStates";
import { useDismissable } from "./useDismissable";
import type { ModelCatalogue } from "./useRobinKnight";

/**
 * The two quick-access chips that sit with the composer: how full the context
 * is, and which model is about to spend the user's money.
 *
 * Both are **popovers over the composer, not panels in the flow**. The rail is
 * 420px and the phone is narrower; anything that pushes the text field down
 * moves the one control the reader is aiming at. Both close on Escape and on a
 * click anywhere outside, because a card that can only be dismissed by pressing
 * the same small chip again is a trap on a touch screen.
 */

/** Breathing room between a card and the edge of the screen. */
const EDGE_MARGIN = 8;

/**
 * Slide an open card back inside the viewport.
 *
 * A card anchored to its chip is correct until the chip is not where the design
 * assumed. Measured at 445px: the composer's status row wraps, the context chip
 * lands on the LEFT, and a card anchored to its right edge opens at `left:
 * -206` — entirely off screen, on the viewport where it is hardest to notice
 * something is missing. Anchoring the other way just moves the failure to the
 * other chip.
 *
 * So it is measured rather than guessed. `useLayoutEffect` runs before paint,
 * so the correction is never visible as a jump, and it re-measures on resize
 * because rotating a phone changes the answer.
 */
function useEdgeClamp(open: boolean): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState(0);

  const measure = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    // Measure the untranslated position, or each pass would compound the last.
    const rect = node.getBoundingClientRect();
    const left = rect.left - offset;
    const right = rect.right - offset;
    const width = document.documentElement.clientWidth;
    let next = 0;
    if (left < EDGE_MARGIN) next = EDGE_MARGIN - left;
    else if (right > width - EDGE_MARGIN) next = width - EDGE_MARGIN - right;
    // A card wider than the viewport cannot satisfy both edges; prefer the left
    // one, so it reads from its start rather than from its middle.
    if (next !== offset) setOffset(next);
  }, [offset]);

  // Setting state from a layout effect is the point here, not an oversight:
  // the correct offset is only knowable after the card is laid out, and doing
  // it before paint is what keeps the correction from being a visible jump.
  useLayoutEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (offset !== 0) setOffset(0);
      return;
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open, measure, offset]);

  // A tuple, not `{ref, style}`: reading `.ref` off a returned object in the
  // render body is what `react-hooks/refs` flags, and it is right to — the
  // shape invites reading `.current` there too.
  return [ref, offset];
}

const PRESSURE_COLOR: Record<ContextReading["pressure"], string> = {
  roomy: "#3d3d3d",
  filling: "#8a8a8a",
  tight: "#f5c433",
  over: "#ff5c5c",
};

const SLICE_COLOR: Record<SliceKind, string> = {
  tool: "#ccff00",
  user: "#6aa9ff",
  assistant: "#b4b4b4",
  structure: "#3d3d3d",
};

/**
 * Where the context went.
 *
 * The ring answers "how full", which decides whether to press COMPACT. This
 * answers "full of what", which decides whether COMPACT can help at all — a
 * conversation that is nine tenths one source read collapses, and one that is
 * nine tenths the user's own questions does not move however many times the
 * button is pressed. Saying so beats letting them find out by pressing it.
 */
function BreakdownCard({ reading, breakdown }: { reading: ContextReading; breakdown: ContextBreakdown }) {
  const total = Math.max(1, breakdown.totalTokens);
  const [clampRef, clampOffset] = useEdgeClamp(true);
  return (
    <div
      ref={clampRef}
      style={clampOffset ? { transform: `translateX(${clampOffset}px)` } : undefined}
      className="absolute bottom-full right-0 z-30 mb-2 w-[min(21rem,calc(100vw-1rem))] border-2 border-[#2a2a2a] bg-[#0f0f0f] p-3.5 shadow-[6px_6px_0_0_rgba(0,0,0,0.55)]"
    >
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className={`${LABEL} text-[#ededea]`}>WHAT THE MODEL IS CARRYING</span>
        <span className={`${MONO} text-[#b4b4b4]`}>
          {breakdown.totalTokens.toLocaleString('en-US')} / {reading.maxTokens.toLocaleString('en-US')}
        </span>
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-[#8a8a8a]">
        Carried into your next question — not what the last one cost.
      </p>

      {breakdown.slices.length === 0 ? (
        <p className="text-[12px] leading-relaxed text-[#b4b4b4]">
          Nothing yet. This fills up as you ask.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {breakdown.slices.map((slice) => {
            const pct = (slice.tokens / total) * 100;
            return (
              <li key={slice.key}>
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className={`${MONO} min-w-0 truncate ${
                      slice.kind === "structure" ? "text-[#6a6a6a]" : "text-[#dadada]"
                    }`}
                    title={slice.label}
                  >
                    {slice.label}
                  </span>
                  <span className={`${MONO} flex-none text-[#8a8a8a]`}>
                    {slice.tokens.toLocaleString('en-US')} · {pct < 1 ? "<1" : Math.round(pct)}%
                  </span>
                </div>
                <span className="mt-1 block h-1 w-full bg-[#1c1c1c]" aria-hidden>
                  <span
                    className="block h-full"
                    style={{
                      // Floor at a hairline so a real-but-tiny slice is visible
                      // as a mark rather than reading as absent.
                      width: `${Math.max(1.5, pct)}%`,
                      background: SLICE_COLOR[slice.kind],
                    }}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-3 border-t border-[#2a2a2a] pt-2.5 text-[11px] leading-relaxed text-[#8a8a8a]">
        {breakdown.recoverableTokens > 0 ? (
          <>
            COMPACT would free about{" "}
            <span className="text-[#ccff00]">
              {breakdown.recoverableTokens.toLocaleString('en-US')} tokens
            </span>{" "}
            by dropping old tool results. Every word of the conversation stays.
          </>
        ) : (
          "There is nothing COMPACT can free here — it only drops old tool results, and the most recent turns are always kept whole."
        )}
      </p>
    </div>
  );
}

/**
 * The ring, and the breakdown behind it.
 *
 * It shows `AGENT_MAX_HISTORY_TOKENS`, never the model's window — see
 * `lib/agent/context-meter.ts` for why that distinction is the whole point.
 *
 * A ring rather than more dots: the tool budget is a small integer the user can
 * count, and context is a continuous quantity they cannot. Drawing both the
 * same way would imply they are the same kind of limit.
 */
export function ContextChip({
  reading,
  transcript,
}: {
  reading: ContextReading;
  transcript: CanonicalMessage[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismissable(open, () => setOpen(false));

  const color = PRESSURE_COLOR[reading.pressure];
  const R = 6;
  const circumference = 2 * Math.PI * R;
  const label =
    reading.pressure === "over"
      ? reading.irreducible
        ? "TOO LONG TO SEND"
        : `${reading.wouldDrop} DROPPED`
      : `${Math.round(reading.fraction * 100)}%`;

  // Computed only while the card is open. It walks the whole transcript and
  // runs a trial compaction, which is cheap but not free, and it is pure detail
  // — nothing on the closed chip depends on it.
  const breakdown = open ? breakdownContext(transcript) : null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-2 border border-transparent px-1 py-0.5 hover:border-[#3d3d3d]"
        // Says what it measures, because it sits beside a much larger token
        // count and the two look contradictory otherwise. They are not: this is
        // what the NEXT turn still carries, and on our-models a turn's tool
        // results are not part of that. See `context-meter.ts`.
        title={
          `${reading.usedTokens.toLocaleString('en-US')} of ${reading.maxTokens.toLocaleString('en-US')} tokens — how much of ` +
          `this conversation the next answer will still be given. Not what the last turn cost. Click for the breakdown.`
        }
      >
        <span className={`${MONO} text-[#8a8a8a]`}>CONTEXT</span>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="flex-none">
          <circle cx="8" cy="8" r={R} fill="none" stroke="#2a2a2a" strokeWidth="2.5" />
          <circle
            cx="8"
            cy="8"
            r={R}
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeDasharray={`${circumference * reading.fraction} ${circumference}`}
            // Start the arc at 12 o'clock rather than 3, so a nearly-empty ring
            // reads as a gauge rather than as a rendering glitch.
            transform="rotate(-90 8 8)"
          />
        </svg>
        <span className={MONO} style={{ color: reading.pressure === "roomy" ? "#b4b4b4" : color }}>
          {label}
        </span>
      </button>
      {open && breakdown && <BreakdownCard reading={reading} breakdown={breakdown} />}
    </div>
  );
}

function shortModel(id: string): string {
  // Provider ids are long and front-loaded with the vendor, which the chip
  // already states. The tail is what distinguishes two choices.
  const trimmed = id.replace(/^models\//, "");
  return trimmed.length <= 28 ? trimmed : `…${trimmed.slice(-27)}`;
}

/**
 * Which model answers next, changeable without opening the key panel.
 *
 * The handshake panel stays exactly where it was — it is where a key is
 * connected, tested and forgotten, and that is a deliberate, modal act. This is
 * the other thing people do often: switch model mid-conversation because the
 * last answer was thin or the fast one is enough. Making that a five-click trip
 * through a modal was the whole complaint.
 *
 * **Under our-models there is nothing to pick.** The model is chosen inside the
 * FastAPI container and `/agent/config` does not publish which one — so the chip
 * says that plainly instead of rendering an empty list, which would read as a
 * list that failed to load.
 */
export function ModelChip({
  mode,
  byok,
  catalogue,
  loading,
  error,
  onLoad,
  onChoose,
  onOpenKeyPanel,
}: {
  mode: ChatMode;
  byok: ByokSettings | null;
  catalogue: ModelCatalogue | null;
  loading: boolean;
  error: string | null;
  onLoad(): Promise<ModelOption[] | null>;
  onChoose(id: string): void;
  onOpenKeyPanel(): void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismissable(open, () => setOpen(false));
  // Above the early returns: hook order may not depend on which chip state we
  // are in.
  const [clampRef, clampOffset] = useEdgeClamp(open);

  if (mode !== "byok") {
    return (
      <span
        className={`${MONO} text-[#6a6a6a]`}
        title="Our models run server-side, and the deployment picks which one. There is nothing to choose here."
      >
        MODEL · CHOSEN BY US
      </span>
    );
  }

  if (!byok?.apiKey) {
    return (
      <button
        type="button"
        onClick={onOpenKeyPanel}
        className={`${MONO} text-[#ff5c5c] hover:text-[#ff8f8f]`}
      >
        MODEL · NO KEY
      </button>
    );
  }

  // Same guard as the key panel: a list fetched for another provider describes
  // another key, and offering it here would produce picks that fail on the
  // first turn.
  const models = catalogue?.provider === byok.provider ? catalogue.models : null;

  const openList = () => {
    const next = !open;
    setOpen(next);
    // Demand-driven: nothing is fetched until the reader asks to see the list,
    // so the common case — arrive, ask a question, leave — spends no request
    // against their key at all.
    if (next && !models && !loading) void onLoad();
  };

  const sorted = models
    ? [...models].sort((a, b) =>
        a.toolSupport === b.toolSupport ? 0 : a.toolSupport === "known" ? -1 : 1,
      )
    : [];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={openList}
        aria-expanded={open}
        title={`${byok.provider} · ${byok.model || "no model picked"} — click to switch`}
        className={`${MONO} flex items-center gap-1.5 border border-transparent px-1 py-0.5 text-[#b4b4b4] hover:border-[#3d3d3d] hover:text-[#ededea]`}
      >
        <span className="block h-1.5 w-1.5 flex-none bg-[#ccff00]" aria-hidden />
        {byok.model ? shortModel(byok.model) : "PICK A MODEL"}
        <span className="text-[#6a6a6a]">{open ? "▾" : "▴"}</span>
      </button>

      {open && (
        <div
          ref={clampRef}
          style={clampOffset ? { transform: `translateX(${clampOffset}px)` } : undefined}
          className="absolute bottom-full left-0 z-30 mb-2 w-[min(22rem,calc(100vw-1rem))] border-2 border-[#2a2a2a] bg-[#0f0f0f] shadow-[6px_6px_0_0_rgba(0,0,0,0.55)]"
        >
          <div className="flex items-center justify-between gap-2 border-b border-[#2a2a2a] px-3 py-2.5">
            <span className={`${LABEL} text-[#ededea]`}>{byok.provider.toUpperCase()}</span>
            <span className={`${MONO} text-[#8a8a8a]`}>
              {loading
                ? "REACHING…"
                : models
                  ? `${models.filter((m) => m.toolSupport === "known").length}/${models.length} DO TOOLS`
                  : ""}
            </span>
          </div>

          {error && !loading && (
            <p className="border-b border-[#2a2a2a] bg-[#1a1a0e] px-3 py-2.5 text-[11px] leading-relaxed text-[#f5c433]">
              {error}
            </p>
          )}

          {/* A key with a model but no list is not an empty list. Show the model
              in force rather than a blank card — the reader needs to know what
              their key is about to spend even when the fetch failed. */}
          {!models && !loading && (
            <div className="px-3 py-3">
              <div className={`${MONO} break-all text-[#ededea]`}>{byok.model || "—"}</div>
              <p className="mt-2 text-[11px] leading-relaxed text-[#8a8a8a]">
                The list of models this key offers has not loaded.
              </p>
              <button
                type="button"
                onClick={() => void onLoad()}
                className={`${LABEL} mt-2.5 border border-[#3d3d3d] px-2 py-1 text-[#b4b4b4] hover:border-[#ccff00] hover:text-[#ededea]`}
              >
                TRY AGAIN
              </button>
            </div>
          )}

          {models && (
            <ul className="max-h-[min(18rem,45vh)] overflow-y-auto">
              {sorted.map((option) => {
                const active = option.id === byok.model;
                return (
                  <li key={option.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onChoose(option.id);
                        setOpen(false);
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[#141414] ${
                        active ? "bg-[#141414]" : ""
                      }`}
                    >
                      <span
                        className={`block h-1.5 w-1.5 flex-none ${active ? "bg-[#ccff00]" : "bg-transparent"}`}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className={`${MONO} block truncate ${active ? "text-[#ededea]" : "text-[#dadada]"}`}
                        >
                          {option.label}
                        </span>
                        {/* Offered, not hidden. Hiding a model somebody is
                            paying for produces a support ticket; a warned one
                            produces a decision. */}
                        {option.toolSupport === "unverified" && (
                          <span className={`${MONO} mt-0.5 block text-[#f5c433]`}>
                            TOOL SUPPORT UNVERIFIED
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onOpenKeyPanel();
            }}
            className={`${LABEL} w-full border-t border-[#2a2a2a] px-3 py-2.5 text-left text-[#8a8a8a] hover:text-[#ededea]`}
          >
            KEY SETTINGS →
          </button>
        </div>
      )}
    </div>
  );
}
