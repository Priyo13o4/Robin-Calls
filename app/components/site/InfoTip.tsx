/**
 * A small "i" mark that shows a plain-text explanation on hover or tap.
 * Native `title` attribute, so it works with no JS and no extra state.
 * Use this next to any label that needs a short "what does this mean" note.
 */
export function InfoTip({ text }: { text: string }) {
  return (
    <span
      title={text}
      tabIndex={0}
      className="inline-flex h-3.5 w-3.5 shrink-0 cursor-help items-center justify-center rounded-full border border-[#454545] font-mono text-[9px] leading-none text-[#8a8a8a] hover:border-[#8a8a8a] hover:text-[#ededea]"
      aria-label={text}
    >
      i
    </span>
  );
}
