"use client";

import { useEffect, useState } from "react";

import { ChatPanel } from "./ChatPanel";
import { ConversationList } from "./ConversationList";
import { MONO } from "./MessageStates";
import type { RobinKnightState } from "./useRobinKnight";

/**
 * The case-file sidebar + standalone chat, as `/robin-knight` (`AgentPageClient`)
 * renders it — extracted so a full-screen expansion from anywhere else (the
 * docked rail, the slot on `/scan`) gets the SAME workspace rather than the
 * narrow `docked` panel just stretched to fill the viewport. Full screen is
 * asked for when 420px stopped being enough; landing back in a single 420px-
 * shaped column with more air around it does not answer that.
 *
 * The caller owns the outer positioning (fixed overlay vs. in-page column) —
 * this is only the sidebar/section pair, so both the standalone page's clamped
 * layout and a full-screen portal can wrap it differently.
 */
/**
 * The full-screen wrapper, shared by every surface that expands into this
 * workspace — `/robin-knight` and the dock's expansion on `/scan` and `/rwa`.
 *
 * A constant rather than two identical strings because "expanding from a
 * verdict lands you in the Robin Knight page's full screen" is a claim about
 * sameness, and two copies of a class list is exactly how that claim stops
 * being true without anyone noticing. `flex flex-col` is load-bearing, not
 * decoration: `CaseFilesShell` is `min-h-0 flex-1`, which is inert in a block
 * parent — the shell then sizes to its content, `lg:h-full` on the section
 * resolves against an auto height, and the panel collapses instead of filling
 * the screen.
 */
export const CASE_FILES_FULLSCREEN =
  "fixed inset-0 z-50 flex w-full flex-col gap-0 bg-[#0a0a0a] lg:flex-row";

export function CaseFilesShell({
  state,
  expanded,
  onToggleExpand,
  subject,
  seed,
  onSeedConsumed,
  onCollapse,
}: {
  state: RobinKnightState;
  expanded: boolean;
  onToggleExpand: () => void;
  subject?: string | null;
  seed?: { text: string } | null;
  onSeedConsumed?: () => void;
  onCollapse?: () => void;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const toggleCaseFiles = () => {
    setSidebarOpen((v) => !v);
    setDrawerOpen((v) => !v);
  };

  /*
   * Full screen locks the document behind it — here rather than at each of the
   * four call sites, so no surface can expand and forget it. Without the lock a
   * wheel over any non-scrolling part of the overlay scrolls the verdict page
   * underneath, and exiting drops the reader somewhere they never navigated to.
   * `documentElement`, not `body`: an `overflow` on `<body>` here once killed
   * every `position: sticky` in the app, including the nav and the sidebar.
   */
  useEffect(() => {
    if (!expanded) return;
    const root = document.documentElement;
    const previous = { overflow: root.style.overflow, paddingRight: root.style.paddingRight };
    // Hiding the overflow also removes the scrollbar, which widens the viewport
    // by its own width and reflows the whole page under the overlay — invisible
    // while covered, a visible jolt the moment you exit. Hold the width with
    // exactly the padding the scrollbar was occupying. Zero on overlay
    // scrollbars (macOS, mobile), so this is a no-op where there is no gutter.
    const gutter = window.innerWidth - root.clientWidth;
    root.style.overflow = "hidden";
    if (gutter > 0) root.style.paddingRight = `${gutter}px`;
    return () => {
      root.style.overflow = previous.overflow;
      root.style.paddingRight = previous.paddingRight;
    };
  }, [expanded]);

  const [isDesktop, setIsDesktop] = useState(true);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const sync = () => setIsDesktop(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  const caseFilesShown = isDesktop ? sidebarOpen : drawerOpen;

  return (
    // `bg-[#0a0a0a]` here, not left to callers: `/robin-knight` and the desktop
    // inline expansion both happen to wrap this in their own opaque div, but
    // the mobile sheet and the desktop `<aside>` fallback drop it straight in.
    // Without its own background, the header row between `aside` and `section`
    // (and any gap `ChatPanel`'s own `bg-[#0f0f0f]` doesn't reach) is
    // transparent — the page behind shows through, "full screen" doesn't read
    // as full screen, and CASE FILES blends into whatever's behind it.
    <div className="flex min-h-0 w-full flex-1 flex-col gap-0 bg-[#0a0a0a] lg:flex-row">
      {drawerOpen && (
        <button
          type="button"
          aria-label="Close case files"
          onClick={toggleCaseFiles}
          className="fixed inset-0 z-30 bg-[#0a0a0a]/70 backdrop-blur-sm lg:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[86%] max-w-[340px] min-h-0 flex-col overflow-y-auto border-r border-[#2a2a2a] bg-[#0f0f0f] transition-transform duration-200 ease-out lg:static lg:z-auto lg:h-full lg:w-[272px] lg:max-w-none lg:flex-none lg:translate-x-0 lg:overflow-visible lg:transition-none ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        } ${sidebarOpen ? "lg:flex" : "lg:hidden"}`}
      >
        <ConversationList
          conversations={state.conversations}
          activeId={state.conversation?.id ?? null}
          onOpen={(id) => {
            state.openConversation(id);
            setDrawerOpen(false);
          }}
          onDelete={(id) => void state.removeConversation(id)}
          onClearAll={() => void state.removeAll()}
          onNew={() => {
            state.startConversation();
            setDrawerOpen(false);
          }}
        />
      </aside>

      <section
        className={`flex min-w-0 flex-1 flex-col border-[#2a2a2a] lg:h-full lg:min-h-0 lg:border-x ${
          expanded ? "min-h-0" : "min-h-[70vh]"
        }`}
      >
        <div className="flex flex-none flex-wrap items-center justify-between gap-3 border-b border-[#2a2a2a] px-4 py-3.5">
          <span className="flex items-center gap-3">
            <button
              type="button"
              onClick={toggleCaseFiles}
              aria-expanded={caseFilesShown}
              className="brutalist-box brutalist-shadow-dark brutalist-pressable halftone-light flex-none cursor-pointer border-[#ededea] bg-[#ededea] px-3 py-1.5 font-inter text-[10px] font-bold uppercase tracking-[0.18em] text-[#0a0a0a]"
            >
              {caseFilesShown ? "◧ CASE FILES" : "▶ CASE FILES"}
            </button>
            <span className={`${MONO} text-[#8a8a8a]`}>
              ROBINHOOD CHAIN · ID 4663
              {state.config ? ` · PROMPT v${state.config.promptVersion}` : ""}
            </span>
          </span>
          <span className="font-serif text-sm italic text-[#b4b4b4]">
            A knowledgeable associate. Careful about what it actually knows.
          </span>
        </div>
        <div className="min-h-0 flex-1">
          <ChatPanel
            state={state}
            variant="standalone"
            subject={subject}
            seed={seed}
            onSeedConsumed={onSeedConsumed}
            expanded={expanded}
            onToggleExpand={onToggleExpand}
            onCollapse={onCollapse}
          />
        </div>
      </section>
    </div>
  );
}
