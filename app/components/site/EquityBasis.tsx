import type { EquityBasisView } from "@/lib/market/equity-basis";

// Presentational reference price banner matching swap warning banner styles.
export function EquityBasis({
  view,
  snapshotLabel,
}: {
  view: EquityBasisView;
  snapshotLabel?: string;
}) {
  const toneClasses =
    view.tone === "warn"
      ? "border-[#8a6d1f] bg-[#1a180e] text-[#d9c96a]"
      : "border-[#2a2a2a] bg-[#101010] text-white";

  return (
    <div className={`mb-4 border p-3 font-mono text-xs ${toneClasses}`}>
      <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="font-bold uppercase tracking-wider">Reference price</p>
        {snapshotLabel && <p className="text-[10px] normal-case tracking-normal text-[#a3a3a3]">{snapshotLabel}</p>}
      </div>
      {view.lines.map((line, idx) => (
        <p key={idx}>{line}</p>
      ))}
    </div>
  );
}
