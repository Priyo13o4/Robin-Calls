"use client";

import { useCallback, useId, useRef } from "react";

/**
 * The site's slider. Replaces `<input type="range">`, whose thumb and track are
 * drawn by the platform — a chunky blue-grey pill on macOS, a different one on
 * Windows, and `accent-color` only recolours it. There is no cross-browser way
 * to style the native control without `::-webkit-`/`::-moz-` shadow-DOM rules
 * duplicated per engine, so this draws its own.
 *
 * Dragging is POINTER-based with capture, not `onChange`: capture keeps the
 * drag alive when the pointer leaves the track (a native range stops updating
 * the moment you slip off it vertically), and one pointer path covers mouse,
 * pen and touch. `touch-action: none` is what stops a horizontal drag from
 * scrolling the page out from under it on a phone.
 *
 * It is a real slider to assistive tech — `role="slider"` plus the three aria
 * value fields and full keyboard handling — because a styled `<div>` that only
 * responds to pointers is a control keyboard users cannot reach at all.
 */
export function RangeSlider({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  valueText,
  disabled = false,
  className = "",
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (next: number) => void;
  /** Accessible name. Visible labelling stays the caller's job. */
  label: string;
  /** What a screen reader should read instead of the bare number. */
  valueText?: string;
  disabled?: boolean;
  className?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const id = useId();

  // A zero-width span would divide by zero and put the knob at NaN%; a
  // degenerate range renders as an empty track rather than a broken one.
  const span = max - min;
  const pct = span > 0 ? ((clamp(value, min, max) - min) / span) * 100 : 0;

  const setFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el || span <= 0) return;
      const r = el.getBoundingClientRect();
      if (r.width === 0) return;
      const t = clamp((clientX - r.left) / r.width, 0, 1);
      const raw = min + t * span;
      // Snap to the step grid measured from `min`, not from zero: a slider
      // running 3–24 in steps of 6 must land on 3, 9, 15 — not 6, 12, 18.
      const snapped = step > 0 ? min + Math.round((raw - min) / step) * step : raw;
      const next = clamp(round(snapped, step), min, max);
      if (next !== value) onChange(next);
    },
    [min, max, span, step, value, onChange],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const big = Math.max(step, span / 10);
    const map: Record<string, number> = {
      ArrowRight: step,
      ArrowUp: step,
      ArrowLeft: -step,
      ArrowDown: -step,
      PageUp: big,
      PageDown: -big,
    };
    let next: number | undefined;
    if (e.key in map) next = clamp(round(value + map[e.key], step), min, max);
    else if (e.key === "Home") next = min;
    else if (e.key === "End") next = max;
    if (next === undefined) return;
    e.preventDefault();
    if (next !== value) onChange(next);
  };

  return (
    <div
      className={`relative flex h-6 w-full touch-none select-none items-center ${disabled ? "opacity-40" : "cursor-pointer"} ${className}`}
      onPointerDown={(e) => {
        if (disabled) return;
        // Capture on the element that owns the handler, so the drag survives
        // the pointer leaving the track entirely.
        e.currentTarget.setPointerCapture(e.pointerId);
        setFromClientX(e.clientX);
      }}
      onPointerMove={(e) => {
        if (disabled || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
        setFromClientX(e.clientX);
      }}
      onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
    >
      <div ref={trackRef} className="relative h-[3px] w-full rounded-full bg-[#242424]">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-[#ccff00]"
          style={{ width: `${pct}%` }}
        />
        <div
          id={id}
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label={label}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={clamp(value, min, max)}
          aria-valuetext={valueText}
          aria-disabled={disabled || undefined}
          onKeyDown={onKeyDown}
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#0a0a0a] bg-[#ccff00] shadow-[0_2px_8px_rgba(0,0,0,0.6)] outline-none transition-[box-shadow,transform] duration-150 hover:scale-110 focus-visible:ring-2 focus-visible:ring-[#ccff00]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-[#141414]"
          style={{ left: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Kill float drift from repeated `+= step`, so 0.1 steps print as 0.1. */
function round(n: number, step: number): number {
  if (!Number.isFinite(step) || step <= 0) return n;
  const dp = Math.min(10, (String(step).split(".")[1] ?? "").length);
  return Number(n.toFixed(dp));
}
