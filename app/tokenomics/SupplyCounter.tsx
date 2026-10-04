"use client";

import { useEffect, useState } from "react";

/**
 * The hero's supply count-up.
 *
 * The zero is only ever set from INSIDE the first animation frame. Where rAF
 * never fires — a hidden preview pane, a background tab, a browser that
 * throttles the frame loop — no frame means no zero, and the number simply
 * stays at its server-rendered value. Seeding `shown` at 0 and counting up
 * would leave "0" on screen as this page's headline fact in exactly those
 * environments.
 */
export function SupplyCounter({ value, durationMs = 1800 }: { value: number; durationMs?: number }) {
  const [shown, setShown] = useState(value);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let t0 = 0;
    const step = (t: number) => {
      if (!t0) t0 = t;
      const p = Math.min(1, (t - t0) / durationMs);
      // Exponential ease-out: fast off the mark, long settle on the last digits.
      setShown(Math.round(value * (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);

  return <>{shown.toLocaleString('en-US')}</>;
}
