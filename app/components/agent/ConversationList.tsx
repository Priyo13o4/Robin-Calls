"use client";

import { useLayoutEffect, useState } from "react";

import type { Conversation } from "@/lib/agent/types";
import { download, toJson, toMarkdown } from "@/lib/agent/store";
import { LABEL, MONO } from "./MessageStates";
import { useDismissable } from "./useDismissable";

/**
 * Case files, held in this browser and nowhere else.
 *
 * The empty state and the footer both say so outright rather than hiding it in
 * a settings page: history does not follow the user to another device, and
 * clearing site data clears it. That is the deal (K3) and it is stated where a
 * user forms their expectation, not after they lose something.
 *
 * Export is a first-class affordance for the same reason. We hold nothing, so
 * downloading is the only way a conversation leaves this browser — and it
 * carries the transcript, not just the prose, because what the model was
 * actually given is what makes it a record.
 */

function relative(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "JUST NOW";
  if (minutes < 60) return `${minutes} MIN AGO`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} HR AGO`;
  const days = Math.round(hours / 24);
  return days === 1 ? "YESTERDAY" : `${days} DAYS AGO`;
}

/**
 * Per-case-file actions, behind a `⋯`.
 *
 * The two buttons used to sit on the row itself under
 * `opacity-0 group-hover:opacity-100`. That is two problems, not one style
 * choice: on a phone there is no hover, so EXPORT and DELETE were **entirely
 * unreachable** — and on a desktop, DELETE appeared under the cursor on the way
 * to opening a conversation. A permanent, obviously-a-menu affordance is
 * reachable by touch and puts the destructive action one deliberate step away.
 *
 * DELETE confirms. It is irreversible and we hold no copy — the same sentence
 * CLEAR ALL already has to say, for the same reason.
 */
function RowMenu({
  conversation,
  onDelete,
}: {
  conversation: Conversation;
  onDelete(id: string): void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismissable(open, () => setOpen(false));
  /**
   * Which way the menu opens.
   *
   * The list is an `overflow-y-auto` column, so an absolutely-positioned menu
   * on the LAST row is clipped by the scroll container rather than overflowing
   * it — the row is visible, the menu simply is not. Measured on open against
   * the scrolling ancestor rather than the viewport, because that box is what
   * actually clips.
   */
  const [flipUp, setFlipUp] = useState(false);
  useLayoutEffect(() => {
    if (!open) return;
    const node = ref.current;
    if (!node) return;
    let clipper = node.parentElement;
    while (clipper && getComputedStyle(clipper).overflowY !== "auto") {
      clipper = clipper.parentElement;
    }
    const bottom = (clipper ?? document.documentElement).getBoundingClientRect().bottom;
    // Measure-then-position: the answer is only knowable once the trigger is
    // laid out, and settling it before paint is what stops the menu appearing
    // in the wrong place for a frame.
    setFlipUp(node.getBoundingClientRect().bottom + MENU_HEIGHT > bottom);
  }, [open, ref]);

  return (
    <div className="relative flex-none" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Actions for ${conversation.title}`}
        title="Export or delete"
        className={`flex h-6 w-6 items-center justify-center border text-[#6a6a6a] hover:border-[#3d3d3d] hover:text-[#ededea] ${
          open ? "border-[#3d3d3d] text-[#ededea]" : "border-transparent"
        }`}
      >
        {/* Three dots, drawn rather than typed: the `⋯` glyph sits on the text
            baseline and its spacing is font-dependent, so it reads as a
            truncation mark next to a truncated title. */}
        <svg viewBox="0 0 16 4" className="h-1 w-4" aria-hidden="true">
          <circle cx="2" cy="2" r="1.6" fill="currentColor" />
          <circle cx="8" cy="2" r="1.6" fill="currentColor" />
          <circle cx="14" cy="2" r="1.6" fill="currentColor" />
        </svg>
      </button>

      {open && (
        <div
          className={`absolute right-0 z-30 w-36 border-2 border-[#2a2a2a] bg-[#0f0f0f] shadow-[5px_5px_0_0_rgba(0,0,0,0.55)] ${
            flipUp ? "bottom-full mb-1" : "top-full mt-1"
          }`}
        >
          <button
            type="button"
            onClick={() => {
              download(
                `robin-knight-${conversation.id.slice(0, 8)}.md`,
                toMarkdown(conversation),
                "text/markdown",
              );
              setOpen(false);
            }}
            className={`${LABEL} block w-full px-3 py-2.5 text-left text-[#b4b4b4] hover:bg-[#141414] hover:text-[#ccff00]`}
          >
            EXPORT
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              if (window.confirm(`Delete "${conversation.title}"? We hold no copy.`)) {
                onDelete(conversation.id);
              }
            }}
            className={`${LABEL} block w-full border-t border-[#2a2a2a] px-3 py-2.5 text-left text-[#ff5c5c] hover:bg-[#1a0e0e]`}
          >
            DELETE
          </button>
        </div>
      )}
    </div>
  );
}

/** Two rows at `py-2.5` plus the border — enough to decide which way to open. */
const MENU_HEIGHT = 82;

export function ConversationList({
  conversations,
  activeId,
  onOpen,
  onDelete,
  onClearAll,
  onNew,
  /**
   * The privacy disclosure + EXPORT ALL/CLEAR ALL row. Defaults on for the
   * case-file sidebar (`CaseFilesShell`), where there is room for it and it is
   * the only place those actions live. `ChatPanel`'s own compact HISTORY
   * dropdown turns it off — at `max-h-72` it was most of the box, it duplicated
   * the shorter "HISTORY IS STORED IN THIS BROWSER ONLY" line already in the
   * panel's footer, and CLEAR ALL is a destructive, browser-wide action that
   * has no business being one tap away from browsing history.
   */
  showFooterActions = true,
}: {
  conversations: Conversation[];
  activeId: string | null;
  onOpen(id: string): void;
  onDelete(id: string): void;
  onClearAll(): void;
  onNew(): void;
  showFooterActions?: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-none border-b border-[#2a2a2a] p-4">
        <button
          type="button"
          onClick={onNew}
          className={`${LABEL} halftone-light w-full border-2 border-[#ededea] bg-[#ededea] px-3 py-2.5 text-center text-[#0a0a0a]`}
        >
          NEW CASE FILE
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-4">
        <div className="flex items-center justify-between">
          <span className={`${LABEL} text-[#8a8a8a]`}>THIS BROWSER</span>
          <span className={`${MONO} text-[#6a6a6a]`}>
            {conversations.length} SAVED
          </span>
        </div>

        {conversations.length === 0 ? (
          <p className={`${MONO} leading-loose text-[#6a6a6a]`}>
            NOTHING SAVED YET. CONVERSATIONS ARE HELD IN THIS BROWSER — THEY DO NOT FOLLOW YOU TO
            ANOTHER DEVICE, AND CLEARING SITE DATA CLEARS THEM.
          </p>
        ) : (
          conversations.map((conversation) => (
            <div
              key={conversation.id}
              className={`flex items-start justify-between gap-2 border-l-2 bg-[#141414] px-3 py-2.5 ${
                conversation.id === activeId ? "border-[#ccff00]" : "border-[#2a2a2a]"
              }`}
            >
              <button
                type="button"
                onClick={() => onOpen(conversation.id)}
                className="flex min-w-0 flex-1 flex-col gap-1.5 text-left"
              >
                <span className="truncate text-xs leading-relaxed text-[#dadada]">
                  {conversation.title}
                </span>
                <span className={`${MONO} text-[9px] text-[#6a6a6a]`}>
                  {conversation.persona.replace(/_/g, " ").toUpperCase()} ·{" "}
                  {relative(conversation.updatedAt)}
                </span>
              </button>
              <RowMenu conversation={conversation} onDelete={onDelete} />
            </div>
          ))
        )}
      </div>

      {showFooterActions && (
        <div className="flex-none border-t border-[#2a2a2a] bg-[#0f0f0f] p-4">
          <p className={`${MONO} leading-loose text-[#8a8a8a]`}>
            Conversations are held in this browser. We store nothing, so they do not follow you to
            another device, and clearing site data clears them.
          </p>
          <div className="mt-2.5 flex gap-1.5">
            <button
              type="button"
              disabled={conversations.length === 0}
              onClick={() =>
                download(
                  `robin-knight-export-${new Date().toISOString().slice(0, 10)}.json`,
                  toJson(conversations),
                  "application/json"
                )
              }
              className={`${LABEL} flex-1 border border-[#2a2a2a] bg-[#1c1c1c] px-2 py-2 text-center text-[#b4b4b4] hover:text-[#ededea] disabled:opacity-40`}
            >
              EXPORT ALL
            </button>
            <button
              type="button"
              disabled={conversations.length === 0}
              onClick={() => {
                if (window.confirm("Delete every conversation in this browser? We hold no copy.")) {
                  onClearAll();
                }
              }}
              className={`${LABEL} flex-1 border border-[#3a0b0b] px-2 py-2 text-center text-[#ff5c5c] disabled:opacity-40`}
              style={{
                background:
                  "repeating-linear-gradient(135deg,#1a0505,#1a0505 6px,#2a0a0a 6px,#2a0a0a 12px)",
              }}
            >
              CLEAR ALL
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
