import { cdnUrl } from "@/lib/config/cdn";
import { Display, Eyebrow, LimeButton, Standfirst } from "./Section";
import { RobinKnightTeaser } from "./RobinKnightTeaser";
import { SmartImage } from "../SmartImage";

/**
 * "Ask Robin Knight" — three zones in the comps: copy at the left, the live
 * composer in the middle, the guardian bleeding off the right edge with two
 * lines of marginalia over him.
 *
 * The photo is `absolute` rather than a grid column so it can bleed past
 * `max-w-[1320px]` to the viewport edge; the composer sits above it on the same
 * row, which is the overlap the comps show.
 */
export function RobinKnightSection() {
  return (
    <section className="relative overflow-hidden border-t border-[#2a2a2a] bg-[#0a0a0a] px-4 py-10 sm:px-8 sm:py-14">
      <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[46%] lg:block">
        <SmartImage
          src={cdnUrl("/backgrounds/robin-knight-archway.webp")}
          alt=""
          className="h-full w-full object-cover object-[68%_center]"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0a0a0a] via-[#0a0a0a]/55 to-[#0a0a0a]/25" />
      </div>

      <div className="relative z-10 mx-auto grid max-w-[1320px] grid-cols-1 items-center gap-8 lg:grid-cols-[340px_1fr_170px]">
        <div>
          <Eyebrow>AI investigator</Eyebrow>
          <Display>
            Ask
            <br />
            Robin Knight.
          </Display>
          <Standfirst>
            Go beyond the scan. Ask questions, trace wallets, investigate projects, and get
            evidence-backed answers directly from on-chain data.
          </Standfirst>
          <LimeButton href="/robin-knight" className="mt-5">
            Chat with Robin Knight →
          </LimeButton>
        </div>

        <RobinKnightTeaser />

        <div className="hidden text-right lg:block">
          <p className="font-mono text-[11px] font-medium uppercase leading-[2] tracking-[0.24em] text-[#ededea] [text-shadow:0_1px_6px_#0a0a0a]">
            Same
            <br />
            chain.
            <br />
            Deeper
            <br />
            answers.
          </p>
          <p className="mt-6 inline-block border border-[#2a2a2a] bg-[#0a0a0a]/80 px-3.5 py-2.5 text-left font-mono text-[10px] uppercase leading-[1.8] tracking-[0.16em] text-[#8a8a8a]">
            Evidence
            <br />
            not opinions.
          </p>
        </div>
      </div>
    </section>
  );
}
