import { TOTAL_SUPPLY } from "@/lib/sale/projection";
import { TOKENOMICS, allocationShades } from "@/lib/sale/tokenomics";

/**
 * The split as a ring, beside the circulating-supply curve — a second read of
 * the same seven numbers `AllocationTable`/`AllocationCity` already show in
 * section 01, so it reuses their exact data and colours
 * (`allocationShades(TOKENOMICS)`) rather than inventing a third palette.
 *
 * Stroke-based, not `<path>` wedges: each segment is a dash on one circle,
 * offset by the running total of everything before it. Simpler to get right
 * than arc-path trigonometry, and it is what lets the ring start at 12
 * o'clock (`rotate(-90 ${C} ${C})`) instead of 3 o'clock.
 */
export function AllocationDonut({
  size = 220,
  /** Skips the border/background/padding — the landing page places this
   *  inside its own two-column layout and supplies its own chrome. */
  bare = false,
}: {
  size?: number;
  bare?: boolean;
}) {
  const stroke = Math.round(size * 0.136);
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;

  const shadeOf = allocationShades(TOKENOMICS);
  let offset = 0;
  const segments = TOKENOMICS.map((row) => {
    const length = (row.pct / 100) * circ;
    const seg = { row, length, offset };
    offset += length;
    return seg;
  });

  return (
    <div
      className={
        bare
          ? "flex flex-col items-center gap-5"
          : "flex flex-col items-center gap-5 border border-[#2a2a2a] bg-[#141414] px-5 py-6"
      }
    >
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        role="img"
        aria-label={`The split as a ring: ${TOKENOMICS.map((row) => `${row.label} ${row.pct}%`).join(", ")}.`}
      >
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1c1c1c" strokeWidth={stroke} />
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {segments.map((seg) => (
            <circle
              key={seg.row.label}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={shadeOf.get(seg.row.label)}
              strokeWidth={stroke}
              strokeDasharray={`${seg.length} ${circ - seg.length}`}
              strokeDashoffset={-seg.offset}
            />
          ))}
        </g>
        <text
          x={size / 2}
          y={size / 2 - 8}
          textAnchor="middle"
          className="fill-[#ededea] font-cinzel font-black tabular-nums"
          style={{ fontSize: Math.max(11, size * 0.068) }}
        >
          {TOTAL_SUPPLY.toLocaleString('en-US')}
        </text>
        <text
          x={size / 2}
          y={size / 2 + 12}
          textAnchor="middle"
          className="fill-[#6a6a6a] font-mono tracking-[0.2em]"
          style={{ fontSize: Math.max(7, size * 0.041) }}
        >
          ROBINCALLS
        </text>
      </svg>

      <ul className="grid w-full grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {TOKENOMICS.map((row) => (
          <li key={row.label} className="flex items-center gap-2 font-mono text-[10px] tracking-[0.1em] text-[#8a8a8a]">
            <span aria-hidden className="h-2 w-2 flex-none" style={{ background: shadeOf.get(row.label) }} />
            <span className="min-w-0 truncate text-[#c4c4c4]">{row.label}</span>
            <span className="ml-auto flex-none tabular-nums text-[#ededea]">{row.pct}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
