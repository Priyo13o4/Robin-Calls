"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Backstop for Next's own scroll reset, which never runs on a `force-dynamic`
 * route that also has a `loading.tsx`.
 *
 * `layout-router`'s handler returns early on anything that is not an Element,
 * and on those routes the segment's first DOM node at that moment is React's
 * Suspense placeholder (a comment node). Measured on dev: /rwa and
 * /rwa/[address] keep the previous page's scrollY exactly, while /ecosystem
 * (same skeleton, `revalidate` instead of `force-dynamic`) resets to 0.
 *
 * Mounted in the root layout because that is the only tree App Router keeps
 * alive across navigations — inside a page it would remount every time and
 * could not tell an initial load from a route change.
 */
export function ScrollResetOnNavigate() {
  const pathname = usePathname();
  const previous = useRef<string | null>(null);
  // popstate fires before React renders the restored route, so the flag is
  // always set by the time the effect below reads it.
  const popped = useRef(false);

  useEffect(() => {
    const onPop = () => {
      popped.current = true;
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const from = previous.current;
    previous.current = pathname;

    const wasPop = popped.current;
    popped.current = false;

    // First render of the document: the browser owns the position here, and
    // reloading a scrolled page should land where it was.
    if (from === null) return;
    if (from === pathname) return;
    // Back and forward already restore their own position correctly.
    if (wasPop) return;
    // A hash target is an explicit destination; do not override it.
    if (window.location.hash) return;

    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
