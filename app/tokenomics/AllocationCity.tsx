"use client";

import Image from "next/image";
import { CITY, CITY_PAINT_ORDER } from "./city-manifest";
import { TOKENOMICS, tokensFor, VESTING } from "@/lib/sale/tokenomics";

/**
 * The allocation city: one building per allocation, hovering or tapping either
 * the building or its table row lifts it off its plot.
 *
 * The layers are FULL-FRAME transparent renders from one Blender camera, so
 * they stack at 0,0 and cannot drift apart — there is one projection, decided
 * at render time, not seven decided in CSS. Stacking order is the `depth` the
 * renderer measured along the camera axis; deriving it from screen position
 * here would guess at what the renderer already knows.
 *
 * The lift is `translateY` only. It is a 2-D move standing in for a 3-D one,
 * and it reads as depth solely because the contact shadow is baked into the
 * GROUND plate and therefore stays behind — the building leaves its own shadow
 * on the plot it lifts off. Animating the shadow with it would flatten the
 * whole effect back into a sliding sticker.
 *
 * `unoptimized` is deliberate. The renderer already emits these at exactly one
 * size, as webp; the optimizer would only re-encode them, and its on-disk
 * cache keys on the URL — which does not change when publish.sh overwrites a
 * layer. That served a stale ground plate at the previous render's aspect
 * ratio while the buildings were current, so the town sat on a mis-sized
 * street and nothing errored.
 */
export function AllocationCity({
  active,
  onActive,
}: {
  active: string | null;
  onActive: (key: string | null) => void;
}) {
  const rowFor = (key: string) => TOKENOMICS.find((r) => r.city === key);
  const current = active ? rowFor(active) : undefined;
  const currentBox = active ? CITY.buildings.find((b) => b.key === active) : undefined;

  return (
    <div
      className="relative w-full select-none overflow-hidden bg-[#0f0f0f]"
      style={{ aspectRatio: `${CITY.w} / ${CITY.h}` }}
      onMouseLeave={() => onActive(null)}
      // A touch device never fires mouseleave, so without this the label from
      // the last tap would stay up for good.
      onClick={(e) => {
        if (e.target === e.currentTarget) onActive(null);
      }}
    >
      <Image
        src={`${CITY.dir}/${CITY.ground}`}
        alt=""
        width={CITY.w}
        height={CITY.h}
        priority
        unoptimized
        className="pointer-events-none absolute inset-0 h-full w-full"
      />

      {CITY_PAINT_ORDER.map((b) => {
        const row = rowFor(b.key);
        const on = active === b.key;
        return (
          <Image
            key={b.key}
            src={`${CITY.dir}/${b.file}`}
            alt={row ? `${row.label}: ${row.pct}% of supply` : ""}
            width={CITY.w}
            height={CITY.h}
            unoptimized
            className="pointer-events-none absolute inset-0 h-full w-full transition-[transform,filter] duration-300 ease-out"
            style={{
              // A percentage of the frame, so the lift scales with the rendered
              // size instead of shrinking to nothing on a phone.
              //
              // The lift and its shadow are the ONLY hover treatment: the rest
              // of the town keeps its full opacity. Dimming the others made the
              // picture read as a spotlight on a diorama rather than one
              // building standing up out of a street.
              transform: on ? "translateY(-2.6%)" : "none",
              filter: on ? "drop-shadow(0 14px 18px rgba(0,0,0,0.55))" : "none",
            }}
          />
        );
      })}

      {/* Hit targets, separate from the art: the layers are full-frame and
          would each swallow every pointer event. Nearest first, so where two
          boxes overlap the building in front wins. */}
      {[...CITY.buildings]
        .sort((a, b) => a.depth - b.depth)
        .map((b) => {
          const row = rowFor(b.key);
          if (!row) return null;
          const [x0, y0, x1, y1] = b.box;
          return (
            <button
              key={b.key}
              type="button"
              onMouseEnter={() => onActive(b.key)}
              onFocus={() => onActive(b.key)}
              onBlur={() => onActive(null)}
              onClick={() => onActive(active === b.key ? null : b.key)}
              aria-label={`${row.label}: ${row.pct}% of supply, ${tokensFor(row.pct).toLocaleString('en-US')} tokens`}
              aria-pressed={active === b.key}
              className="absolute cursor-pointer border-0 bg-transparent p-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-[#ccff00]"
              style={{
                left: `${(x0 / CITY.w) * 100}%`,
                top: `${(y0 / CITY.h) * 100}%`,
                width: `${((x1 - x0) / CITY.w) * 100}%`,
                height: `${((y1 - y0) / CITY.h) * 100}%`,
              }}
            />
          );
        })}

      {/* The label, anchored to the building it names. Clamped inside the frame
          so a building near an edge does not push its own label out of view. */}
      {current && currentBox && (
        <CityLabel
          row={current}
          x={((currentBox.box[0] + currentBox.box[2]) / 2 / CITY.w) * 100}
          top={(currentBox.box[1] / CITY.h) * 100}
          bottom={(currentBox.box[3] / CITY.h) * 100}
        />
      )}

      {/* Resting hint. The wording follows the input the device actually has —
          "hover" is a lie on a phone. CSS decides, not a user-agent guess. */}
      {!current && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex min-h-8 items-end bg-gradient-to-t from-[#0a0a0a] to-transparent px-4 py-1.5 font-mono text-[12px] leading-snug tracking-[0.16em] text-[#5a5a5a]">
          <span className="hidden [@media(hover:hover)]:inline">
            HOVER A BUILDING
          </span>
          <span className="[@media(hover:hover)]:hidden">
            TAP A BUILDING
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * The card sits above the building it names, and FLIPS below it when there is
 * not enough room. Clamping the top instead (the previous fix) cannot work:
 * the card is anchored by its own bottom edge, so a clamp moves the anchor,
 * not the card, and the frame's `overflow-hidden` shears the title line off
 * for every building in the back row — the ones furthest up the street.
 *
 * The threshold is the card's own height as a share of the frame, stated once
 * here. It is an estimate, and it is allowed to be: being wrong flips a card
 * that had just enough room, which is a placement, not a truncation.
 */
const CARD_H_PCT = 26;

function CityLabel({
  row,
  x,
  top,
  bottom,
}: {
  row: (typeof TOKENOMICS)[number];
  x: number;
  /** The building's top and bottom edges, as % of the frame height. */
  top: number;
  bottom: number;
}) {
  const shape = VESTING[row.label];
  const below = top < CARD_H_PCT;
  return (
    <div
      className="pointer-events-none absolute z-10 w-[min(16rem,62%)] overflow-hidden rounded-2xl border border-white/10 bg-[#0d0d0be6] shadow-[0_18px_40px_-12px_rgba(0,0,0,0.85),0_0_0_1px_rgba(0,0,0,0.4)] ring-1 ring-inset ring-white/[0.04] backdrop-blur-md"
      style={{
        // Horizontal clamp only: a building at the left or right edge would
        // otherwise anchor its own label out of the frame.
        left: `${Math.min(84, Math.max(16, x))}%`,
        top: `${below ? Math.min(bottom - 4, 100 - CARD_H_PCT) : top - 1.5}%`,
        transform: below ? "translate(-50%, 0)" : "translate(-50%, -100%)",
      }}
    >
      <div className="px-3.5 pb-3 pt-2.5">
        <p className="font-mono text-[11.5px] leading-tight tracking-[0.18em] text-[#9a9a92]">
          {row.label}
        </p>
        <p className="mt-1.5 flex items-baseline gap-2 font-mono tabular-nums">
          <span className="text-[1.6rem] font-bold leading-none tracking-tight text-[#ccff00]">
            {row.pct}%
          </span>
          <span className="text-[13px] text-[#8a8a8a]">
            {tokensFor(row.pct).toLocaleString('en-US')}
          </span>
        </p>
        <p className="mt-2 text-[13px] leading-snug text-[#a5a59c]">{row.note}</p>
      </div>
      {shape && (
        <p className="border-t border-white/[0.07] bg-white/[0.02] px-3.5 py-2 font-mono text-[11px] leading-snug tracking-[0.14em] text-[#7a7a70]">
          {shape.rule}
        </p>
      )}
    </div>
  );
}
