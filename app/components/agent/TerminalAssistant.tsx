"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { PlanView } from "@/lib/swap/types";
import type { FeedRow } from "@/lib/trade/trade-feed";
import type { TokenRecord } from "@/lib/types";
import type { TokenMarketData, TimeframePeriod } from "@/lib/trade/types";
import { buildTerminalContext } from "@/lib/agent/terminal-context";
import { RwaMarketBriefCard } from "@/app/components/rwa/RwaMarketBriefCard";
import { ChatPanel } from "./ChatPanel";
import { useRobinKnight } from "./useRobinKnight";

const TRADE_PERSONAS = ["trade_assistant", "interrogator", "historian"] as const;
const RWA_PERSONAS = ["rwa_analyst", "interrogator", "historian"] as const;

export interface TerminalAssistantActions {
  canDiscuss: boolean;
  ask: (prompt: string) => void;
  connect: () => void;
}

/** Shared assistant surface for the trade and RWA terminals. */
export function TerminalAssistant({
  token,
  record = null,
  kind = "trade",
  freshness,
  chartTimeframe,
  lastUpdatedAt,
  quote,
  transactions,
  onActionsReady,
}: {
  token: TokenMarketData;
  record?: TokenRecord | null;
  kind?: "trade" | "rwa";
  freshness?: string;
  chartTimeframe?: TimeframePeriod | string;
  lastUpdatedAt?: number | null;
  quote?: PlanView | null;
  transactions?: FeedRow[];
  onActionsReady?: (actions: TerminalAssistantActions | null) => void;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);
  const [seed, setSeed] = useState<{ text: string } | null>(null);
  const [connectRequest, setConnectRequest] = useState(0);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const assistantRef = useRef<HTMLDivElement | null>(null);
  const terminalContext = useMemo(
    () => buildTerminalContext(token, { kind, freshness, chartTimeframe, lastUpdatedAt, record, quote, transactions }),
    [token, kind, freshness, chartTimeframe, lastUpdatedAt, record, quote, transactions],
  );
  const allowedPersonas = kind === "rwa" ? RWA_PERSONAS : TRADE_PERSONAS;
  const state = useRobinKnight({
    subject: token.address,
    defaultPersona: kind === "rwa" ? "rwa_analyst" : "trade_assistant",
    terminalContext,
    allowedPersonas,
  });
  const canDiscussNews = !state.blocked && (state.mode === "our_models" || Boolean(state.byok?.apiKey));
  const bringAgentIntoView = useCallback(() => {
    if (!isDesktop) return;
    window.requestAnimationFrame(() => {
      const assistant = assistantRef.current;
      assistant?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      assistant?.focus({ preventScroll: true });
    });
  }, [isDesktop]);
  const askAgent = useCallback((text: string) => {
    setSeed({ text });
    setSheetOpen(true);
    bringAgentIntoView();
  }, [bringAgentIntoView]);
  const connectAgent = useCallback(() => {
    setConnectRequest((request) => request + 1);
    setSheetOpen(true);
    bringAgentIntoView();
  }, [bringAgentIntoView]);

  useEffect(() => {
    onActionsReady?.({ canDiscuss: canDiscussNews, ask: askAgent, connect: connectAgent });
    return () => onActionsReady?.(null);
  }, [onActionsReady, canDiscussNews, askAgent, connectAgent]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const sync = () => {
      setIsDesktop(media.matches);
      if (media.matches) setSheetOpen(false);
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!sheetOpen) return;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    const previousPaddingRight = root.style.paddingRight;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const scrollbar = window.innerWidth - root.clientWidth;
    root.style.overflow = "hidden";
    if (scrollbar > 0) root.style.paddingRight = `${scrollbar}px`;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSheetOpen(false);
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      const items = dialog?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!items?.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialogRef.current?.querySelector<HTMLElement>("button")?.focus();
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      root.style.overflow = previousOverflow;
      root.style.paddingRight = previousPaddingRight;
      previouslyFocused?.focus();
    };
  }, [sheetOpen]);

  const panel = (variant: "docked" | "sheet") => (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <ChatPanel
        state={state}
        variant={variant}
        subject={token.address}
        symbol={token.symbol}
        name={token.name}
        terminalKind={variant === "docked" ? kind : undefined}
        hideTerminalNews={kind === "rwa"}
        seed={seed}
        onSeedConsumed={() => setSeed(null)}
        onCollapse={variant === "sheet" ? () => setSheetOpen(false) : undefined}
        connectRequest={connectRequest}
      />
    </div>
  );

  if (isDesktop === null) return null;

  return (
    <>
      {isDesktop ? (
        <div ref={assistantRef} tabIndex={-1} className="flex h-[min(520px,65dvh)] min-h-[320px] min-w-0 flex-col outline-none">
          {panel("docked")}
        </div>
      ) : (
        <div ref={assistantRef} className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="flex w-full items-center justify-between border border-[#2a2a2a] bg-[#141414] px-4 py-3 text-left text-sm font-medium text-white hover:border-[#ccff00]"
          >
            <span>Open Robin Knight</span>
            <span aria-hidden="true" className="text-[#ccff00]">→</span>
          </button>
          {kind === "trade" && <RwaMarketBriefCard
            kind={kind}
            address={token.address}
            symbol={token.symbol}
            name={token.name}
            canDiscuss={state.mode === "our_models" || Boolean(state.byok?.apiKey)}
            onConnect={connectAgent}
            onAskAgent={askAgent}
          />}
        </div>
      )}
      {sheetOpen && typeof document !== "undefined" && createPortal(
        <div
          className="fixed inset-0 z-[70] bg-black/80 lg:hidden"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setSheetOpen(false);
          }}
        >
          <div
            ref={dialogRef}
            className="h-[100dvh] w-full bg-[#0f0f0f]"
            role="dialog"
            aria-modal="true"
            aria-label="Robin Knight"
            tabIndex={-1}
          >
            {panel("sheet")}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
