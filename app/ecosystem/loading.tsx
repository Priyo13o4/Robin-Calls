import { NoirShell, PageHeader } from "../components/site/NoirShell";
import { SkeletonBillboard, SkeletonCarouselRow } from "../components/site/Skeleton";
import { cdnUrl } from "@/lib/config/cdn";

export default function EcosystemLoading() {
  return (
    <NoirShell>
      <div className="relative min-h-screen w-full">
        {/* Background Layer */}
        <div className="pointer-events-none fixed inset-0 z-0 bg-[#0a0a0a]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cdnUrl("/backgrounds/library-directory-bg.webp")}
            alt=""
            className="absolute left-0 top-0 h-full w-full object-cover object-center opacity-90"
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, #0A0A0A 0%, rgba(10,10,10,0.75) 20%, rgba(10,10,10,0.75) 80%, #0A0A0A 100%)",
            }}
          />
        </div>

        {/* Content Layer */}
        <div className="relative z-10">
          <PageHeader
            title="THE ECOSYSTEM"
            subline="The agent era of Robinhood Chain. Indexed."
          />
          <section className="mx-auto max-w-7xl px-4 pb-24 sm:px-6">
            <SkeletonBillboard />
            <SkeletonCarouselRow />
            <SkeletonCarouselRow />
          </section>
        </div>
      </div>
    </NoirShell>
  );
}
