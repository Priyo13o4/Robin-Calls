import { NoirShell, PageHeader } from "../components/site/NoirShell";
import { SkeletonRwaPage } from "../components/site/Skeleton";
import { cdnUrl } from "@/lib/config/cdn";

export default function RwaLoading() {
  return (
    <NoirShell>
      <div className="relative min-h-screen w-full">
        {/* Background Layer */}
        <div className="pointer-events-none fixed inset-0 z-0 bg-[#0a0a0a]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cdnUrl("/backgrounds/rwa-bg.webp")}
            alt=""
            className="absolute left-0 top-0 h-full w-full object-cover object-center opacity-70"
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, #0A0A0A 0%, rgba(10,10,10,0.80) 25%, rgba(10,10,10,0.80) 75%, #0A0A0A 100%)",
            }}
          />
        </div>

        {/* Film grain noise */}
        <div
          className="pointer-events-none fixed inset-0 z-[1] opacity-[0.055]"
          style={{
            backgroundImage:
              'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'240\' height=\'240\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.85\' numOctaves=\'2\'/%3E%3C/filter%3E%3Crect width=\'240\' height=\'240\' filter=\'url(%23n)\'/%3E%3C/svg%3E")',
            backgroundRepeat: "repeat",
          }}
        />

        {/* Content Layer */}
        <div className="relative z-10">
          <PageHeader
            eyebrow="ROBINHOOD CHAIN · AUTHENTICITY REGISTRY"
            title="TRUSTED RWAs"
            subline="Authentic Robinhood assets only. A trusted badge proves the registered address still matches the canonical beacon and Stock implementation; it is not investment advice or a liquidity guarantee."
          />
          <SkeletonRwaPage />
        </div>
      </div>
    </NoirShell>
  );
}
