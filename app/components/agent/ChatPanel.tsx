"use client";

import { useEffect, useState } from "react";

import { canCompact, readContext } from "@/lib/agent/context-meter";
import { Composer, Openers } from "./Composer";
import { ConversationList } from "./ConversationList";
import { KeyEntry, ModeToggle, NoLineOut } from "./KeyEntry";
import { LABEL, MONO } from "./MessageStates";
import { OPENERS, PersonaPicker } from "./PersonaPicker";
import { Transcript } from "./Transcript";
import type { RobinKnightState } from "./useRobinKnight";
import { BASE_SWAP_TOKENS } from "@/lib/trade/tokens";
import { ROBINHOOD_CHAIN_ID } from "@/lib/config/chain";
import { RwaMarketBriefCard } from "@/app/components/rwa/RwaMarketBriefCard";

/**
 * One chat component, three placements.
 *
 * - `docked` — a right rail beside a verdict on `/scan/[address]`. The primary
 *   surface, and the one the design is built around: the verdict is the
 *   product, the rail narrates it.
 * - `standalone` — `/agent`, for open-ended questions, with the case-file list.
 * - `sheet` — the same thing as a mobile bottom sheet, where the score stays
 *   pinned above it.
 *
 * The panel never renders a number of its own at display scale. On `/scan` the
 * only large figure on screen is the verdict's, and that is deliberate: a user
 * who comes away thinking the AI decided the score has been misled about the
 * one thing this product sells.
 */

export type PanelVariant = "docked" | "standalone" | "sheet";

export function ChatPanel({
  state,
  variant,
  subject,
  seed = null,
  onSeedConsumed,
  connectRequest = 0,
  onCollapse,
  expanded,
  onToggleExpand,
  title,
  symbol,
  name,
  terminalKind,
  hideTerminalNews = false,
  hideHeader = false,
}: {
  state: RobinKnightState;
  variant: PanelVariant;
  subject?: string | null;
  symbol?: string;
  name?: string;
  /**
   * A question the host wants waiting in the field. Forwarded verbatim — the
   * decision to seed rather than send was already made by whoever set this
   * (see `openRobinKnight`), and re-deciding it here would give the page two
   * places to get "spend the user's key" wrong.
   */
  seed?: { text: string } | null;
  onSeedConsumed?: () => void;
  connectRequest?: number;
  onCollapse?: () => void;
  /**
   * Whether the host is currently rendering this panel full-screen.
   *
   * The panel does not size itself — it fills whatever box it is given, and
   * always has. What "full screen" means is the host's business: the docked rail
   * drops its 420px width, the standalone page drops its height clamp. Passing
   * the flag down anyway is what lets the header show the right icon and the
   * right label, so the control describes the state it will move you to rather
   * than a generic toggle.
   */
  expanded?: boolean;
  onToggleExpand?: () => void;
  title?: string;
  terminalKind?: "trade" | "rwa";
  hideTerminalNews?: boolean;
  hideHeader?: boolean;
}) {
  const [showKeyEntry, setShowKeyEntry] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  /** Persona and provider controls stay out of the way until requested. */
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (connectRequest > 0) setShowKeyEntry(true);
  }, [connectRequest]);

  /**
   * Escape leaves full screen, and does NOT close the panel.
   *
   * Full screen covers the nav, so it is the one state with no visible way out
   * except a control the reader has to find. Escape is what people already try.
   * It is deliberately scoped to expanded-only: bound unconditionally, the same
   * key would dismiss the docked rail mid-answer, and losing a conversation to a
   * reflex keystroke is worse than not having the shortcut.
   */
  useEffect(() => {
    if (!expanded || !onToggleExpand) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onToggleExpand();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, onToggleExpand]);

  const compact = variant !== "standalone";
  const messages = state.conversation?.messages ?? [];
  const busy = state.live !== null;
  /*
   * The meter tracks SERVER reads only.
   *
   * It used to count `trace.length` — every locale pooled — against the server
   * ceiling, which was right while one budget covered all three and is wrong
   * now that they are split. A client-side audit makes a dozen browser reads on
   * the user's own RPC; showing "12 / 8" would report a limit that was never
   * approached, on the one number the reader is being asked to trust.
   *
   * Browser reads are reported separately and without a bar, because they are
   * not the constraint: their cap exists to stop a runaway loop, not to ration
   * anything of ours.
   */
  const budgetMax = state.config?.maxToolCallsPerTurn ?? 8;
  const trace = state.live ? state.live.trace : (messages.at(-1)?.trace ?? []);
  const budgetUsed = trace.filter((entry) => entry.locale === "server").length;
  const freeUsed = trace.length - budgetUsed;

  /*
   * Context is measured off `transcript`, NOT `messages`.
   *
   * They are deliberately different: `messages` is what the page shows, and it
   * keeps turns the model was never given (that divergence is what
   * `MemoryStartsHere` exists to explain). `transcript` is the verbatim
   * model-facing state — tool results included, which is most of the weight.
   * Metering the visible list would under-report by whatever the tool results
   * cost, which is exactly the part the user cannot see and most needs told.
   */
  const transcript = state.conversation?.transcript ?? [];
  const context = transcript.length > 0 ? readContext(transcript) : null;
  const compactable = context !== null && canCompact(transcript, context);

  const needsKey = state.mode === "byok" && !state.byok?.apiKey;
  const noLineOut = needsKey && !showKeyEntry;
  const knownBaseToken = subject
    ? BASE_SWAP_TOKENS.find((token) => token.address.toLowerCase() === subject.toLowerCase())
    : undefined;
  const briefSymbol = symbol ?? knownBaseToken?.symbol ?? "TOKEN";
  const briefName = name ?? knownBaseToken?.name ?? (subject ? `Token ${subject.slice(0, 6)}…${subject.slice(-4)}` : "Token");

  const retry = () => {
    const lastQuestion = [...messages].reverse().find((m) => m.role === "user");
    if (lastQuestion) void state.send(lastQuestion.text);
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-[#0f0f0f]">
      {/*
        The key panel is its OWN window over the conversation, not a card inside
        it. Inline, it was a tall form wedged between the setup block and the
        transcript: it pushed the composer off-screen, it scrolled away from the
        button that opened it, and on a 420px rail the provider tabs and the key
        field ended up sharing space with a half-visible answer. Connecting a
        provider is a modal act — you are doing one thing — so it gets a modal
        surface, scrollable on its own and dismissed by DONE or the backdrop.
      */}
      {showKeyEntry && (
        <div className="absolute inset-0 z-20 flex flex-col bg-[#0a0a0a]/85">
          <button
            type="button"
            aria-label="Close the key panel"
            onClick={() => setShowKeyEntry(false)}
            className="flex-1"
          />
          <div className="max-h-[88%] flex-none overflow-y-auto border-t-2 border-[#2a2a2a] bg-[#0f0f0f] p-3">
            <KeyEntry
              settings={state.byok}
              // The list is the hook's, not this panel's — the composer's model
              // chip reads the same one, and it must not die when this closes.
              catalogue={state.models}
              error={state.modelsError}
              testing={state.modelsLoading}
              onTest={state.loadModels}
              // Persist and dismiss are separate on purpose — see KeyEntry.
              onSave={state.saveKey}
              onDone={() => setShowKeyEntry(false)}
              onForget={state.clearKey}
            />
          </div>
        </div>
      )}

      {/* Header */}
      {!hideHeader && <div className="flex flex-none items-center justify-between gap-2 border-b border-[#2a2a2a] bg-[#141414] px-4 py-3.5">
        <span className="font-cinzel text-base font-bold tracking-wider text-white">
          {title ?? "Robin Knight"}
        </span>
        <div className="flex items-center gap-1.5">
          {compact && (
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className={`${LABEL} border border-[#2a2a2a] bg-[#1c1c1c] px-2 py-1.5 text-[9px] text-[#b4b4b4] hover:text-[#ededea]`}
            >
              HISTORY {showHistory ? "▴" : "▾"}
            </button>
          )}
          {onToggleExpand && (
            /*
             * Full screen. Ghosted rather than solid, because it sits beside the
             * white close and two filled squares in a row read as a button
             * group with equal weight — and these are not equal: one changes
             * how you are reading, the other ends it.
             *
             * The icon shows the DESTINATION, not the current state: outward
             * arrows while docked, inward while expanded. A control labelled
             * with the state you are already in is the classic toggle
             * ambiguity, and it is worse here because the rail and the
             * full-screen panel look similar mid-conversation.
             */
            <button
              type="button"
              onClick={onToggleExpand}
              aria-pressed={Boolean(expanded)}
              aria-label={expanded ? "Exit full screen" : "Expand to full screen"}
              title={expanded ? "Exit full screen (Esc)" : "Expand to full screen"}
              className="flex h-7 w-7 flex-none items-center justify-center border border-[#2a2a2a] bg-[#1c1c1c] text-[#b4b4b4] transition-colors hover:border-[#ccff00] hover:text-[#ccff00]"
            >
              <svg viewBox="0 0 14 14" className="h-3.5 w-3.5" aria-hidden="true">
                {expanded ? (
                  /*
                   * Two diagonal arrows folding in from opposite corners.
                   *
                   * The obvious mirror of the expand glyph — four corner
                   * brackets turned inward — was tried and is unreadable at
                   * this size: its marks land ~2px apart around the centre and
                   * merge into a plus sign. Verified in the browser, which is
                   * the only place a 14px icon can be judged. Diagonals carry
                   * direction at any size because the line itself points.
                   */
                  <path
                    d="M13 1 L8.5 5.5 M8.5 5.5 L8.5 2 M8.5 5.5 L12 5.5 M1 13 L5.5 8.5 M5.5 8.5 L5.5 12 M5.5 8.5 L2 8.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="square"
                  />
                ) : (
                  // Outward: four corners pushing to the edges.
                  <path
                    d="M1 5 L1 1 L5 1 M9 1 L13 1 L13 5 M13 9 L13 13 L9 13 M5 13 L1 13 L1 9"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="square"
                  />
                )}
              </svg>
            </button>
          )}
          {onCollapse && (
            // A square white close, not a worded button. The header is the one
            // place the panel competes with the verdict for attention, and
            // "COLLAPSE →" was the widest thing in it — a word-sized control
            // for the least interesting action on the screen.
            <button
              type="button"
              onClick={onCollapse}
              aria-label={variant === "sheet" ? "Close the Robin Knight" : "Collapse the Robin Knight"}
              title={variant === "sheet" ? "Close" : "Collapse"}
              className="halftone-light flex h-7 w-7 flex-none items-center justify-center border-2 border-[#ededea] bg-[#ededea] text-[#0a0a0a] transition-colors hover:border-[#ccff00] hover:bg-[#ccff00]"
            >
              <svg viewBox="0 0 14 14" className="h-3 w-3" aria-hidden="true">
                <path
                  d="M1 1 L13 13 M13 1 L1 13"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="square"
                />
              </svg>
            </button>
          )}
        </div>
      </div>}

      {/*
        ONE scroll region: history, setup and the transcript all live inside it.

        They used to be `flex-none` siblings of the transcript's scroll box, so
        every one of them took its height off the top of the only part that
        could shrink. On `/scan` the panel is sized to the flags column beside
        it (~370px), which left the transcript 32px — and opening the persona
        picker's TOOLS list (setup grows to ~740px) drove it to zero and spilled
        the composer 600px past the panel's own border, over the page below.
        Measured in the browser, both states. The composer and the header are
        the only things outside this box now, so the panel can no longer be
        pushed out of shape by anything it contains.
      */}
      <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
      {compact && showHistory && (
        // `flex flex-col` here is load-bearing: ConversationList's own root is
        // `flex min-h-0 flex-1 flex-col` expecting a flex parent to clamp it to
        // `max-h-72` and hand its internal `overflow-y-auto` a real box to
        // scroll within. Without `flex` on this wrapper those classes are
        // inert, ConversationList sizes to its full (unbounded) content height,
        // and anything past 288px is silently clipped by `overflow-hidden`
        // rather than reachable by scrolling.
        <div className="flex max-h-72 flex-none flex-col overflow-hidden border-b border-[#2a2a2a]">
          <ConversationList
            conversations={state.conversations}
            activeId={state.conversation?.id ?? null}
            onOpen={(id) => {
              state.openConversation(id);
              setShowHistory(false);
            }}
            onDelete={(id) => void state.removeConversation(id)}
            onClearAll={() => void state.removeAll()}
            onNew={() => {
              state.startConversation();
              setShowHistory(false);
            }}
            showFooterActions={false}
          />
        </div>
      )}

      {state.historyError && (
        <div role="alert" className="flex flex-none flex-col gap-2 border-b border-[#3a3a3a] bg-[#141414] px-4 py-3">
          <p className="text-xs leading-relaxed text-[#d2d2d2]">{state.historyError}</p>
          {!state.historyMutationError && <div className="flex flex-wrap gap-2">
            {!state.historyConflict && (
              <button
                type="button"
                onClick={() => void state.retryConversationSave()}
                className="border border-[#3a3a3a] px-2 py-1 text-xs text-[#d2d2d2] hover:bg-[#202020]"
              >
                Retry save
              </button>
            )}
            {state.conversation && state.conversations.some((item) => item.id === state.conversation?.id) && (
              <button
                type="button"
                onClick={() => state.loadSavedVersion(state.conversation!.id)}
                className="border border-[#3a3a3a] px-2 py-1 text-xs text-[#d2d2d2] hover:bg-[#202020]"
              >
                Open saved chat
              </button>
            )}
            {state.conversation && (
              <button
                type="button"
                onClick={() => void state.saveConversationAsNew()}
                className="border border-[#3a3a3a] px-2 py-1 text-xs text-[#d2d2d2] hover:bg-[#202020]"
              >
                Save a copy
              </button>
            )}
          </div>}
        </div>
      )}

      {/* Advanced persona and provider controls stay collapsed until opened. */}
      {!settingsOpen && (
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          className="flex flex-none items-center justify-between gap-2 border-b border-[#2a2a2a] px-4 py-2.5 text-left hover:bg-[#141414]"
        >
          <span className={`${MONO} min-w-0 truncate text-[10px] text-[#8a8a8a]`}>
            {(
              state.personas.find((p) => p.name === state.persona)?.title ?? state.persona
            )
              .replace(/^The /, "")
              .toUpperCase()}
            {" · "}
            {state.mode === "byok" ? "YOUR KEY" : "OUR MODELS"}
          </span>
          <span className={`${LABEL} flex-none text-[#b4b4b4]`}>SETTINGS ▾</span>
        </button>
      )}

      {settingsOpen && (
      <div className="flex flex-none flex-col gap-3 border-b border-[#2a2a2a] px-4 py-3.5">
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={() => setSettingsOpen(false)}
            aria-label="Hide setup"
            className={`${LABEL} text-[#b4b4b4] hover:text-[#ccff00]`}
          >
            HIDE SETTINGS ▴
          </button>
        </div>
        <PersonaPicker
          personas={state.personas}
          active={state.persona}
          onPick={state.setPersona}
          compact={compact}
          bundle={state.personaBundle}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ModeToggle
            mode={state.mode}
            onChange={state.setMode}
            ourModelsEnabled={state.ourModelsEnabled}
          />
          {state.mode === "byok" && (
            // Green when a key is held, red when none is. BYOK is the only mode
            // that cannot work without an action from the reader, and the old
            // neutral grey made "connected" and "you cannot send anything yet"
            // look identical — on a surface whose composer is also disabled and
            // quiet about why.
            <button
              type="button"
              onClick={() => setShowKeyEntry((v) => !v)}
              className={`${LABEL} flex items-center gap-1.5 ${
                state.byok?.apiKey
                  ? "text-[#ccff00] hover:text-[#e4ff9a]"
                  : "text-[#ff5c5c] hover:text-[#ff8f8f]"
              }`}
            >
              <span
                className={`block h-1.5 w-1.5 flex-none ${
                  state.byok?.apiKey ? "bg-[#ccff00]" : "bg-[#ff5c5c]"
                }`}
              />
              {state.byok?.apiKey ? `KEY · ${state.byok.provider.toUpperCase()}` : "NO KEY CONNECTED"}
            </button>
          )}
        </div>
      </div>
      )}

      {/* Body */}
      {/* `grow shrink-0`, not `flex-1`: it must fill the leftover space when the
          conversation is short (the `mt-auto` footer below depends on that) and
          must never be shrunk below its content when the conversation is long —
          it has no scroll box of its own any more, the region above does. Two
          separate properties rather than the `flex` shorthand so neither can be
          undone by utility ordering. */}
      <div className="flex w-full min-w-0 shrink-0 grow flex-col gap-4 p-4">
        {state.configError && (
          <div className="border border-[#5a5a2a] bg-[#1a1a0e] px-3.5 py-3">
            <div className={`${LABEL} text-[#f5c433]`}>THE AGENT SERVICE DID NOT ANSWER</div>
            <p className="mt-2 text-[13px] leading-relaxed text-[#f5c433]">
              {state.configError} The verdict on this page is unaffected — it was produced by the
              scanner, not by the agent.
            </p>
          </div>
        )}

        {noLineOut && !state.configError && (
          <NoLineOut onConnect={() => setShowKeyEntry(true)} />
        )}

        {terminalKind && subject && !hideTerminalNews && (
          <RwaMarketBriefCard
            kind={terminalKind}
            address={subject}
            chainId={ROBINHOOD_CHAIN_ID}
            symbol={briefSymbol}
            name={briefName}
            canDiscuss={!needsKey && !state.blocked}
            onConnect={() => setShowKeyEntry(true)}
            onAskAgent={(prompt: string) => void state.send(prompt)}
          />
        )}

        {messages.length === 0 && !noLineOut && !showKeyEntry && !state.configError && (
          <Openers
            openers={OPENERS[state.persona] ?? []}
            onPick={(text) => void state.send(text)}
            columns={compact ? 1 : 2}
          />
        )}

        {messages.length > 0 && (
          <Transcript
            messages={messages}
            live={state.live}
            onRetry={retry}
            subject={subject ?? null}
          />
        )}
        {messages.length === 0 && state.live && (
          <Transcript messages={[]} live={state.live} subject={subject ?? null} />
        )}

        <div className="mt-auto flex items-center gap-2 pt-2">
          <span className="block h-1.5 w-1.5 bg-[#3d3d3d]" />
          <span className={`${MONO} text-[#a7aaa5]`}>
            HISTORY IS STORED IN THIS BROWSER ONLY
          </span>
        </div>
      </div>
      </div>

      {!needsKey && <Composer
        busy={busy}
        blocked={state.blocked}
        mode={state.mode}
        budgetUsed={budgetUsed}
        budgetMax={budgetMax}
        freeUsed={freeUsed}
        usage={state.live?.usage ?? messages.at(-1)?.usage ?? null}
        context={context}
        transcript={transcript}
        compacting={state.compacting}
        onCompact={compactable ? () => void state.compact() : undefined}
        byok={state.byok}
        models={state.models}
        modelsLoading={state.modelsLoading}
        modelsError={state.modelsError}
        onLoadModels={() => state.loadModels()}
        onChooseModel={state.chooseModel}
        onOpenKeyPanel={() => setShowKeyEntry(true)}
        seed={seed}
        onSeedConsumed={onSeedConsumed}
        placeholder={subject ? "Ask about this token…" : "Paste an address, or ask about a verdict…"}
        // Sending is the moment the reader stops configuring and starts
        // reading, so the setup block folds itself away — on a phone it is
        // most of the panel, and leaving it open pushes the answer the
        // question was asked for below the fold. The key overlay closes for
        // the same reason: it is modal over the transcript.
        onSend={(text) => {
          setSettingsOpen(false);
          setShowKeyEntry(false);
          void state.send(text);
        }}
        onStop={state.stop}
      />}
    </div>
  );
}
