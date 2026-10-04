"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { ModernTradingCard } from "./ModernTradingCard";
import { SwapFrame } from "./SwapFrame";
import type { TokenMarketData } from "@/lib/trade/types";
import type { PlanView } from "@/lib/swap/types";

export interface TradeOverlayModalProps {
  isOpen: boolean;
  onClose: () => void;
  token: TokenMarketData;
  initialMode?: "buy" | "sell";
  canonicalRwaAddresses?: Iterable<string>;
  onPlanContext?: (plan: PlanView | null) => void;
}

// The /swap card in the /swap frame (operator, L213 #24). The window adds only drag and close;
// its old title bar, refresh, minimise and resize duplicated the card's own controls.
const WIDTH = 500;
const MARGIN = 12;
const DRAG_THRESHOLD_PX = 4;
const DRAG_EXCLUDED = "button, a, input, textarea, select, label, [role='button'], [role='dialog'], [role='slider'], [contenteditable='true']";

export function TradeOverlayModal(props: TradeOverlayModalProps) {
  return props.isOpen ? <TradeWindow {...props} /> : null;
}

const width = () => Math.min(WIDTH, window.innerWidth - 2 * MARGIN);
const clampTo = (x: number, y: number, height: number) => ({
  x: Math.min(Math.max(MARGIN, x), Math.max(MARGIN, window.innerWidth - width() - MARGIN)),
  y: Math.min(Math.max(MARGIN, y), Math.max(MARGIN, window.innerHeight - Math.min(height, window.innerHeight - 2 * MARGIN) - MARGIN)),
});

function TradeWindow({
  onClose,
  token,
  initialMode = "buy",
  canonicalRwaAddresses,
  onPlanContext,
}: TradeOverlayModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const clamp = useCallback((x: number, y: number) => clampTo(x, y, cardRef.current?.offsetHeight ?? 600), []);

  // Mounted only while open, so docking top-right below the top bar is just the initial state.
  const [position, setPosition] = useState(() => clampTo(window.innerWidth - width() - 24, 76, 600));
  const [isFocused, setIsFocused] = useState(true);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const onResize = () => setPosition((p) => clamp(p.x, p.y));
    const onPointerDown = (e: PointerEvent) => setIsFocused(!!cardRef.current?.contains(e.target as Node));
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape" && isFocused) onClose(); };
    window.addEventListener("resize", onResize);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isFocused, onClose, clamp]);

  // Drag from any point on the card except a control. A 4px threshold keeps clicks as clicks.
  const handleDragStart = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest(DRAG_EXCLUDED)) return;
    const start = { px: e.clientX, py: e.clientY, x: position.x, y: position.y };
    let dragging = false;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - start.px;
      const dy = ev.clientY - start.py;
      if (!dragging) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        dragging = true;
        setIsDragging(true);
        window.getSelection()?.removeAllRanges();
        document.body.style.userSelect = "none";
      }
      ev.preventDefault();
      setPosition(clamp(start.x + dx, start.y + dy));
    };
    const onUp = () => {
      if (dragging) {
        setIsDragging(false);
        document.body.style.userSelect = "";
      }
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  return (
    <AnimatePresence>
      {/* Non-blocking: no backdrop, the chart and page stay usable. */}
      <div className="pointer-events-none fixed inset-0 z-40 select-none">
        <motion.div
          ref={cardRef}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          style={{ position: "fixed", left: position.x, top: position.y, width: `min(${WIDTH}px, calc(100vw - ${2 * MARGIN}px))` }}
          className={`pointer-events-auto rounded-[28px] ${isFocused ? "z-50" : "z-40"} ${isDragging ? "cursor-grabbing select-none" : "select-auto"}`}
        >
          {/* Outside the frame, so the card and frame stay identical to /swap. */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close trade window"
            title="Close"
            className="absolute -right-2 -top-2 z-10 grid size-7 place-items-center rounded-full border border-white/15 bg-[#171919] text-[#c5c9c3] shadow-lg transition-colors hover:border-[#e0897a]/50 hover:text-[#e0897a]"
          >
            <X className="size-3.5" />
          </button>
          <SwapFrame
            onPointerDown={handleDragStart}
            bodyClassName="no-scrollbar max-h-[calc(100vh-48px)] overflow-y-auto overscroll-contain"
          >
            <ModernTradingCard
              tokenAddress={token.address}
              tokenSymbol={token.symbol}
              tokenName={token.name}
              tokenImageUrl={token.avatarUrl}
              decimals={
                token.address?.toLowerCase() === token.baseToken?.address?.toLowerCase()
                  ? token.baseToken?.decimals
                  : (token.address?.toLowerCase() === token.quoteToken?.address?.toLowerCase()
                      ? token.quoteToken?.decimals
                      : 18)
              }
              priceUsd={token.priceUsd}
              priceEth={token.priceEth}
              initialMode={initialMode}
              onPlanContext={onPlanContext}
              canonicalRwaAddresses={canonicalRwaAddresses}
            />
          </SwapFrame>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
