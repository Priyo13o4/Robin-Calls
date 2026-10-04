import Link from "next/link";
import { cdnUrl } from "@/lib/config/cdn";
import { NavIcon } from "../nav-icons";
import { LandingIcon, type LandingIconKey } from "./icons";
import { Display, LimeButton } from "./Section";
import { SmartImage } from "../SmartImage";

type Glyph = { kind: "landing"; name: LandingIconKey } | { kind: "nav"; name: "ecosystem" };

const REASONS: Array<{ glyph: Glyph; title: string; body: string }> = [
  {
    glyph: { kind: "landing", name: "shield" },
    title: "Evidence, not opinions",
    body: "Deterministic scores. Fully re-derivable.",
  },
  {
    glyph: { kind: "landing", name: "community" },
    title: "Built for the community",
    body: "Open data. On-chain records.",
  },
  {
    glyph: { kind: "landing", name: "signal" },
    title: "More discovery, less noise",
    body: "Real traction surfaces. Manipulation gets filtered.",
  },
  {
    glyph: { kind: "nav", name: "ecosystem" },
    title: "A stronger ecosystem",
    body: "Trusted projects, tools and builders in one place.",
  },
];

/**
 * "A more transparent Robinhood Chain" — the comps' three-part band: the
 * crowd plate bleeding off the left edge, the pitch in the middle, the four
 * reasons stacked at the right.
 *
 * The plate is `absolute` so it can escape `max-w-[1320px]` to the viewport edge.
 * Its own artwork carries readable text ("a safer chain builds a brighter
 * tomorrow"), so it is cropped from the left where the crowd is, not centred
 * on the lettering — two competing headlines in one band.
 */
export function WhyRobinCalls() {
  return (
    <section className="relative overflow-hidden border-t border-[#2a2a2a] bg-[#0a0a0a]">
      <div className="pointer-events-none absolute inset-y-0 left-0 hidden w-[26%] lg:block">
        <SmartImage
          src={cdnUrl("/backgrounds/closing-cta-crowd.webp")}
          alt=""
          className="h-full w-full object-cover object-[22%_center]"
        />
        <div className="absolute inset-0 bg-gradient-to-l from-[#0a0a0a] via-[#0a0a0a]/45 to-transparent" />
      </div>

      <div className="relative z-10 mx-auto max-w-[1320px] px-4 py-12 sm:px-8 sm:py-16">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:pl-[22%]">
          <div>
            <Display>
              A more
              <br />
              transparent
              <br />
              Robinhood Chain.
            </Display>
            <p className="mt-4 max-w-sm font-inter text-[14px] leading-relaxed text-[#c7c7c2]">
              Same chain. Different outcome. Join traders, builders and researchers using RobinCalls
              to navigate smarter.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <LimeButton href="/scan">Scan a token →</LimeButton>
              <Link
                href="/ecosystem"
                className="brutalist-box brutalist-shadow-light brutalist-pressable halftone-dark inline-block whitespace-nowrap border-[#ededea] px-5 py-3 font-inter text-[11px] font-bold uppercase tracking-[0.16em] text-[#ededea]"
              >
                Explore ecosystem →
              </Link>
            </div>
          </div>

          <ul className="flex flex-col gap-3">
            {REASONS.map((r) => (
              <li key={r.title} className="flex items-start gap-3.5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center border border-[#2a2a2a] bg-[#141414] text-[#ededea]">
                  {r.glyph.kind === "landing" ? (
                    <LandingIcon name={r.glyph.name} size={19} />
                  ) : (
                    <NavIcon name={r.glyph.name} size={19} />
                  )}
                </span>
                <span className="min-w-0 pt-0.5">
                  <span className="block font-inter text-[13px] font-bold uppercase tracking-[0.08em] text-[#ededea]">
                    {r.title}
                  </span>
                  <span className="mt-0.5 block font-inter text-[12px] leading-relaxed text-[#8a8a8a]">
                    {r.body}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
