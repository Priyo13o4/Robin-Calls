"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, Check, TrendingDown, TrendingUp, X } from "lucide-react";
import type { TokenMarketData } from "@/lib/trade/types";

import { toast } from "@/components/ui/use-toast";

export interface PriceAlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  token: TokenMarketData;
  onAlertSet: (targetPrice: number, direction: "above" | "below") => void;
}

export function PriceAlertModal({
  isOpen,
  onClose,
  token,
  onAlertSet,
}: PriceAlertModalProps) {
  const currentPrice = token.priceUsd;
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [targetPrice, setTargetPrice] = useState<string>(
    (currentPrice * 1.1).toFixed(6)
  );
  const [saved, setSaved] = useState(false);

  const applyPercent = (pct: number) => {
    const factor = 1 + pct / 100;
    const newTarget = currentPrice * factor;
    setTargetPrice(newTarget.toFixed(6));
    setDirection(pct >= 0 ? "above" : "below");
  };

  const handleTestAlert = async () => {
    const num = parseFloat(targetPrice) || currentPrice;
    
    // Request permission if supported, but do not show blocking browser alert dialogs
    if (typeof window !== "undefined" && typeof Notification !== "undefined" && Notification.permission === "default") {
      await Notification.requestPermission();
    }

    // Fire RobinCalls in-app toast
    toast({
      variant: "warning",
      title: "🔔 Price Alert Triggered!",
      description: `${token.symbol} reached target of $${num.toFixed(6)} (current: $${currentPrice.toFixed(6)})`,
    });
  };

  const handleSave = async () => {
    const num = parseFloat(targetPrice);
    if (!num || isNaN(num) || num <= 0) return;

    // Request notification permission on save
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "default") {
        await Notification.requestPermission().catch(() => {});
      }
    }

    onAlertSet(num, direction);
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      onClose();
    }, 900);
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-black/75 backdrop-blur-sm"
        />

        {/* Modal Window */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="relative z-10 w-full max-w-sm rounded-2xl border border-[#2b2b2b] bg-[#0e0e0e] p-5 font-mono text-xs text-[#ededea] shadow-2xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#222222] pb-3 mb-4">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-[#ccff00]/10 p-1.5 text-[#ccff00] border border-[#ccff00]/20">
                <Bell className="size-4" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-[#ededea]">Set Price Alert</h3>
                <p className="text-[11px] text-[#777]">{token.symbol} · Current: ${currentPrice.toFixed(6)}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-[#8a8a8a] hover:bg-white/10 hover:text-white transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>

          {/* Direction toggle */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <button
              type="button"
              onClick={() => {
                setDirection("above");
                setTargetPrice((currentPrice * 1.1).toFixed(6));
              }}
              className={`flex items-center justify-center gap-1.5 rounded-lg py-2 border transition-colors ${
                direction === "above"
                  ? "border-[#8fbf6a] bg-[#102012] text-[#8fbf6a] font-bold"
                  : "border-[#222] bg-[#141414] text-[#888] hover:text-white"
              }`}
            >
              <TrendingUp className="size-3.5" />
              <span>Rises Above</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setDirection("below");
                setTargetPrice((currentPrice * 0.9).toFixed(6));
              }}
              className={`flex items-center justify-center gap-1.5 rounded-lg py-2 border transition-colors ${
                direction === "below"
                  ? "border-[#e0897a] bg-[#241210] text-[#e0897a] font-bold"
                  : "border-[#222] bg-[#141414] text-[#888] hover:text-white"
              }`}
            >
              <TrendingDown className="size-3.5" />
              <span>Drops Below</span>
            </button>
          </div>

          {/* Target Price Input */}
          <div className="rounded-xl border border-[#262626] bg-[#141414] p-3 mb-3">
            <div className="text-[10px] text-[#777] mb-1">TARGET PRICE (USD)</div>
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-[#888]">$</span>
              <input
                type="number"
                step="any"
                value={targetPrice}
                onChange={(e) => setTargetPrice(e.target.value)}
                className="w-full bg-transparent text-base font-bold text-white focus:outline-none"
                placeholder="0.000000"
              />
            </div>
          </div>

          {/* Quick Percentage Chips */}
          <div className="flex items-center gap-1.5 mb-4">
            {[+5, +10, +25, -5, -10, -25].map((pct) => (
              <button
                key={pct}
                type="button"
                onClick={() => applyPercent(pct)}
                className={`flex-1 rounded py-1 text-[10px] font-bold border transition-colors ${
                  pct > 0
                    ? "border-[#263820] bg-[#121c10] text-[#8fbf6a] hover:bg-[#1a2c16]"
                    : "border-[#382020] bg-[#1c1212] text-[#e0897a] hover:bg-[#2c1616]"
                }`}
              >
                {pct > 0 ? `+${pct}%` : `${pct}%`}
              </button>
            ))}
          </div>

          {/* Save Button */}
          <button
            type="button"
            onClick={handleSave}
            className={`w-full flex items-center justify-center gap-2 rounded-xl py-2.5 font-bold transition-all shadow-md ${
              saved
                ? "bg-[#8fbf6a] text-[#0a0a0a]"
                : "bg-[#ccff00] text-[#0a0a0a] hover:bg-[#b8e600]"
            }`}
          >
            {saved ? (
              <>
                <Check className="size-4" />
                <span>Alert Saved!</span>
              </>
            ) : (
              <>
                <Bell className="size-4" />
                <span>Set Price Alert</span>
              </>
            )}
          </button>

          {/* Test Alert Button */}
          <button
            type="button"
            onClick={handleTestAlert}
            className="w-full mt-2 flex items-center justify-center gap-1.5 py-1.5 text-[11px] text-[#8a8a8a] hover:text-[#ccff00] border border-[#222222] hover:border-[#333333] rounded-lg transition-colors"
          >
            <span>🔔 Test Browser & Toast Alert</span>
          </button>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
