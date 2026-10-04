"use client";

import { useEffect, useRef } from "react";

/**
 * Close an open popover on Escape, or on a pointer press outside it.
 *
 * Shared by the composer's two chips and the case-file row menu. Extracted at
 * the second caller rather than the eighth (CLAUDE.md §2), because the two
 * details below are exactly the kind that get dropped when a menu is
 * hand-rolled a second time — and a menu that cannot be dismissed is a trap on
 * a touch screen, where there is no hover and no second click to spare.
 *
 * **`mousedown`, not `click`.** A click that begins inside the card and ends
 * outside it — dragging across a list, or selecting text in it — would
 * otherwise dismiss it mid-gesture.
 *
 * **Escape is captured and stopped.** The chat panel binds Escape to "leave
 * full screen"; without `stopPropagation` one press would close the menu and
 * change the layout underneath it. Scoped to the open state, so the panel's own
 * binding is untouched the rest of the time.
 */
export function useDismissable(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    const onPointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onPointer);
    };
  }, [open, close]);

  return ref;
}
