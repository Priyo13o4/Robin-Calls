"use client";

import { TOTAL_SUPPLY } from "@/lib/sale/projection";
import { tokensFor, type AllocationRow } from "@/lib/sale/tokenomics";

/**
 * The split, as one table.
 *
 * NO COLOUR RAMP. Rows used to carry the ranked lime shades from
 * `allocationShades`, which tinted every row a different strength of green —
 * a second encoding of a percentage already printed two columns to the right,
 * and it made the small allocations read as faded-out or disabled. Lime is the
 * scarce accent here (DESIGN.md): it marks the row the reader is pointing at,
 * and nothing else. The shades still exist for the stacked circulating chart,
 * where seven overlapping bands genuinely need to be told apart.
 *
 * The TOTAL row sums what is actually rendered rather than printing 100 — a
 * split that stops summing must show up here, not be papered over.
 *
 * `active` is shared with AllocationCity: hovering a row lifts its building
 * and hovering a building highlights its row. One piece of state, held by the
 * parent, because two copies would be two answers to "which allocation is the
 * reader looking at".
 */
export function AllocationTable({
  rows,
  active = null,
  onActive,
  compact = false,
}: {
  rows: AllocationRow[];
  active?: string | null;
  onActive?: (key: string | null) => void;
  /** Beside the city: drops the per-row note, which the building's own label
   *  already carries, and tightens the row height so the two columns line up. */
  compact?: boolean;
}) {
  const total = rows.reduce((n, r) => n + r.pct, 0);

  return (
    <div
      className="overflow-x-auto bg-[#141414]"
      // A pointer that leaves the table without entering a row must clear the
      // link, or the last row stays lit and its building stays raised.
      onMouseLeave={() => onActive?.(null)}
    >
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="font-mono text-[12px] uppercase tracking-[0.2em] text-[#ccff00]/80">
            <th className="border-b border-[#242424] px-4 pb-2.5 pt-4 font-medium sm:px-5">
              Allocation
            </th>
            <th className="border-b border-[#242424] px-2 pb-2.5 pt-4 text-right font-medium">
              Share
            </th>
            <th className="border-b border-[#242424] px-4 pb-2.5 pt-4 text-right font-medium sm:px-5">
              Tokens
            </th>
          </tr>
        </thead>

        <tbody>
          {rows.map((r) => (
            <RowGroup
              key={r.label}
              row={r}
              active={active}
              onActive={onActive}
              compact={compact}
            />
          ))}
        </tbody>

        <tfoot>
          <tr className="font-mono text-[12px] uppercase tracking-[0.2em]">
            <td className="border-t border-[#2f2f2f] px-4 py-4 text-white sm:px-5">Total</td>
            <td className="border-t border-[#2f2f2f] px-2 py-4 text-right text-[15.5px] font-bold tabular-nums text-[#ededea]">
              {total}%
              {total !== 100 && (
                <span className="ml-2 font-normal normal-case tracking-normal text-[#d9c96a]">
                  does not sum to 100
                </span>
              )}
            </td>
            <td className="border-t border-[#2f2f2f] px-4 py-4 text-right text-[14.5px] font-bold tabular-nums text-[#ededea] sm:px-5">
              {TOTAL_SUPPLY.toLocaleString('en-US')}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function RowGroup({
  row,
  active,
  onActive,
  compact,
}: {
  row: AllocationRow;
  active: string | null;
  onActive?: (key: string | null) => void;
  compact: boolean;
}) {
  const on = active === row.city;
  const link = onActive
    ? {
        onMouseEnter: () => onActive(row.city),
        onFocus: () => onActive(row.city),
      }
    : {};

  return (
    <>
      <tr
        {...link}
        className={`group transition-colors duration-150 ${on ? "bg-[#191913]" : "hover:bg-[#171717]"}`}
      >
        <td
          className={`relative border-b border-[#1c1c1c] px-4 align-middle sm:px-5 ${compact ? "py-2.5" : "py-3.5"}`}
        >
          {/* The active marker is a rail on the row's leading edge rather than
              a swatch: a coloured square next to a coloured percentage reads as
              a legend key for a colour that no longer means anything. */}
          <span
            aria-hidden
            className={`absolute inset-y-0 left-0 w-[2px] transition-colors duration-150 ${on ? "bg-[#ccff00]" : "bg-transparent"}`}
          />
          <span className="block font-mono text-[13px] font-bold uppercase leading-tight tracking-[0.16em] text-white">
            {row.label}
          </span>
          {!compact && (
            <span className="mt-1 block text-[13px] leading-relaxed text-[#8a8a8a]">
              {row.note}
            </span>
          )}
        </td>

        <td
          className={`border-b border-[#1c1c1c] px-2 text-right align-middle font-mono font-bold tabular-nums transition-colors duration-150 ${compact ? "py-2.5 text-[18px]" : "py-3.5 text-[20.5px]"} ${on ? "text-[#ccff00]" : "text-white"}`}
        >
          {row.pct}
          <span className="ml-px text-[0.72em] font-normal text-[#6a6a6a]">%</span>
        </td>

        <td
          className={`border-b border-[#1c1c1c] px-4 text-right align-middle font-mono text-[14.5px] tabular-nums text-[#8a8a8a] sm:px-5 ${compact ? "py-2.5" : "py-3.5"}`}
        >
          {tokensFor(row.pct).toLocaleString('en-US')}
        </td>
      </tr>

      {row.breakdown?.map((b, i) => (
        <tr
          key={b.label}
          {...link}
          className={`transition-colors duration-150 ${on ? "bg-[#141410]" : "hover:bg-[#171717]"}`}
        >
          <td className="border-b border-[#1c1c1c] py-2 pl-4 pr-4 align-middle sm:pl-5 sm:pr-5">
            <span className="flex items-center gap-2.5">
              {/* Tree glyph: a sub-row is a slice of the row above it, and any
                  mark of its own would read as an eighth top-level allocation. */}
              <span
                aria-hidden
                className="w-3 flex-none font-mono text-[13px] leading-none text-[#4a4a4a]"
              >
                {i === row.breakdown!.length - 1 ? "└" : "├"}
              </span>
              <span className="min-w-0">
                <span className="block font-mono text-[12px] uppercase leading-tight tracking-[0.08em] text-[#d9d9d3]">
                  {b.label}
                </span>
                {!compact && (
                  <span className="mt-0.5 block text-[13px] leading-relaxed text-[#5a5a5a]">
                    {b.note}
                  </span>
                )}
              </span>
            </span>
          </td>
          <td className="border-b border-[#1c1c1c] px-2 py-2 text-right align-middle font-mono text-[14.5px] tabular-nums text-[#8a8a8a]">
            {b.pct}
            <span className="ml-px text-[0.72em] text-[#5a5a5a]">%</span>
          </td>
          <td className="border-b border-[#1c1c1c] px-4 py-2 text-right align-middle font-mono text-[13px] tabular-nums text-[#5a5a5a] sm:px-5">
            {tokensFor(b.pct).toLocaleString('en-US')}
          </td>
        </tr>
      ))}
    </>
  );
}
