"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { anchorOffsetPx } from "./lanyard-geometry";

/**
 * The verdict's social card, hung on a lanyard over the page.
 *
 * `Lanyard` renders a card on a string and decides nothing else (see its
 * header). This file is the policy around it — where it hangs, when it may
 * appear at all, and what stands in for it when it must not run. PLAN.md §5.1.
 *
 * ## It is a layer, not a panel
 *
 * The first version mounted this inside a bordered box in the verdict's right
 * column, and it read wrong for a reason worth writing down: **the rope's fixed
 * anchor is a point in world space, and `fov` is vertical**, so the scene's
 * extent in world units does not change with the element's height — only
 * pixels-per-unit does. The anchor therefore lands at the same ~12% down the
 * canvas at every size and is always painted. The strap visibly *began*, in
 * mid-air, inside its own frame. No amount of resizing that box fixes it; the
 * anchor has to be off the top of the page.
 *
 * So it hangs from above the content and dangles over it, which is also the
 * only arrangement in which a lanyard means anything. Two consequences:
 *
 *  - **`pointer-events: none` on the whole layer.** It lies across live content
 *    — highlight cards, addresses, the Robin Knight. `Lanyard` handles its own
 *    input at the window (its deviation 5), so the card stays draggable while
 *    everything underneath stays clickable. Do not put an interactive element
 *    in here; it would not receive events.
 *  - **`z-20`.** Above the pages' `fixed inset-0 z-0` backdrops, below the
 *    sidebar (`z-30`), the dock (`z-40`) and the nav (`z-50`) — so the strap
 *    runs up *behind* the chrome and off the top, rather than over it.
 *
 * ## The three states, in the order they are decided
 *
 *  1. **No receipt → no lanyard.** The card's face is `/api/og/{receiptId}`,
 *     which only exists once the verdict is on the ledger. Dropping an empty
 *     card would advertise a record that is not there.
 *  2. **Reduced motion → no lanyard.** A physics toy swinging over the page
 *     whenever the pointer passes it is exactly what that setting is about.
 *  3. Otherwise the canvas, mounted lazily and client-side only — WebGL,
 *     Rapier's wasm and the compositor's `document.createElement("canvas")` all
 *     assume a browser.
 *
 * In states 1 and 2 this renders nothing and `VerdictShare` carries the card
 * instead: it is in the normal flow, it is the keyboard path to sharing in
 * *every* state, and it is why the painted button on the card is allowed to be
 * a texture hit test rather than a real control.
 */

const Lanyard = dynamic(() => import("./Lanyard"), {
  ssr: false,
  loading: () => null,
});

/**
 * Canvas height at scale 1. Vertical world extent is fixed by `fov`, so this is
 * purely how many pixels that extent is drawn across — it sets the card's size
 * on screen, and costs nothing extra to raise.
 */
const BASE_SCENE_HEIGHT = 760;

/**
 * How far above the verdict section's top edge the rope's anchor sits, at
 * scale 1. The invariant behind it: **the anchor has to be off the top of the
 * viewport at scroll 0**, or the strap is a string beginning in mid-air — the
 * exact bug this layout exists to fix. The section starts ~284px down the page
 * (header, nav), so this must exceed that; the rest is headroom for a header
 * that grows — a degraded-scan banner, a taller nav on a narrow screen.
 */
const BASE_ANCHOR_ABOVE_SECTION = 430;

/**
 * Size of the whole assembly. **One dial, and it is a true scale** — the rope
 * is a fixed length in world units, so making the card bigger necessarily makes
 * the strap longer on screen too. Scaling the lift by the same factor is what
 * keeps the card in the same place on the page while it grows; scaling only the
 * height would push it down by the extra rope.
 *
 * Below `lg` this is capped by width, not taste: the card is ~259px across at
 * scale 1, so at 2 it would be 518px in a 375px viewport — clipped at both
 * edges. Since the card is also held off-centre (below), the cap is tighter
 * still: the budget is the screen minus the offset, not the whole screen. The
 * answer to "the text is too small on a phone" is therefore the artwork's type
 * scale, in `app/api/og/[id]/route.tsx` — not this number, which has nowhere
 * left to go.
 */
/**
 * UNREACHABLE since the lanyard became desktop-only (`deviceCanAffordLanyard`).
 * Kept, not deleted: these are hand-measured against the clipping limit at
 * 375px (the whole budget between "off centre" and "clipped" is ~40px), and
 * re-deriving them would be the expensive part of ever putting the card back on
 * a phone. `tests/lanyard-framing.test.ts` still pins them.
 */
const SCALE_BELOW_LG = 1.05;
const SCALE_LG = 2;

/**
 * The layer's left edge, as a percentage of the verdict section.
 *
 * It sets two things at once and they must not be written down separately: how
 * wide the layer is (its right edge is the section's), and therefore where the
 * STRAP hangs — a canvas centres its scene, so the strap is at the middle of
 * whatever is left. The dismiss handle sits on that strap, positioned from
 * `strapCenterPct` through `--ly-strap`; a second copy of this number would be
 * a control that drifts off the thing it controls.
 *
 * At `lg` the card is ~518px across and the right half of a `max-w-6xl` section
 * is 576px, so a centred layer would clip the moment it swung; 39% leaves it
 * ~1.35 card-widths of travel while keeping it over the right column.
 *
 * Below `lg` the layer used to be the full screen, which put the card dead
 * centre, straight down the middle of the score. 20% moves it right of centre
 * the way it sits on desktop. It cannot move much further: at 375px the card is
 * ~272px wide, so the whole budget between "off centre" and "clipped" is about
 * 40px, and `tests/lanyard-framing.test.ts` is what holds the line.
 */
const LAYER_LEFT_PCT_SM = 20;
const LAYER_LEFT_PCT_LG = 39;

/** Where the strap hangs: the middle of the layer, which starts at `left`. */
function strapCenterPct(left: number): number {
  return (100 + left) / 2;
}

/**
 * Bumped whenever the portrait card's LAYOUT changes, not its data.
 *
 * `/api/og/[id]` is cached for an hour by the browser and the CDN, keyed on the
 * URL — which is the right call for a link-preview image, and completely wrong
 * while the card is being designed: the type was doubled in size, the container
 * rebuilt, and the page still showed the old art with no way to tell it was a
 * cache and not a failed deploy. This is the one thing that makes the URL
 * different. The route ignores it.
 */
const CARD_ART_VERSION = 3;

/**
 * Height and lift for a scale. The lift is **derived, never written down**: the
 * anchor's own offset moves with the height and with the camera, and a lift
 * that did not track it would silently put the strap's origin back on screen.
 * `tests/lanyard-framing.test.ts` pins the invariant.
 */
function frameFor(scale: number): { height: number; lift: number } {
  const height = BASE_SCENE_HEIGHT * scale;
  return { height, lift: anchorOffsetPx(height) + BASE_ANCHOR_ABOVE_SECTION * scale };
}

const SM = frameFor(SCALE_BELOW_LG);
const LG = frameFor(SCALE_LG);

/**
 * The frame, as custom properties — the two breakpoints differ and an inline
 * style cannot carry a media query, so Tailwind's `lg:` picks which of each
 * pair applies. Nothing here is a literal; all four come from the constants
 * above.
 */
const LAYER_VARS = {
  "--ly-top": `${-SM.lift}px`,
  "--ly-h": `${SM.height}px`,
  "--ly-left": `${LAYER_LEFT_PCT_SM}%`,
  "--ly-strap": `${strapCenterPct(LAYER_LEFT_PCT_SM)}%`,
  "--ly-top-lg": `${-LG.lift}px`,
  "--ly-h-lg": `${LG.height}px`,
  "--ly-left-lg": `${LAYER_LEFT_PCT_LG}%`,
  "--ly-strap-lg": `${strapCenterPct(LAYER_LEFT_PCT_LG)}%`,
} as React.CSSProperties;

/**
 * Whether the hanging card is the one carrying the verdict right now.
 *
 * Both components below branch on it and they sit in different parts of the
 * tree, so it is one hook rather than one boolean each: the failure mode of
 * duplicating it is the card showing twice, or not at all, and neither would
 * fail a build. Server render is always `false` — `matchMedia` needs a window —
 * so the flat card is what SSR emits and the swap happens on hydration.
 */
/**
 * DESKTOP ONLY, plus an explicit weak-machine check on top.
 *
 * The lanyard costs ~2.3MB of `card.glb`, the three.js/Rapier chunk, a WebGL
 * context, a GPU upload and a continuous rAF loop. `prefers-reduced-motion` does
 * not cover that: the setting is about vestibular comfort, not about hardware.
 *
 * The width gate is the load-bearing half and it is here because a
 * capability-only gate provably could not do the job. `deviceMemory` and
 * `saveData` are Chromium-only, so Safari reports neither, and
 * `hardwareConcurrency` does not discriminate on iOS at all — an iPhone 8 and an
 * iPhone 15 both report 6. Measured against real device signatures, the
 * capability checks alone stood down budget Android and let EVERY old iPhone and
 * iPad through: exactly the population the gate exists for. There is no feature
 * Safari exposes that separates them, so the honest proxy is the screen.
 *
 * `1024px` is Tailwind's `lg`, the same breakpoint `LAYER_VARS` switches on.
 * Below it `VerdictShare` carries the card instead — the same flat fallback the
 * reduced-motion and no-receipt states already use, so this adds no new state.
 *
 * The capability checks are kept BELOW the width gate rather than deleted: a
 * low-memory or data-saver laptop is still a machine that should not spend this.
 */
const LANYARD_MIN_WIDTH_PX = 1024;

function deviceCanAffordLanyard(): boolean {
  if (!window.matchMedia(`(min-width: ${LANYARD_MIN_WIDTH_PX}px)`).matches) return false;
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  };
  if (nav.connection?.saveData === true) return false;
  if (typeof nav.deviceMemory === "number" && nav.deviceMemory < 4) return false;
  if (typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency <= 2) return false;
  return true;
}

export function useLanyardRuns(receiptId: number | null): boolean {
  const [reduced, setReduced] = useState(true);
  const [affordable, setAffordable] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const sync = () => setAffordable(deviceCanAffordLanyard());
    sync();
    // Rotating a tablet or dragging a window across the breakpoint has to
    // re-decide; a one-shot mount check strands the wrong answer.
    const mq = window.matchMedia(`(min-width: ${LANYARD_MIN_WIDTH_PX}px)`);
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return receiptId !== null && !reduced && affordable;
}

export function VerdictLanyard({
  receiptId,
  shareHref,
}: {
  receiptId: number | null;
  /** The X intent URL, opened by the button painted on the card's two faces. */
  shareHref: string;
}) {
  const runs = useLanyardRuns(receiptId);
  const layer = useRef<HTMLDivElement>(null);
  const [onScreen, setOnScreen] = useState(true);
  const [dismissed, setDismissed] = useState(false);
  /**
   * Distance from the top of the DOCUMENT to the top of the section, so the
   * handle can be placed at the top of the page while still being positioned
   * inside the section.
   *
   * It has to be measured. The handle must stay `absolute` — it belongs to the
   * lanyard and scrolls away with it — but `top-0` puts it at the top of the
   * *section*, which starts several hundred pixels down the page, level with the
   * market panel. Negating this offset moves it to the page's top edge without
   * making it `fixed`, which is the behaviour that was already rejected.
   *
   * There is no CSS for "my own offset from the document", and the number is not
   * a constant: the header above the section grows and shrinks with the
   * breakpoint, the degraded-scan banner, and a webfont swap. Null until
   * measured, so the handle never flashes at the wrong height.
   */
  const [sectionTop, setSectionTop] = useState<number | null>(null);

  /**
   * Stop the scene once it scrolls away. It hangs at the top of a page that is
   * several thousand pixels long, so without this the physics and the render
   * keep running at 60fps for the entire read, over nothing anyone can see.
   *
   * Defaults to running and only ever pauses on a negative observation, so an
   * engine without `IntersectionObserver` — or a callback that never fires —
   * degrades to the old always-on behaviour rather than to a frozen card.
   */
  useEffect(() => {
    const el = layer.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => setOnScreen(entry.isIntersecting),
      // Resume slightly before it re-enters, so it is already swinging by the
      // time it is visible rather than starting from a dead stop on screen.
      { rootMargin: "200px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [runs]);

  /**
   * Measure the section's offset from the top of the document, for the handle.
   *
   * A `ResizeObserver` on `<body>`, not a window `resize` listener alone: what
   * moves this number is content above the section changing height — the
   * degraded banner mounting, a webfont swapping metrics — and none of that
   * resizes the window. Measured once on mount, the handle would sit at
   * whatever the pre-hydration header height happened to be.
   */
  useEffect(() => {
    const el = layer.current;
    const section = el?.offsetParent;
    if (!section) return;
    const measure = () => {
      const r = section.getBoundingClientRect();
      // Guard a degenerate box: a hidden tab measures 0 and would park the
      // handle at the section's own top, which is the bug being fixed here.
      if (r.height > 0) setSectionTop(r.top + window.scrollY);
    };
    measure();
    const ro =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(document.body);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [runs]);

  if (!runs) return null;

  return (
    <>
      {/*
        The handle, on the strap at the ribbon's FAR END — hugging the top of the
        page, which is as close to that end as anything can get: the anchor
        itself is off the document by construction.

        Two requirements that pull against each other, and both are real:

         - **It scrolls away with the lanyard**, so it is `absolute`, not
           `fixed`. Pinned to the viewport it followed the reader down the page
           and hovered over unrelated content.
         - **It hugs the top of the SCREEN**, not the top of the section. Its
           containing block is the section, which starts several hundred pixels
           down the page — `top-0` put it level with the market panel, reading
           as a stray control dropped on the chart. So the section's own document
           offset is measured and negated.

        The two positions it had before: the section's top-right corner, which
        read as a caption beside the card, and `fixed`, which would not stay put.
        Horizontally it rides `--ly-strap`, the layer's middle derived from the
        same inset, so the handle cannot drift off the thing it controls.

        `78px` below `lg` clears the sticky `SiteNav` (bottom edge measures
        70px); at `lg` the nav is a left rail and `16px` is just air. Outside the
        layer because the layer is `pointer-events: none` and a button in there
        could never be clicked. `z-30` is over the layer (z-20), under the nav
        (z-50) and the dock (z-40).
      */}
      {sectionTop !== null && (
        <button
          type="button"
          onClick={() => setDismissed((v) => !v)}
          style={{ ...LAYER_VARS, "--ly-section-top": `${sectionTop}px` } as React.CSSProperties}
          className="absolute z-30 -translate-x-1/2 border border-[#2a2a2a] bg-[#1c1c1c]/90 px-3 py-1.5 font-mono text-[10px] tracking-[0.14em] text-[#8a8a8a] backdrop-blur transition-colors hover:border-[#ccff00] hover:text-[#ededea] left-[var(--ly-strap)] top-[calc(78px-var(--ly-section-top))] lg:left-[var(--ly-strap-lg)] lg:top-[calc(16px-var(--ly-section-top))]"
        >
          {dismissed ? "PULL IT DOWN" : "PUT IT AWAY"}
        </button>
      )}

      <div
        ref={layer}
      // Every position here is a `--ly-*` custom property, set once in
      // `LAYER_VARS`. `right-0` is the one fixed edge; the left inset is what
      // decides both the layer's width and where the strap hangs.
      className={`pointer-events-none absolute right-0 z-20 left-[var(--ly-left)] top-[var(--ly-top)] h-[var(--ly-h)] transition-transform duration-500 ease-out motion-reduce:transition-none lg:left-[var(--ly-left-lg)] lg:top-[var(--ly-top-lg)] lg:h-[var(--ly-h-lg)] ${
        dismissed ? "-translate-y-full" : "translate-y-0"
      }`}
      style={LAYER_VARS}
      aria-hidden
    >
      <Lanyard
        // `?layout=portrait` — 764x1200, sized to the badge's own face rect.
        // The default 1200x630 card is for link previews; forcing it onto a
        // portrait badge either crops the text off or floats in a band.
        frontImage={`/api/og/${receiptId}?layout=portrait&art=${CARD_ART_VERSION}`}
        backImage={`/api/og/${receiptId}?layout=portrait&art=${CARD_ART_VERSION}`}
        // Zipped up counts as off screen: a dismissed card must not keep
        // stepping physics, and its shield must not stay over the chart.
        paused={!onScreen || dismissed}
        // `contain`, not `cover`. The OG card is 1200x630 and this face is
        // portrait, so `cover` crops ~45% off the sides — which is text.
        imageFit="contain"
        onShare={() => window.open(shareHref, "_blank", "noopener,noreferrer")}
        shareLabel="SHARE"
        // Required by `contain` above: a contained image leaves the model's
        // own white paper texture showing everywhere it does not reach.
        faceBackground="#0a0a0a"
        // The site's one accent. Painted into the atlas, not a material change:
        // the card's edges are `card.glb` geometry, its face is ours.
        faceBorder="#ccff00"
        className="h-full w-full"
      />
      </div>
    </>
  );
}

/**
 * The card as a flat image plus the real share control, in the normal flow.
 *
 * Always rendered, but it is two different things depending on the state:
 *
 *  - **Lanyard suppressed** (no receipt, or reduced motion) — the card and a
 *    plain share button, because there is nothing else on the page carrying
 *    either.
 *  - **Lanyard running** — the share link only, and *visually hidden until it
 *    is focused*. The hanging card already shows a SHARE button, so a second
 *    one under the Robin Knight was the same action offered twice. Deleting it
 *    outright was the obvious move and is wrong: the hanging card is
 *    `aria-hidden` and its button is a hit test against a painted texture, so
 *    it can neither be tabbed to nor announced. That would have left keyboard
 *    and screen-reader users with no route to sharing at all, silently. So it
 *    stays in the tree and off the screen, which is the skip-link pattern.
 */
export function VerdictShare({
  receiptId,
  alt,
  shareHref,
}: {
  receiptId: number | null;
  alt: string;
  shareHref: string;
}) {
  const lanyardRuns = useLanyardRuns(receiptId);

  return (
    <div className="flex flex-col items-center gap-4">
      {!lanyardRuns &&
        (receiptId === null ? (
          <div className="flex aspect-[1200/630] w-full max-w-[420px] items-center justify-center border border-[#2a2a2a] bg-[#141414] px-6 text-center">
            <span className="font-mono text-[10px] leading-relaxed tracking-widest text-[#8a8a8a]">
              CARD AVAILABLE ONCE THIS VERDICT IS ON THE RECORD
            </span>
          </div>
        ) : (
          <div className="relative aspect-[1200/630] w-full max-w-[420px] overflow-hidden border border-[#2a2a2a] shadow-lg">
            {/* eslint-disable-next-line @next/next/no-img-element -- an OG route,
                not a static asset: next/image would proxy and re-encode a PNG
                that is already exactly the size it is served at. */}
            <img
              src={`/api/og/${receiptId}`}
              alt={alt}
              className="absolute inset-0 h-full w-full object-cover"
              loading="lazy"
            />
          </div>
        ))}

      <a
        href={shareHref}
        target="_blank"
        rel="noopener noreferrer"
        // `sr-only` is `position:absolute; width:1px; height:1px; clip-path` —
        // in the accessibility tree, off the screen. The focus styles are a
        // complete restatement rather than a `not-sr-only`: that utility resets
        // padding and margin to 0 as well, and whether it beats `px-6` from the
        // same layer is a cascade-order question nobody should have to answer.
        className={
          lanyardRuns
            ? "sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-6 focus-visible:top-6 focus-visible:z-50 focus-visible:block focus-visible:bg-[#ededea] focus-visible:px-6 focus-visible:py-2 focus-visible:font-cinzel focus-visible:text-xs focus-visible:font-bold focus-visible:tracking-widest focus-visible:text-[#0a0a0a]"
            : "flex items-center gap-2 bg-[#ededea] px-6 py-2 font-cinzel text-xs font-bold tracking-widest text-[#0a0a0a] transition-colors hover:bg-[#ccff00]"
        }
      >
        SHARE ON X
      </a>
    </div>
  );
}
