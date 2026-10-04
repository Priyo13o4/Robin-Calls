/**
 * The scrolling status rail from `/token-sale` (its `Marquee`), generalized so
 * any page can reuse the visual without owning a manifesto array. `/token-sale`
 * keeps its own `Marquee` — it renders a different, longer list of manifesto
 * lines, not a single announcement.
 */
export function ComingSoonRail({
  lines = ["NATIVE TOKEN BUY / SELL · COMING SOON"],
  className = "",
}: {
  lines?: string[];
  /** Callers pull this up over a `PageHeader`'s own bottom padding with a
   *  negative margin (e.g. "-mt-6") — the header's spacing is shared with
   *  every other page and shouldn't change just because this rail sits
   *  under it here. */
  className?: string;
}) {
  const row = (hidden: boolean) => (
    <div aria-hidden={hidden} className="flex flex-none items-center">
      {lines.map((m) => (
        <span key={m} className="flex flex-none items-center font-mono text-[11px] tracking-[0.22em] text-[#8a8a8a]">
          <span className="px-7">{m}</span>
          <span className="text-[#ccff00]">//</span>
        </span>
      ))}
    </div>
  );
  return (
    <div className={`overflow-hidden border-y border-[#2a2a2a] bg-[#0a0a0a]/80 py-2.5 ${className}`}>
      <div className="flex w-max animate-marquee">
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}
