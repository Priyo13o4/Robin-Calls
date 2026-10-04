"use client";

import { useEffect, useRef, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import {
  activeFilterCount, NO_FILTERS, PRESETS, PUMP_MIN_PCT, PUMP_MIN_TRADES,
  type MarketFilters, type Venue,
} from "@/lib/trade/market-filters";

const AGE: { label: string; v: number | null }[] = [
  { label: "Any", v: null }, { label: "< 1h", v: 60 }, { label: "< 6h", v: 360 }, { label: "< 24h", v: 1440 }, { label: "< 7d", v: 10_080 },
];
const LIQ: { label: string; v: number }[] = [
  { label: "Any", v: 0 }, { label: "$1K+", v: 1_000 }, { label: "$5K+", v: 5_000 }, { label: "$10K+", v: 10_000 }, { label: "$50K+", v: 50_000 },
];
const VOL: { label: string; v: number }[] = [
  { label: "Any", v: 0 }, { label: "$1K+", v: 1_000 }, { label: "$10K+", v: 10_000 }, { label: "$100K+", v: 100_000 },
];
const VENUES: { label: string; v: Venue }[] = [
  { label: "V2", v: "v2" }, { label: "V3", v: "v3" }, { label: "V4", v: "v4" }, { label: "Other", v: "other" },
];

function Chip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={on}
      onClick={onClick}
      className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
        on ? "border-[#ccff00]/60 bg-[#ccff00]/10 text-[#ccff00]" : "border-[#262626] bg-[#101010] text-[#d4d4d4] hover:border-[#3a3a3a]"
      }`}
    >
      {children}
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-[#8a8a8a]">{label}</div>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

/** Every choice combines with the others (AND). Presets only fill the same fields in. */
export function MarketFilterPanel({ value, onChange, onPreset, shown, total }: {
  value: MarketFilters;
  onChange: (next: MarketFilters) => void;
  onPreset: (preset: keyof typeof PRESETS) => void;
  shown: number;
  total: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const n = activeFilterCount(value);
  const set = (patch: Partial<MarketFilters>) => onChange({ ...value, ...patch });

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  return (
    <div ref={ref} className="relative flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => onPreset("freshPumps")}
        title={`Pools under 6h old, $5K+ liquidity, up ${PUMP_MIN_PCT}%+ in 5m on ${PUMP_MIN_TRADES}+ trades, one per name`}
        className="rounded-lg border border-[#242424] bg-[#141414] px-3 py-1.5 text-xs text-white hover:border-[#383838]"
      >
        🔥 Fresh pumps
      </button>
      <button
        type="button"
        onClick={() => onPreset("newLaunches")}
        title="Pools under 1h old with $1K+ liquidity, newest first, one per name"
        className="rounded-lg border border-[#242424] bg-[#141414] px-3 py-1.5 text-xs text-white hover:border-[#383838]"
      >
        🚀 New launches
      </button>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
          n > 0 ? "border-[#ccff00]/60 bg-[#ccff00]/10 text-[#ccff00]" : "border-[#242424] bg-[#141414] text-white hover:border-[#383838]"
        }`}
      >
        <SlidersHorizontal className="size-3.5" />
        Filters{n > 0 ? ` (${n})` : ""}
      </button>
      {n > 0 && (
        <button type="button" onClick={() => onChange(NO_FILTERS)} className="flex items-center gap-1 text-[11px] text-[#aaa] hover:text-white">
          <X className="size-3" /> Clear
        </button>
      )}
      {open && (
        <div className="absolute left-0 top-full z-40 mt-2 w-[340px] space-y-3 rounded-xl border border-[#2a2a2a] bg-[#0d0d0d] p-3.5 shadow-2xl">
          <Row label="Pool age">
            {AGE.map((o) => <Chip key={o.label} on={value.maxAgeMin === o.v} onClick={() => set({ maxAgeMin: o.v })}>{o.label}</Chip>)}
          </Row>
          <Row label="Liquidity">
            {LIQ.map((o) => <Chip key={o.label} on={value.minLiquidityUsd === o.v} onClick={() => set({ minLiquidityUsd: o.v })}>{o.label}</Chip>)}
          </Row>
          <Row label="24h volume">
            {VOL.map((o) => <Chip key={o.label} on={value.minVolume24hUsd === o.v} onClick={() => set({ minVolume24hUsd: o.v })}>{o.label}</Chip>)}
          </Row>
          <Row label="Momentum">
            <Chip on={value.pumping} onClick={() => set({ pumping: !value.pumping })} title={`Up ${PUMP_MIN_PCT}%+ in 5 minutes on ${PUMP_MIN_TRADES}+ trades`}>
              Pumping now
            </Chip>
            <Chip on={value.buyPressure} onClick={() => set({ buyPressure: !value.buyPressure })} title="More buys than sells in the last hour">
              More buys than sells
            </Chip>
          </Row>
          <Row label="Pool type">
            {VENUES.map((o) => (
              <Chip key={o.v} on={value.venues.includes(o.v)} onClick={() => set({ venues: value.venues.includes(o.v) ? value.venues.filter((x) => x !== o.v) : [...value.venues, o.v] })}>
                {o.label}
              </Chip>
            ))}
          </Row>
          <Row label="Copycats">
            <Chip on={value.onePerName} onClick={() => set({ onePerName: !value.onePerName })} title="Many launches reuse one name. Keep only the most active.">
              One per name
            </Chip>
          </Row>
          <p className="border-t border-[#1f1f1f] pt-2 text-[11px] text-[#8a8a8a]">
            Showing {shown} of {total}. Filters combine. A figure DexScreener did not report never passes a minimum.
          </p>
        </div>
      )}
    </div>
  );
}
