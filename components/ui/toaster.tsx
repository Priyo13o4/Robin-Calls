"use client";

import { useState } from "react";
import { Toast, ToastViewport, type ToastPosition, type ToastSkin } from "./toast";
import { useToast } from "./use-toast";

const PEEK_PX = 10;
const SHRINK = 0.05;
const VISIBLE_BEHIND = 2;

/**
 * Mount once, near the root. Everything else raises a toast through
 * `toast()` from ./use-toast and never renders one itself.
 * Several toasts fold into a deck, newest in front; hovering fans them out.
 */
export function Toaster({
  position = "bottom-right",
  skin = "solid",
}: {
  position?: ToastPosition;
  /** Per-toast `skin` still wins; this is the house default. */
  skin?: ToastSkin;
}) {
  const { toasts, dismiss, pause, resume } = useToast();
  const [expanded, setExpanded] = useState(false);
  const bottom = position.startsWith("bottom");
  const n = toasts.length;
  const stacked = !expanded && n > 1;

  return (
    <ToastViewport position={position}>
      <div
        className={stacked ? "grid w-full" : "flex w-full flex-col gap-3"}
        style={stacked ? { [bottom ? "paddingTop" : "paddingBottom"]: Math.min(n - 1, VISIBLE_BEHIND) * PEEK_PX } : undefined}
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
      >
        {toasts.map((t, i) => {
          const depth = n - 1 - i;
          const style: React.CSSProperties = stacked
            ? {
                gridArea: "1 / 1",
                alignSelf: bottom ? "end" : "start",
                zIndex: n - depth,
                transform: `translateY(${(bottom ? -1 : 1) * Math.min(depth, VISIBLE_BEHIND) * PEEK_PX}px) scale(${1 - Math.min(depth, VISIBLE_BEHIND) * SHRINK})`,
                transformOrigin: bottom ? "top center" : "bottom center",
                opacity: depth > VISIBLE_BEHIND ? 0 : 1,
                transition: "transform 200ms cubic-bezier(0.16, 1, 0.3, 1), opacity 200ms",
              }
            : { transition: "transform 200ms cubic-bezier(0.16, 1, 0.3, 1)" };
          return (
            <div key={t.id} style={style} aria-hidden={stacked && depth > 0 ? true : undefined}>
              <Toast
                variant={t.variant}
                skin={t.skin ?? skin}
                title={t.title}
                description={t.description}
                action={t.action}
                duration={t.duration}
                showProgress={t.showProgress}
                closable={t.closable}
                leaving={t.leaving}
                count={t.count}
                progressKey={t.bump}
                onClose={() => dismiss(t.id)}
                onMouseEnter={() => pause(t.id)}
                onMouseLeave={() => resume(t.id)}
              />
            </div>
          );
        })}
      </div>
    </ToastViewport>
  );
}
