import { NoirShell } from "@/app/components/site/NoirShell";
import { PageBackdrop } from "@/app/components/site/PageBackdrop";
import { ShimmerBlock } from "@/app/components/site/Skeleton";

/**
 * /token-sale is force-dynamic, so a click used to hold the user on the
 * previous page for the whole server render. This shell streams first and the
 * page swaps in behind it.
 *
 * It renders the SHELL only: no headline, no figures, not even a zeroed one.
 * A skeleton that guesses at content is a claim about content (§8 #3), and
 * this route has two very different bodies behind the sale flag.
 */
export default function TokenSaleLoading() {
  return (
    <NoirShell>
      <PageBackdrop src="/backgrounds/token-sale-bg.webp" />
      <div className="relative z-[2]" aria-busy="true" aria-label="Loading the token sale">
        <header className="mx-auto max-w-4xl px-4 pt-16 sm:px-6 sm:pt-24">
          <ShimmerBlock className="h-3 w-44" />
          <ShimmerBlock className="mt-6 h-12 w-full max-w-2xl sm:h-16" />
          <div className="mt-8 space-y-3">
            <ShimmerBlock className="h-4 w-full" />
            <ShimmerBlock className="h-4 w-11/12" />
            <ShimmerBlock className="h-4 w-8/12" />
          </div>
          <ShimmerBlock className="mt-8 h-4 w-52" />
        </header>

        <main className="mx-auto max-w-4xl px-4 pb-24 pt-16 sm:px-6 sm:pt-20">
          <div className="border-2 border-[#2a2a2a] bg-[#141414] shadow-[8px_8px_0_0_#1c1c1c]">
            <div className="border-b border-[#2a2a2a] px-5 py-4">
              <ShimmerBlock className="h-5 w-56" />
            </div>
            <div className="divide-y divide-[#2a2a2a]">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="px-5 py-5">
                  <ShimmerBlock className="h-4 w-3/4" />
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    </NoirShell>
  );
}
