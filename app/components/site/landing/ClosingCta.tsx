import Link from "next/link";
import { cdnUrl } from "@/lib/config/cdn";
import { SmartImage } from "../SmartImage";

/** The last word, over the guardian plate: eyebrow, two display lines, the two
 *  actions, and the pull quote the comps set apart at the right. */
export function ClosingCta() {
  return (
    <section className="relative overflow-hidden border-t border-[#2a2a2a] bg-[#0a0a0a]">
      <div className="pointer-events-none absolute inset-0 z-0">
        <SmartImage
          src={cdnUrl("/backgrounds/robin-knight-archway.webp")}
          alt=""
          className="h-full w-full object-cover object-[58%_35%]"
        />
        <div className="absolute inset-0 bg-[#0a0a0a]/55" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0a] via-transparent to-[#0a0a0a]/80" />
      </div>

      <div className="relative z-10 mx-auto flex max-w-[1320px] flex-col items-start justify-between gap-8 px-4 py-14 sm:px-8 sm:py-20 lg:flex-row lg:items-end">
        <div>
          <p className="mb-3.5 font-mono text-[10px] font-medium uppercase tracking-[0.26em] text-[#8a8a8a]">
            One chain. A safer tomorrow.
          </p>
          <h2 className="font-cinzel text-[26px] font-bold uppercase leading-[1.1] tracking-[0.01em] text-[#ededea] sm:text-[38px] xl:text-[44px]">
            <span className="block text-[#8a8a8a]">Don&apos;t trust the ticker.</span>
            Check the record.
          </h2>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href="/scan"
              className="brutalist-box brutalist-shadow-dark brutalist-pressable halftone-light inline-block whitespace-nowrap border-[#ccff00] bg-[#ccff00] px-7 py-3.5 font-inter text-[12px] font-bold uppercase tracking-[0.18em] text-[#0a0a0a]"
            >
              Scan a token →
            </Link>
            <Link
              href="/overview"
              className="brutalist-box brutalist-shadow-light brutalist-pressable halftone-dark inline-block whitespace-nowrap border-[#ededea] px-7 py-3.5 font-inter text-[12px] font-bold uppercase tracking-[0.18em] text-[#ededea]"
            >
              Explore RobinCalls →
            </Link>
          </div>
        </div>

        <blockquote className="max-w-[280px] border border-[#2a2a2a] bg-[#0a0a0a]/70 px-4 py-3.5">
          <p className="font-serif text-[14px] italic leading-relaxed text-[#c7c7c2]">
            &ldquo;A more transparent Robinhood Chain is a stronger chain.&rdquo;
          </p>
        </blockquote>
      </div>
    </section>
  );
}
