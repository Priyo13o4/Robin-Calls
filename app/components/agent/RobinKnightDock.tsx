"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { CASE_FILES_FULLSCREEN, CaseFilesShell } from "./CaseFilesShell";
import { ChatPanel } from "./ChatPanel";
import { LABEL, MONO } from "./MessageStates";
import { useRobinKnight } from "./useRobinKnight";

/**
 * The Robin Knight docked beside a verdict.
 *
 * Desktop: a 420px right rail, collapsible to a spine. Mobile: a bottom sheet
 * that peeks, because **the verdict is still the product on a phone** — the
 * sheet never takes the whole screen and the score stays visible above it.
 *
 * The rail is `fixed` and pads `<main>` rather than joining the page's flow on
 * purpose: `/scan/[address]` renders its verdict through a client-side scan
 * (`ScanForm`), and threading panel state through that component would couple
 * the narrator to the engine's rendering path. The panel needs one thing from
 * the page — the address — and takes it from the route.
 *
 * That is also what makes it portable. Any page with a subject address can mount
 * it (`/scan`, `/rwa/[address]`) with no per-page wiring: it reads the record
 * itself through the same public tools anyone else can call, so the host page
 * never has to hand it data — and can never accidentally hand it data the
 * scanner did not produce.
 */
/**
 * The event any page element can fire to open the rail.
 *
 * A window event rather than a context provider or a lifted `open` prop,
 * because the callers are on the other side of a server-component boundary:
 * `/scan/[address]` renders `VerdictView` through a client-side scan and mounts
 * this dock as a sibling, so there is no shared React tree to thread state
 * through. One event, no provider, no prop drilling through the engine's own
 * rendering path — which is the same reason the dock takes only an address.
 */
const OPEN_EVENT = "robin-knight:open";

interface OpenRequest {
  question?: string;
  send?: boolean;
}

/**
 * Open the docked Robin Knight from anywhere on the page.
 *
 * `question` pre-fills the composer. `send` asks for it to go straight out —
 * honoured only when the panel is not `blocked`, because under BYOK a send is
 * the user's own key being spent and a page element must not spend it on their
 * behalf. Blocked, the question is seeded instead and waits for a press.
 *
 * Typed as two positional scalars rather than an options object so that
 * `onClick={openRobinKnight}` fails at `tsc` instead of quietly passing a
 * synthetic mouse event as the request.
 */
export function openRobinKnight(question?: string, send = false): void {
  const detail: OpenRequest = { question, send };
  window.dispatchEvent(new CustomEvent<OpenRequest>(OPEN_EVENT, { detail }));
}

const STATE_EVENT = "robin-knight:state";

/**
 * Subscribe to whether the dock is currently open (rail out, sheet up —
 * whatever the viewport's form of "open" is).
 *
 * Exists so a page element that offers its own way in — `RobinKnightPreview`'s
 * teaser box — can get out of the way once the real panel is showing. Two
 * boxes both headed "THE ROBIN KNIGHT" on screen at once read as two separate
 * chats; only one of them ever had a transcript. Fires the current state
 * immediately (always `false` on a fresh subscribe — nothing renders open on
 * first paint) and again on every open/close. Returns the unsubscribe.
 */
export function onRobinKnightOpenChange(callback: (open: boolean) => void): () => void {
  callback(false);
  const heard = (event: Event) => callback((event as CustomEvent<boolean>).detail);
  window.addEventListener(STATE_EVENT, heard);
  return () => window.removeEventListener(STATE_EVENT, heard);
}

/**
 * Where the dock should render itself IN, instead of as a `fixed` rail pinned
 * to the viewport edge — a tiny external store, read with
 * `useSyncExternalStore` rather than a window event.
 *
 * `RobinKnightSlot` announces a DOM node inside the verdict's own right
 * column — the empty space `RobinKnightPreview` vacates once the panel opens.
 * The alternative, a `fixed` panel tracking a scrolling column's position,
 * would have to recompute its offset on every scroll frame to avoid drifting
 * off the content it is meant to sit over, and padding `<main>` to make room
 * for it moves the ENTIRE page's content sideways for a box that only needed
 * to occupy space that already existed. A portal into the slot's own node
 * sidesteps both: it is normal document flow the instant it lands, sized and
 * positioned by CSS Grid like any other column content.
 *
 * `null` withdraws the offer — the host unmounted, or never had a slot to
 * begin with — and the dock falls back to its default fixed rail. Pages that
 * never call this (`/rwa/[address]`) are unaffected; `slot` just stays null.
 *
 * `useSyncExternalStore`, not a `useEffect` + window event, because
 * `RobinKnightSlot` announces from its own mount effect and React runs a
 * CHILD's effects before a later sibling's — `RobinKnightSlot` sits inside
 * `VerdictView`, which mounts before the page's separate `RobinKnightDock`,
 * so a plain event dispatched on mount fires before the dock's listener
 * exists to hear it. `useSyncExternalStore` is specified to re-read the
 * snapshot immediately after subscribing specifically to catch a change that
 * landed in that gap, which is exactly this gap.
 */
let latestSlot: HTMLElement | null = null;
const slotListeners = new Set<() => void>();

export function announceRobinKnightSlot(node: HTMLElement | null): void {
  latestSlot = node;
  for (const listener of slotListeners) listener();
}

function subscribeSlot(listener: () => void): () => void {
  slotListeners.add(listener);
  return () => slotListeners.delete(listener);
}

function getSlotSnapshot(): HTMLElement | null {
  return latestSlot;
}

function getSlotServerSnapshot(): null {
  return null;
}

const SUBJECT_EVENT = "robin-knight:subject";

/**
 * Tell the dock which address is currently on screen.
 *
 * Needed because a verdict can appear at a URL that does not name it. `/scan`
 * (no address) runs the pipeline client-side and swaps its own form out for a
 * `VerdictView` — the App Router never re-renders, `page.tsx` never learns an
 * address, and `replaceState` only rewrites the bar. So the rail was present on
 * `/scan/0x…` and `/rwa/0x…` and **absent on the one path most people actually
 * take**: paste an address into the box and press scan.
 *
 * Announced from `VerdictView`, which is the component that exists exactly when
 * a verdict is on screen — both the streaming and the cached branch, and every
 * route — rather than from either of ScanForm's two success paths, only one of
 * which even rewrote the URL.
 */
/**
 * `null` WITHDRAWS the subject, and that direction is load-bearing.
 *
 * `/scan` renders the verdict inline, so scanning a second token unmounts
 * `VerdictView` and returns the page to the bare form. The slot withdraws, but
 * without this the dock kept the previous token as its subject and stayed OPEN
 * — leaving the fixed 420px rail over the scan form, still scoped to a token no
 * longer on screen, with `<main>` padded to make room for it.
 */
export function announceRobinKnightSubject(address: string | null): void {
  window.dispatchEvent(new CustomEvent(SUBJECT_EVENT, { detail: address }));
}

export function RobinKnightDock({
  address,
  persona,
}: {
  /**
   * The subject, when the route already knows it. Omit on `/scan`, where it
   * arrives later via `announceRobinKnightSubject`.
   */
  address?: string;
  /**
   * Which persona this page opens on — a default, never a lock. `/rwa` opens on
   * the RWA Analyst because that is what the page is about, and the user can
   * still switch: the allowlist is enforced server-side either way, so nothing
   * here is a security boundary.
   */
  persona?: string;
}) {
  const [open, setOpen] = useState(false);
  const [wide, setWide] = useState(false);
  /**
   * Full screen: the rail stops being a rail.
   *
   * A 420px column is right for reading a paragraph beside the verdict it is
   * about, and wrong for a live contract audit — six capabilities, each with a
   * list of function signatures, wrapping every few words. Rather than widen the
   * rail (which would displace more of the page for everyone, all the time),
   * the reader can take the whole viewport for as long as they need it.
   *
   * Not persisted. This is a per-answer posture, not a preference: the next
   * question is usually a one-liner again.
   */
  const [expanded, setExpanded] = useState(false);
  const [subject, setSubject] = useState<string | null>(address ?? null);
  /**
   * A question handed in by the page, waiting in the composer.
   *
   * Object identity is the signal — a fresh object means "seed again", so
   * asking the same question twice still lands. Null once the panel has it.
   */
  const [seed, setSeed] = useState<{ text: string } | null>(null);
  /** A page-offered place to render in, from `announceRobinKnightSlot`. */
  const slot = useSyncExternalStore(subscribeSlot, getSlotSnapshot, getSlotServerSnapshot);
  const state = useRobinKnight({ subject: subject ?? undefined, defaultPersona: persona });

  // The open listener is registered once and must not close over a stale
  // `state` — `blocked` and `send` both change every turn.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  useEffect(() => {
    if (address) setSubject(address);
  }, [address]);

  useEffect(() => {
    const heard = (event: Event) => {
      const next = (event as CustomEvent<string | null>).detail;
      if (next === null) {
        // Close too: the panel is scoped to a subject, so an open panel with no
        // subject would spring back the moment the next verdict lands, on a
        // viewport that may not be the one it was opened on.
        setSubject(null);
        setOpen(false);
        return;
      }
      if (typeof next === "string" && /^0x[0-9a-fA-F]{40}$/.test(next)) {
        setSubject(next.toLowerCase());
      }
    };
    window.addEventListener(SUBJECT_EVENT, heard);
    return () => window.removeEventListener(SUBJECT_EVENT, heard);
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1280px)");
    const sync = () => setWide(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const open = (event: Event) => {
      setOpen(true);
      const request = (event as CustomEvent<OpenRequest>).detail ?? {};
      const question = request.question?.trim();
      if (!question) return;
      const current = stateRef.current;
      // Blocked means no key is connected: there is nothing to send with, and
      // seeding is the only honest outcome.
      if (request.send && !current.blocked) {
        void current.send(question);
        return;
      }
      setSeed({ text: question });
    };
    window.addEventListener(OPEN_EVENT, open);
    return () => window.removeEventListener(OPEN_EVENT, open);
  }, []);

  // Broadcasts for `onRobinKnightOpenChange`. The cleanup fires `false` on
  // unmount too — if this dock goes away mid-conversation (subject cleared),
  // nothing should be left believing the panel is still open.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent<boolean>(STATE_EVENT, { detail: open }));
    return () => {
      window.dispatchEvent(new CustomEvent<boolean>(STATE_EVENT, { detail: false }));
    };
  }, [open]);

  /**
   * The rail displaces `<main>`, NOT `<body>`, and starts below the nav.
   *
   * Padding the body squeezed `SiteNav` into a narrower box while its own
   * breakpoints still saw a wide viewport, so nine nav links kept rendering and
   * collided with the wordmark. Seen at 1440 in the browser, which is the width
   * the design targets. Shifting `<main>` alone leaves the nav at full width and
   * intact — and matches the design canvas, where the header bar spans the page
   * and the rail hangs beneath it.
   *
   * The mobile sheet floats over everything instead; nothing to displace.
   */
  /**
   * A slot means the panel renders IN the page (see `announceRobinKnightSlot`)
   * — it occupies space the column already reserved, not space carved out of
   * `<main>` afterward. `inline` gates both the padding-right hack below and
   * which JSX branch owns the panel.
   */
  const inline = wide && slot !== null;

  /**
   * Inline means consistently mounted, not click-to-open — the desktop slot
   * has no button that opens it (`RobinKnightSlot` dropped its own copy of
   * that control), so something has to. Fires once, the moment a slot
   * arrives on a wide viewport; a later manual collapse is not fought,
   * because this only re-runs when `inline` itself changes, not on every
   * render — the same one-shot-sync shape as the `address` effect above.
   */
  useEffect(() => {
    if (inline) setOpen(true);
  }, [inline]);

  useEffect(() => {
    // Full screen covers the page outright, so displacing `<main>` underneath it
    // buys nothing and would leave a 420px gutter behind for the moment between
    // collapsing and the transform settling. Inline needs none of this — the
    // slot already reserves its own space in the column.
    if (!wide || !open || expanded || inline) return;
    const main = document.querySelector("main");
    if (!main) return;
    const previous = main.style.paddingRight;
    main.style.paddingRight = "420px";
    return () => {
      main.style.paddingRight = previous;
    };
  }, [wide, open, expanded, inline]);

  /**
   * Both states stay mounted, and `open` only drives transforms.
   *
   * Swapping between two `return`s gives an opening animation and no closing
   * one — React removes the panel on the same frame the class would have
   * started moving it, so it vanishes. Keeping both in the tree and toggling
   * `translate` lets the browser animate in both directions, which is the whole
   * point: the close is the moment the reader is going back to the verdict, and
   * a panel that blinks out of existence takes their eye with it.
   *
   * Everything hidden also gets `pointer-events-none` and `aria-hidden` — an
   * off-screen panel that still catches clicks or still reads out to a screen
   * reader is worse than no animation at all. `motion-reduce` collapses every
   * duration to zero rather than shortening it.
   */
  const closed = !open;

  // Nothing to narrate yet. On `/scan` before a scan there is no verdict on the
  // page, so an "ASK WHY" tab would open onto a panel with no subject.
  if (!subject) return null;

  return (
    <>
      {/*
        Collapsed, desktop: the spine tab on the right edge. Not rendered when
        a slot has taken over — `RobinKnightPreview`'s own suggested-question
        button is the entry point there, and a spine tab pinned to the
        viewport edge while the real trigger sits inline in the column would
        be a second, redundant way in.
      */}
      {!inline && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-hidden={!wide || open}
          tabIndex={!wide || open ? -1 : 0}
          className={`fixed right-0 top-1/2 z-40 hidden -translate-y-1/2 items-center gap-3 border-y-2 border-l-2 border-[#2a2a2a] bg-[#141414] px-3 py-6 transition-transform duration-300 ease-out hover:border-[#ccff00] motion-reduce:transition-none xl:flex ${
            open ? "pointer-events-none translate-x-full" : "translate-x-0"
          }`}
          style={{ writingMode: "vertical-rl" }}
        >
          <span className="font-cinzel text-xs font-bold tracking-[0.22em] text-[#ededea]">
            ASK ROBIN KNIGHT
          </span>
          <span className={`${MONO} text-[9px] text-[#6a6a6a]`}>ASK WHY</span>
        </button>
      )}

      {/* Collapsed, mobile: the peek bar. */}
      <div
        aria-hidden={wide || open}
        className={`fixed inset-x-0 bottom-0 z-40 border-t-2 border-[#2a2a2a] bg-[#141414] px-4 pb-5 pt-3.5 transition-transform duration-300 ease-out motion-reduce:transition-none xl:hidden ${
          open ? "pointer-events-none translate-y-full" : "translate-y-0"
        }`}
      >
        <div className="mx-auto mb-3 h-[3px] w-11 bg-[#3d3d3d]" />
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-cinzel text-[13px] font-bold tracking-[0.18em] text-[#ededea]">
              ASK ROBIN KNIGHT
            </div>
            <p className="mt-1.5 truncate text-xs leading-relaxed text-[#b4b4b4]">
              Ask why this verdict reads the way it does.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            tabIndex={wide || open ? -1 : 0}
            className={`${LABEL} halftone-light flex-none whitespace-nowrap border-2 border-[#ededea] bg-[#ededea] px-4 py-3 text-[#0a0a0a]`}
          >
            OPEN ↑
          </button>
        </div>
      </div>

      {wide ? (
        inline ? (
          // Inline: the panel lives in the slot, not pinned to the viewport
          // edge. Full screen is the one exception — a slot the width of a
          // grid column is nowhere near enough for a live contract audit (see
          // `RobinKnightDock`'s header on why full screen exists at all), so
          // expanding still escapes to a page-covering overlay — and it is the
          // SAME overlay `/robin-knight` itself uses (`CaseFilesShell`), not the
          // 420px `docked` panel simply stretched wide. That does mean the two
          // states are genuinely different component trees (the docked panel
          // does not persist across the switch, unlike the width-only toggle
          // this replaced), so `ChatPanel`'s own ephemeral UI — history open,
          // setup collapsed — resets on the way in or out. The conversation
          // itself does not: it lives in `state`, not in `ChatPanel`.
          //
          // `slot` is guaranteed non-null here — this branch only runs when
          // `inline` is true, and `inline` is defined as `wide && slot !== null`
          // — but TS cannot narrow through that indirection, hence the cast.
          open &&
          (expanded
            ? createPortal(
                <div className={CASE_FILES_FULLSCREEN}>
                  <CaseFilesShell
                    state={state}
                    expanded
                    onToggleExpand={() => setExpanded(false)}
                    subject={subject}
                    seed={seed}
                    onSeedConsumed={() => setSeed(null)}
                    onCollapse={() => {
                      setExpanded(false);
                      setOpen(false);
                    }}
                  />
                </div>,
                document.body
              )
            : createPortal(
                <div className="flex h-full w-full flex-col border-2 border-[#2a2a2a]">
                  <ChatPanel
                    state={state}
                    variant="docked"
                    subject={subject}
                    seed={seed}
                    onSeedConsumed={() => setSeed(null)}
                    expanded={false}
                    onToggleExpand={() => setExpanded(true)}
                    onCollapse={() => setOpen(false)}
                  />
                </div>,
                slot as HTMLElement
              ))
        ) : (
          // `top-[65px]` clears the sticky nav (py-4 + a 28px mark + its 1px
          // border), so the rail never covers the wordmark or SCAN A TOKEN.
          <aside
            aria-hidden={closed}
            // `border-t-2` as well as `border-l-2`: the rail used to rely on the
            // nav's own bottom border to cap it, and the nav is translucent with a
            // backdrop blur — so once the page scrolled content passed underneath
            // and the rail's top edge stopped reading as an edge. The mobile sheet
            // never had this because it always carried its own `border-t-2`. A
            // panel should not borrow its outline from a neighbour.
            // `flex flex-col`: whichever child it holds (`ChatPanel`'s `h-full`
            // or `CaseFilesShell`'s `min-h-0 flex-1`) has to fill this box, and
            // the shell's `flex-1` is inert in a block parent — it would size to
            // its content and the full-screen workspace would collapse to a
            // header. See `CASE_FILES_FULLSCREEN`.
            className={`fixed bottom-0 right-0 flex flex-col bg-[#0a0a0a] transition-transform duration-300 ease-out motion-reduce:transition-none ${
              expanded
                ? // Full screen sits ABOVE the nav (z-50 vs z-40) and covers it.
                  // Keeping the nav visible would mean keeping the 65px offset and
                  // a page-width panel underneath a bar it no longer relates to —
                  // more chrome, not less, which is the opposite of the ask. The
                  // header's own exit control and Escape are the way back.
                  "left-0 top-0 z-50 w-full border-l-0 border-t-0"
                : "top-[65px] z-40 w-[420px] border-l-2 border-t-2 border-[#2a2a2a]"
            } ${closed ? "pointer-events-none translate-x-full" : "translate-x-0"}`}
          >
            {expanded ? (
              // Full screen here is the same `CaseFilesShell` workspace
              // `/robin-knight` and the inline slot's expansion use — not the
              // 420px `docked` panel stretched wide. See the inline branch
              // above for why this means `ChatPanel`'s own local UI state does
              // not survive the switch, while the conversation itself does.
              <CaseFilesShell
                state={state}
                expanded
                onToggleExpand={() => setExpanded(false)}
                subject={subject}
                seed={seed}
                onSeedConsumed={() => setSeed(null)}
                onCollapse={() => {
                  setExpanded(false);
                  setOpen(false);
                }}
              />
            ) : (
              <ChatPanel
                state={state}
                variant="docked"
                subject={subject}
                seed={seed}
                onSeedConsumed={() => setSeed(null)}
                expanded={false}
                onToggleExpand={() => setExpanded(true)}
                onCollapse={() => setOpen(false)}
              />
            )}
          </aside>
        )
      ) : (
        <div
          aria-hidden={closed}
          // `z-50` when expanded, matching the desktop `<aside>` above — full
          // screen is meant to sit ABOVE the nav and cover it (and anything
          // else in the z-40..49 range, e.g. a floating chart widget), not
          // peek out from behind it. The sheet stayed at `z-40` in every state
          // here before; only the peeking (non-expanded) case still needs it,
          // since that one deliberately leaves the verdict visible above.
          className={`fixed inset-0 flex flex-col justify-end ${expanded ? "z-50" : "z-40"} ${
            closed ? "pointer-events-none" : ""
          }`}
        >
          {/* The scrim fades; the sheet slides. Tying them to one duration
              keeps the page from appearing to darken before anything arrives. */}
          <button
            type="button"
            aria-label="Dismiss the Robin Knight"
            tabIndex={closed ? -1 : 0}
            onClick={() => setOpen(false)}
            className={`flex-1 bg-[#0a0a0a]/70 transition-opacity duration-300 ease-out motion-reduce:transition-none ${
              closed ? "opacity-0" : "opacity-100"
            }`}
          />
          <div
            // `flex flex-col` for the same reason as the desktop rail above.
            className={`flex flex-col border-t-2 border-[#2a2a2a] bg-[#0a0a0a] transition-transform duration-300 ease-out motion-reduce:transition-none ${
              // The sheet peaks at 82% precisely so the score stays visible above
              // it — the verdict is still the product on a phone. Full screen is
              // the reader explicitly setting that aside for one long answer, so
              // it is opt-in and it is not the default.
              expanded ? "h-full" : "h-[82%]"
            } ${closed ? "translate-y-full" : "translate-y-0"}`}
          >
            {expanded ? (
              // Same reasoning as the desktop branches above: full screen on a
              // phone is the `CaseFilesShell` workspace, not the peeking sheet
              // stretched to `h-full`. `CaseFilesShell`'s own case-file column
              // is already a below-`lg` drawer, so it fits a phone unmodified.
              <CaseFilesShell
                state={state}
                expanded
                onToggleExpand={() => setExpanded(false)}
                subject={subject}
                seed={seed}
                onSeedConsumed={() => setSeed(null)}
                onCollapse={() => {
                  setExpanded(false);
                  setOpen(false);
                }}
              />
            ) : (
              <ChatPanel
                state={state}
                variant="sheet"
                subject={subject}
                seed={seed}
                onSeedConsumed={() => setSeed(null)}
                expanded={false}
                onToggleExpand={() => setExpanded(true)}
                onCollapse={() => setOpen(false)}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
