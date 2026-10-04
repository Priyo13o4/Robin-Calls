import Link from "next/link";
import { HelpCircle } from "lucide-react";
import { NoirShell } from "@/app/components/site/NoirShell";
import { PageBackdrop } from "@/app/components/site/PageBackdrop";
import { SALE_FAQ } from "@/lib/sale/faq";

function faqPageJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: SALE_FAQ.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.a,
      },
    })),
  };
}

export function SaleTeaser() {
  return (
    <NoirShell>
      <PageBackdrop src="/backgrounds/token-sale-bg.webp" />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqPageJsonLd()) }}
      />
      <div className="relative z-[2]">
        <header className="mx-auto max-w-4xl px-4 pt-16 sm:px-6 sm:pt-24">
          <p className="mb-4 font-mono text-[11px] font-medium tracking-[0.3em] text-[#8a8a8a] uppercase">
            Date to be announced
          </p>
          <h1 className="font-cinzel text-4xl font-black leading-tight tracking-wide text-[#ededea] sm:text-6xl">
            The RobinCalls token sale
          </h1>
          <div className="mt-8 space-y-5 font-serif text-[17px] italic leading-relaxed text-[#8a8a8a]">
            <p>
              One pool of tokens, sold at one price. Contribute ETH while the sale is open.
              When it closes, the price is the raise divided across the pool, so your slice
              of the pool is your slice of the raise. Two people who paid the same paid the
              same, whatever order they arrived in.
            </p>
            <p>
              Tokens are claimed, never pushed. Nothing runs out of gas and strands your
              allocation. If the sale is called off, every wei comes back the same way.
            </p>
          </div>
          <div className="mt-8">
            <Link
              href="/tokenomics"
              className="inline-flex items-center gap-2 font-inter text-xs font-bold uppercase tracking-[0.16em] text-[#ccff00] transition-colors hover:text-[#ededea]"
            >
              Where the supply sits →
            </Link>
          </div>
        </header>

        <main className="mx-auto max-w-4xl px-4 pb-24 pt-16 sm:px-6 sm:pt-20">
          <section className="overflow-hidden border-2 border-[#2a2a2a] bg-[#141414] shadow-[8px_8px_0_0_#1c1c1c]">
            <div className="flex items-center justify-between gap-3 border-b border-[#2a2a2a] px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex size-7 items-center justify-center border border-[#2a2a2a] bg-[#101010] text-[#ccff00]">
                  <HelpCircle className="size-4" aria-hidden />
                </div>
                <h2 className="text-[16px] font-semibold tracking-[0.01em] text-white sm:text-[19px]">
                  Frequently Asked Questions
                </h2>
              </div>
              <span className="rounded-full border border-[#2a2a2a] px-2.5 py-0.5 font-mono text-[10px] text-[#8a8a8a]">
                {SALE_FAQ.length} items
              </span>
            </div>

            <div className="divide-y divide-[#2a2a2a]">
              {SALE_FAQ.map((item) => (
                <details
                  key={item.q}
                  className="group px-5 py-4 transition-colors hover:bg-[#181812]"
                >
                  <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-left text-sm font-semibold text-[#ededea] transition-colors hover:text-[#ccff00]">
                    <span>{item.q}</span>
                    <span
                      aria-hidden
                      className="mt-0.5 flex-none font-mono text-base text-[#8a8a8a] transition-transform duration-200 group-open:rotate-45 group-open:text-[#ccff00]"
                    >
                      +
                    </span>
                  </summary>
                  <p className="mt-3 text-xs leading-relaxed text-[#a0a09a]">
                    {item.a}
                  </p>
                </details>
              ))}
            </div>
          </section>
        </main>
      </div>
    </NoirShell>
  );
}
