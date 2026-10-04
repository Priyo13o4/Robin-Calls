import type { ReactNode } from "react";

/**
 * Numbered section head — the mono card title lifted out of the card so the
 * page reads as one document with numbered parts, not stacked boxes. Shared by
 * the server page and the client explorers so a section number and a badge
 * cannot be styled two ways.
 */
export function SectionHead({
  n,
  title,
  sub,
  badge,
}: {
  n: string;
  title: string;
  sub?: string;
  /** Draft/mock marker. Rendered before `sub` so it reads first. */
  badge?: ReactNode;
}) {
  return (
    // Display type, not a mono label. These are the page's chapter titles and
    // they sit under an 8rem hero number; at 11px mono they read as captions
    // for the box below them instead of as headings.
    <div className="mb-[26px] border-b border-[#1e1e1e] pb-[16px]">
      <div className="flex flex-wrap items-baseline gap-x-[16px] gap-y-[10px]">
        <span className="font-mono text-[19px] font-bold tabular-nums text-[#ccff00]">{n}</span>
        <h2 className="font-cinzel text-[clamp(33px,4.8vw,53px)] font-black leading-[1.05] tracking-wide text-white">
          {title}
        </h2>
        {badge && (
          <span className="border border-[#2a2a2a] px-1.5 py-px font-mono text-[11px] tracking-[0.14em] text-[#d9c96a]">
            {badge}
          </span>
        )}
      </div>
      {sub && (
        <p className="mt-[10px] max-w-2xl font-serif text-[19px] italic leading-[1.618] text-[#d9d9d3] sm:text-[20px]">
          {sub}
        </p>
      )}
    </div>
  );
}
