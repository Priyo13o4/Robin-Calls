import Link from "next/link";
import { AllocationDonut } from "../../../tokenomics/AllocationDonut";
import { TOKENOMICS } from "@/lib/sale/tokenomics";
import { TOTAL_SUPPLY } from "@/lib/sale/projection";
import { flags } from "@/lib/config/flags";
import { Display, Eyebrow, Section, Standfirst } from "./Section";

/**
 * Tokenomics (/tokenomics) and the Token Sale (/token-sale) side by side.
 * When flags.tokenSale is off, the tile links to the public teaser page.
 */
export function TokenSection() {
  const topRows = TOKENOMICS.slice(0, 4);

  return (
    <Section id="tokenomics">
      <div className="mb-6">
        <Eyebrow>The token</Eyebrow>
        <Display>The fuel behind the signal.</Display>
        <Standfirst>
          Where the supply sits, and how the public sale will be run when it opens.
        </Standfirst>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {/* Tokenomics — the real numbers from lib/sale/tokenomics.ts. */}
        <Link
          href="/tokenomics"
          className="group flex flex-col gap-5 border border-[#2a2a2a] bg-[#141414] p-5 transition-colors hover:border-[#8a8a8a] sm:flex-row sm:items-center"
        >
          <AllocationDonut size={104} bare />
          <div className="min-w-0 flex-1">
            <h3 className="mb-1 font-cinzel text-[16px] font-bold uppercase tracking-[0.04em] text-[#ededea]">
              Tokenomics
            </h3>
            <p className="mb-3 font-mono text-[11px] text-[#8a8a8a]">
              {TOTAL_SUPPLY.toLocaleString("en-US")} ROBINCALLS · split {TOKENOMICS.length} ways
            </p>
            <div className="mb-3 flex flex-col gap-1">
              {topRows.map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between gap-3 font-inter text-[11px] text-[#8a8a8a]"
                >
                  <span className="truncate">{row.label}</span>
                  <span className="font-mono text-[#c7c7c2]">{row.pct}%</span>
                </div>
              ))}
            </div>
            <span className="font-inter text-[10px] font-bold uppercase tracking-[0.14em] text-[#ccff00]">
              View full tokenomics →
            </span>
          </div>
        </Link>

        {/* Token sale. Both branches link to /token-sale: flag-off renders the
            indexed teaser (SaleTeaser), not a 404, so this is never a dead link. */}
        {flags.tokenSale ? (
          <Link
            href="/token-sale"
            className="group flex flex-col justify-between border border-[#ccff00] bg-[#141414] p-4"
          >
            <div>
              <p className="mb-2 inline-flex items-center gap-2 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-[#ccff00]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#ccff00]" /> Live
              </p>
              <h3 className="mb-1.5 font-cinzel text-[16px] font-bold uppercase tracking-[0.04em] text-[#ededea]">
                Token sale
              </h3>
              <p className="font-inter text-[13px] leading-relaxed text-[#8a8a8a]">
                Public fair launch, pro-rata pool. Contribute and see where your allocation lands.
              </p>
            </div>
            <span className="mt-4 font-inter text-[10px] font-bold uppercase tracking-[0.14em] text-[#ccff00]">
              Go to the sale →
            </span>
          </Link>
        ) : (
          <Link
            href="/token-sale"
            className="group flex flex-col justify-between border border-[#2a2a2a] bg-[#141414] p-4 transition-colors hover:border-[#8a8a8a]"
          >
            <div>
              <p className="mb-2 font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-[#8a8a8a]">
                DATE TO BE ANNOUNCED
              </p>
              <h3 className="mb-1.5 font-cinzel text-[16px] font-bold uppercase tracking-[0.04em] text-[#ededea]">
                Token sale
              </h3>
              <p className="font-inter text-[13px] leading-relaxed text-[#8a8a8a]">
                A public fair launch. One pool, one price, fixed when the sale closes. The date is not set yet.
              </p>
              <p className="mt-2 font-inter text-[13px] leading-relaxed text-[#8a8a8a]">
                If you see a token trading under our name today, it is not us. Scan it and run your own verdict.
              </p>
            </div>
            <span className="mt-4 font-inter text-[10px] font-bold uppercase tracking-[0.14em] text-[#ccff00]">
              How the sale works →
            </span>
          </Link>
        )}
      </div>
    </Section>
  );
}
