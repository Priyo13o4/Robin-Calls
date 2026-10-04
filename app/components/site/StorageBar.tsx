import { TOTAL_SUPPLY } from "@/lib/sale/projection";

/**
 * Phone-storage-style allocation bar: one segmented track, shaded by RANK so
 * the largest share reads brightest, with a legend that repeats the shade.
 * Shades are a fixed ramp rather than computed from the percentage — a
 * continuous ramp makes 24% and 26% indistinguishable, and the point of the
 * colour is to separate the rows, not to re-encode a number already printed.
 */
const ALLOCATION_SHADES = ["#ccff00", "#a8d81a", "#7fae22", "#5c8424", "#3d5c1f", "#2a3f18"];

export function StorageBar({ rows }: { rows: { label: string; pct: number; note: string }[] }) {
  const ranked = [...rows].sort((a, b) => b.pct - a.pct);
  const shadeOf = new Map(ranked.map((r, i) => [r.label, ALLOCATION_SHADES[Math.min(i, ALLOCATION_SHADES.length - 1)]]));
  const total = rows.reduce((n, r) => n + r.pct, 0);

  return (
    <>
      <div className="flex h-6 w-full overflow-hidden border border-[#2a2a2a] bg-[#0a0a0a]">
        {rows.map((r) => (
          <div
            key={r.label}
            title={`${r.label} — ${r.pct}%`}
            // Normalised so the track always reads full; `total` is printed
            // below, so a split that does not sum to 100 is visible, not hidden.
            style={{ width: `${total > 0 ? (r.pct / total) * 100 : 0}%`, background: shadeOf.get(r.label) }}
            className="h-full border-r border-[#0a0a0a] last:border-r-0"
          />
        ))}
      </div>

      <div className="mt-4 space-y-1.5">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-3">
            <span className="h-2.5 w-2.5 flex-none" style={{ background: shadeOf.get(r.label) }} />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-[11px] tracking-[0.14em] text-[#ededea]">{r.label}</span>
              <span className="block truncate text-[11px] text-[#8a8a8a]">{r.note}</span>
            </span>
            {/* tokens derived from pct × TOTAL_SUPPLY — one source of truth */}
            <span className="hidden font-mono text-[11px] tabular-nums text-[#8a8a8a] sm:block">
              {Math.round((r.pct / 100) * TOTAL_SUPPLY).toLocaleString('en-US')}
            </span>
            <span className="w-12 text-right font-mono text-sm font-bold tabular-nums" style={{ color: shadeOf.get(r.label) }}>
              {r.pct}%
            </span>
          </div>
        ))}
      </div>

      <p className="mt-3 border-t border-[#2a2a2a] pt-2 font-mono text-[10px] tracking-[0.14em] text-[#4a4a4a]">
        {TOTAL_SUPPLY.toLocaleString('en-US')} TOTAL · {total}%{total !== 100 && <span className="ml-2 text-[#d9c96a]">— does not sum to 100</span>}
      </p>
    </>
  );
}
