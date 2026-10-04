"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import type { ContextReading } from "@/lib/agent/context-meter";
import type { CanonicalMessage, ModelOption } from "@/lib/agent/providers";
import type { ByokSettings, CanonicalUsage, ChatMode } from "@/lib/agent/types";
import { ContextChip, ModelChip } from "./ComposerChips";
import { LABEL } from "./MessageStates";
import type { ModelCatalogue } from "./useRobinKnight";

/**
 * The composer, and the two indicators above it.
 *
 * **Budget.** Each turn allows a fixed number of tool calls
 * (`maxToolCallsPerTurn`, served by `/agent/config` — never hardcoded here,
 * because the ceiling is an operator dial). Subtle while there is headroom,
 * plain when it is reached: hitting the cap changes the answer, so the user is
 * told rather than left to wonder why a question got a partial reply.
 *
 * **Cost.** Under BYOK there is nothing to meter — the user's key, the user's
 * bill. Under our-models this shows tokens and says outright that metering is
 * not live yet, because inventing a credit balance for a system that does not
 * charge anything would be a number with no record behind it, which is the one
 * thing this UI must never render.
 *
 * **Model.** A chip under the field — the one setting people change often
 * enough that a trip through the modal key panel was the wrong price. The panel
 * is still where a key is connected, tested and forgotten; this only switches
 * which model that key spends. See `ComposerChips.tsx`.
 */

export function Composer({
  busy,
  blocked,
  mode,
  budgetUsed,
  budgetMax,
  freeUsed = 0,
  usage,
  context = null,
  transcript = [],
  compacting = false,
  onCompact,
  byok = null,
  models = null,
  modelsLoading = false,
  modelsError = null,
  onLoadModels,
  onChooseModel,
  onOpenKeyPanel,
  placeholder = "Ask about this verdict…",
  seed = null,
  onSeedConsumed,
  onSend,
  onStop,
}: {
  busy: boolean;
  blocked: string | null;
  mode: ChatMode;
  budgetUsed: number;
  budgetMax: number;
  /** Browser-locale reads this turn — the user's own RPC, not rationed. */
  freeUsed?: number;
  usage: CanonicalUsage | null;
  /** Null until the first turn — nothing to measure, so nothing is drawn. */
  context?: ContextReading | null;
  /**
   * The MODEL-facing transcript, for the breakdown behind the ring — not the
   * page's message list. They diverge deliberately (see `ChatPanel`), and
   * measuring the visible one would under-report by exactly the tool results
   * the reader cannot see and most needs told about.
   */
  transcript?: CanonicalMessage[];
  compacting?: boolean;
  /** Absent when compaction is not offered; the button is then not rendered. */
  onCompact?: () => void;
  byok?: ByokSettings | null;
  models?: ModelCatalogue | null;
  modelsLoading?: boolean;
  modelsError?: string | null;
  onLoadModels?: () => Promise<ModelOption[] | null>;
  onChooseModel?: (id: string) => void;
  onOpenKeyPanel?: () => void;
  placeholder?: string;
  /**
   * A question handed in from outside React's tree (a window event fired by the
   * page — see `openRobinKnight`). Applied on identity change, so the same
   * question asked twice still lands.
   */
  seed?: { text: string } | null;
  onSeedConsumed?: () => void;
  onSend(text: string): void;
  onStop(): void;
}) {
  const [text, setText] = useState("");
  const field = useRef<HTMLTextAreaElement | null>(null);

  /*
   * A seed replaces the field's contents, and stops there.
   *
   * It is never sent from here. The page that seeded it already decided against
   * sending (blocked, or a suggestion rather than a submission), and under BYOK
   * a send is the user's own key being spent — so the last press is theirs. The
   * field takes focus because the question is meant to be edited or sent, not
   * admired.
   */
  useEffect(() => {
    if (!seed) return;
    // The seed arrives from a window event fired by another component, so there
    // is no render-time source for `text` to be derived from instead.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setText(seed.text);
    field.current?.focus();
    onSeedConsumed?.();
  }, [seed, onSeedConsumed]);
  const atCap = budgetUsed >= budgetMax && budgetMax > 0;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || blocked || !text.trim()) return;
    onSend(text);
    setText("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit(event);
    }
  }

  return (
    <div className="border-t-2 border-[#2a2a2a] bg-[#141414] px-4 pb-4 pt-3">
      {atCap && (
        <p role="status" className="mb-2 text-xs leading-relaxed text-[#f5c433]">
          Tool limit reached · {budgetUsed}/{budgetMax}. This reply may be incomplete.
        </p>
      )}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          <span
            role="status"
            aria-label={`${budgetUsed} of ${budgetMax} server tool reads used this turn`}
            className={atCap ? "text-[#f5c433]" : "text-[#b4b4b4]"}
          >
            Tools {budgetUsed}/{budgetMax}
          </span>
          {context && <ContextChip reading={context} transcript={transcript} />}
          {onCompact && (
            <button
              type="button"
              onClick={onCompact}
              disabled={busy || compacting}
              className="border border-[#3d3d3d] px-2 py-1 text-[#d0d2ce] hover:border-[#ccff00] hover:text-white disabled:cursor-not-allowed disabled:border-[#2a2a2a] disabled:text-[#777]"
            >
              {compacting ? "Compacting…" : "Compact"}
            </button>
          )}
        </div>
        <details className="min-w-0 text-[#d0d2ce]">
          <summary className="cursor-pointer underline decoration-[#555] underline-offset-2 hover:text-white">
            Usage details
          </summary>
          <div className="mt-2 border border-[#3d3d3d] bg-[#101010] p-3 text-xs leading-relaxed text-[#d0d2ce]">
            <p>Server tools {budgetUsed}/{budgetMax}; the limit may shorten replies.</p>
            <p className="mt-1">Browser tools {freeUsed}; no AI key needed.</p>
            <p className="mt-1">
              {mode === "byok"
                ? "AI requests are billed by your selected provider."
                : usage
                  ? `Our-model usage: ${usage.inputTokens.toLocaleString("en-US")} in / ${usage.outputTokens.toLocaleString("en-US")} out tokens; credit metering is off.`
                  : "Our-model credit metering is off."}
            </p>
          </div>
        </details>
      </div>

      {context?.pressure === "over" && (
        <div className="mb-2 border border-[#5a2a2a] bg-[#1a0e0e] px-3 py-2 text-xs leading-relaxed text-[#ffaaaa]">
          {context.irreducible
            ? "This conversation exceeds the context limit. Start a new case file to continue."
            : `The next reply will omit the ${context.wouldDrop} oldest messages. Compact or start a new case file to keep more context.`}
        </div>
      )}

      <form onSubmit={submit} className="flex items-stretch">
        <textarea
          ref={field}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          disabled={Boolean(blocked)}
          placeholder={blocked ?? placeholder}
          aria-label="Ask the Robin Knight"
          className="min-w-0 flex-1 resize-none border-2 border-[#2a2a2a] bg-[#1c1c1c] px-3.5 py-3 text-sm leading-relaxed text-[#ededea] outline-none placeholder:text-[#6a6a6a] focus:border-[#ccff00] disabled:cursor-not-allowed"
        />
        {busy ? (
          <button
            type="button"
            onClick={onStop}
            className={`${LABEL} flex items-center border-2 border-[#2a2a2a] bg-[#1c1c1c] px-5 text-[#ededea] hover:border-[#3d3d3d]`}
          >
            STOP
          </button>
        ) : (
          <button
            type="submit"
            disabled={Boolean(blocked) || !text.trim()}
            className={`${LABEL} flex items-center border-2 border-[#ededea] bg-[#ededea] px-5 text-[#0a0a0a] disabled:border-[#2a2a2a] disabled:bg-[#1c1c1c] disabled:text-[#3d3d3d]`}
          >
            SEND
          </button>
        )}
      </form>

      <div className="mt-2 flex flex-wrap items-start justify-start gap-x-3 gap-y-1">
        {onChooseModel && onLoadModels && onOpenKeyPanel ? (
          <ModelChip
            mode={mode}
            byok={byok}
            catalogue={models}
            loading={modelsLoading}
            error={modelsError}
            onLoad={onLoadModels}
            onChoose={onChooseModel}
            onOpenKeyPanel={onOpenKeyPanel}
          />
        ) : null}
      </div>
    </div>
  );
}

/** Persona-specific openers, offered before the first question. */
export function Openers({
  openers,
  onPick,
  columns = 1,
}: {
  openers: string[];
  onPick(text: string): void;
  columns?: 1 | 2;
}) {
  if (openers.length === 0) return null;
  return (
    <div>
      <div className={`${LABEL} mb-2.5 text-[#8a8a8a]`}>START HERE</div>
      <div className={columns === 2 ? "grid gap-2 sm:grid-cols-2" : "flex flex-col gap-2"}>
        {openers.map((opener) => (
          <button
            key={opener}
            type="button"
            onClick={() => onPick(opener)}
            className="border border-[#2a2a2a] bg-[#141414] px-3 py-2.5 text-left text-[13px] leading-relaxed text-[#dadada] hover:border-[#ccff00] hover:text-[#ededea]"
          >
            {opener}
          </button>
        ))}
      </div>
    </div>
  );
}
