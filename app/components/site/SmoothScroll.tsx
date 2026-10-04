"use client";

import { useSmoothScroll } from "./lenis";

/**
 * Mounts Lenis for the landing page's lifetime. The page itself is a server
 * component (it fetches the preview data for every section), so the hook
 * needs a client leaf to live in rather than the page's own module scope.
 */
export function SmoothScroll() {
  useSmoothScroll();
  return null;
}
