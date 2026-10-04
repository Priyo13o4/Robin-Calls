import { buildFaqJsonLd, type FaqItem } from "@/lib/config/seo";

// FAQPage markup must describe text a visitor can read on the page, so the
// JSON-LD and the visible list render from the same items.
export function SeoFaq({ items, className = "" }: { items: FaqItem[]; className?: string }) {
  return (
    <section className={`mx-auto max-w-5xl px-4 pb-20 sm:px-6 ${className}`}>
      <script
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildFaqJsonLd(items)) }}
      />
      <h2 className="mb-4 text-[11px] font-medium tracking-[0.3em] text-[#8a8a8a]">QUESTIONS</h2>
      <div className="divide-y divide-[#2a2a2a] border-y border-[#2a2a2a]">
        {items.map((item) => (
          <details key={item.q} className="group py-3">
            <summary className="cursor-pointer list-none text-sm text-[#ededea] group-open:text-[#ccff00]">
              {item.q}
            </summary>
            <p className="mt-2 max-w-3xl text-sm text-[#8a8a8a]">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
