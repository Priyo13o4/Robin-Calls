import type { PointerEventHandler, ReactNode } from "react";

/**
 * The /swap card's frame, shared so the trade window cannot drift from it (L213 #24).
 * `bodyClassName` only sizes the body; the chrome itself is not configurable on purpose.
 */
export function SwapFrame({
  children,
  bodyClassName = "min-h-[570px]",
  onPointerDown,
}: {
  children: ReactNode;
  bodyClassName?: string;
  onPointerDown?: PointerEventHandler<HTMLElement>;
}) {
  return (
    <section
      aria-label="Swap tokens"
      onPointerDown={onPointerDown}
      // font-sans: the trade page is font-mono, and the card inherited it there but not on /swap.
      className="relative overflow-hidden rounded-[28px] font-sans border border-white/[0.08] bg-[#121417] p-2 shadow-[0_24px_80px_rgba(0,0,0,0.65)]"
    >
      <div className="pointer-events-none absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-[#ccff00]/50 to-transparent" />
      <div className={`overflow-hidden rounded-[25px] bg-[#0b0c0d] ${bodyClassName}`}>
        {children}
      </div>
    </section>
  );
}
