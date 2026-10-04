"use client";

import { useEffect, useRef, useState } from "react";

/**
 * "Is this element close enough to the viewport to be worth paying for yet?"
 *
 * `loading="lazy"` defers image BYTES but nothing else. `/ecosystem` renders ~180
 * cards and each one fired `/api/og-proxy` from a mount effect, so opening the
 * page hit our own box 180 times, and each of those hits made a live fetch to a
 * third-party site. The work that has to be deferred there is the request, not
 * the `<img>`.
 *
 * Latches true and stops observing: this gates a one-time fetch, so re-firing
 * when the card scrolls back would defeat the point.
 *
 * Degrades to TRUE when `IntersectionObserver` is missing, never to false — a
 * card that renders its fallback forever is worse than an eager fetch.
 */
export function useNearViewport<T extends HTMLElement = HTMLDivElement>(
  rootMargin = "400px",
): { ref: React.RefObject<T | null>; near: boolean } {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    // Refs are assigned before effects run, so this is set as long as the
    // caller attaches it to an element it renders UNCONDITIONALLY. Gating the
    // element's own render on `near` would deadlock here.
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin]);

  return { ref, near };
}
