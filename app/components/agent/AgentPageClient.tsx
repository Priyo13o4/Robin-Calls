"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { CASE_FILES_FULLSCREEN, CaseFilesShell } from "./CaseFilesShell";
import { useRobinKnight } from "./useRobinKnight";

/**
 * `/robin-knight` — the standalone surface, for questions that are not about one
 * open verdict. (Not `/agent`: that prefix belongs to the FastAPI container and
 * nginx redirects into it. See `app/robin-knight/page.tsx`.)
 *
 * The case-file sidebar and the standalone chat live in `CaseFilesShell`, shared
 * with the full-screen expansion of the docked rail on `/scan` — expanding from
 * a verdict page lands in this exact workspace rather than a wider copy of the
 * 420px rail.
 */
function AgentPageInner() {
  const state = useRobinKnight();
  /**
   * Full screen. Here the constraint is HEIGHT, not width.
   *
   * The layout below clamps to `min(78dvh, 900px)` so the panel never fights the
   * document scrollbar — correct, and on a laptop it leaves a transcript about
   * fifteen lines tall. That is fine for a question and answer, and cramped for
   * a contract audit listing six capabilities with their function signatures.
   * Expanding drops the clamp and the page chrome together.
   */
  const [expanded, setExpanded] = useState(false);

  // A question handed in by ?q= (the landing page's Robin Knight teaser). Only
  // ever consumed once per page load — a fresh navigation with a new `q`
  // remounts this component, so no extra tracking is needed for "asked again".
  const searchParams = useSearchParams();
  const [seed, setSeed] = useState<{ text: string } | null>(null);
  const consumedQuery = useRef(false);

  useEffect(() => {
    if (consumedQuery.current) return;
    const q = searchParams.get("q")?.trim();
    if (!q) return;
    // Wait for config: `state.send` no-ops silently before it loads, which
    // would swallow the question with no retry.
    if (!state.config) return;
    consumedQuery.current = true;
    // Same rule as `openRobinKnight`'s `send` flag: `blocked` means no BYOK
    // key is connected, so there is nothing to spend and seeding is the only
    // honest outcome. Never auto-send on the user's behalf when a key IS
    // connected without them having pressed anything on this page yet — but
    // here the click that navigated here (the teaser's suggestion button) was
    // that press, so a connected session sends immediately.
    if (!state.blocked) {
      void state.send(q);
    } else {
      setSeed({ text: q });
    }
  }, [searchParams, state.config, state.blocked, state.send]);

  return (
    /*
     * The panel's height is a fixed clamp, NOT `100vh` minus a guess at the
     * chrome above it. That arithmetic is wrong the moment the header wraps to
     * two lines or the nav changes height, and being wrong produces the worst
     * possible artefact for a scrolling panel: an outer scrollbar and an inner
     * one that disagree, so the document scrolls past a panel that scrolled
     * itself, leaving a band of empty page. Seen exactly once, in the browser,
     * which is the only place it is visible.
     */
    <div
      className={
        expanded
          ? CASE_FILES_FULLSCREEN
          : "mx-auto flex w-full max-w-[1400px] flex-col gap-0 px-0 pb-16 lg:h-[min(78dvh,900px)] lg:flex-row lg:px-6"
      }
    >
      <CaseFilesShell
        state={state}
        expanded={expanded}
        onToggleExpand={() => setExpanded((v) => !v)}
        seed={seed}
        onSeedConsumed={() => setSeed(null)}
      />
    </div>
  );
}

export function AgentPageClient() {
  // `useSearchParams` requires a Suspense boundary so the ?q= handoff doesn't
  // force the whole route to de-opt from static rendering.
  return (
    <Suspense fallback={null}>
      <AgentPageInner />
    </Suspense>
  );
}
