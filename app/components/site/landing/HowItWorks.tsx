import { Display, Eyebrow, GhostButton, Section, Standfirst } from "./Section";

const STEPS = [
  { n: "01", title: "Read", body: "Bytecode, ownership, liquidity, deployer history." },
  {
    n: "02",
    title: "Simulate",
    body: "Test the exit on a fork. If you cannot get out, neither can your money.",
  },
  { n: "03", title: "Score", body: "A deterministic 0 to 100 verdict." },
  { n: "04", title: "Record", body: "Hash-chained. Verifiable forever." },
];

/** "From contract to receipt" — four boxed steps with the flow between them,
 *  as in the comps. The arrows are `aria-hidden` separators, not content.
 *
 *  The steps and the methodology button share a row only from `lg` up. Below
 *  that they were flex siblings competing for one line, so the grid took half
 *  the width and each card rendered at 59px: one word per line, with the button
 *  sitting over them. A `flex-1` grid next to a `shrink-0` button has no width
 *  of its own to defend. */
export function HowItWorks() {
  return (
    <Section>
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div>
          <Eyebrow>How it works</Eyebrow>
          <Display>
            From contract
            <br />
            to receipt.
          </Display>
          <Standfirst>A deterministic process. No oracle. No faith required.</Standfirst>
        </div>

        <div className="flex w-full flex-col gap-3 lg:w-auto lg:flex-1 lg:flex-row lg:flex-wrap lg:items-center lg:justify-end lg:gap-2">
          <div className="grid grid-cols-2 gap-2 lg:flex lg:flex-1 lg:items-stretch lg:gap-0">
            {STEPS.map((s, i) => (
              <div key={s.n} className="flex items-stretch lg:flex-1">
                <div className="flex w-full flex-col border border-[#2a2a2a] bg-[#141414] px-4 py-3.5">
                  <span className="font-mono text-[10px] font-bold tracking-[0.16em] text-[#8a8a8a]">
                    {s.n}
                  </span>
                  <h3 className="mb-1.5 mt-1 font-cinzel text-[14px] font-bold uppercase tracking-[0.04em] text-[#ededea]">
                    {s.title}
                  </h3>
                  <p className="font-inter text-[11px] leading-[1.45] text-[#8a8a8a]">{s.body}</p>
                </div>
                {i < STEPS.length - 1 && (
                  <span
                    aria-hidden
                    className="hidden shrink-0 items-center px-2 font-mono text-[12px] text-[#3d3d3d] lg:flex"
                  >
                    →
                  </span>
                )}
              </div>
            ))}
          </div>
          <GhostButton href="/methodology" className="self-start shrink-0 lg:self-auto">
            See full methodology →
          </GhostButton>
        </div>
      </div>
    </Section>
  );
}
