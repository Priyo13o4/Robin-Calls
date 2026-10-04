import { explorerWebUrl } from "@/lib/config/chain";
import { InfoTip } from "./InfoTip";
import type { LineageEdge, WalletStain } from "@/lib/types";

/**
 * THE MONEY TRAIL (#4) — the stained-funds web for one confirmed rugger,
 * rendered as a chain of custody. Each stained wallet is shown with the exact
 * transaction path that links it back to the rug, so the flag is re-verifiable
 * against public chain data. Hubs (exchanges/faucets) already broke the chain
 * upstream, so they never appear here.
 */

const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-4)}`;

export function MoneyTrail({
  deployer,
  stains,
}: {
  deployer: string;
  stains: WalletStain[];
}) {
  if (stains.length === 0) return null;

  const upstream = stains.filter((s) => s.direction === "upstream");
  const downstream = stains.filter((s) => s.direction === "downstream");

  return (
    <div className="mb-12 w-full min-w-0">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <span className="font-cinzel text-lg font-bold tracking-[0.2em] text-[#ededea]">
          THE MONEY TRAIL
        </span>
        <span className="h-px min-w-8 flex-1 bg-[#2a2a2a]" />
        <span className="font-mono text-[11px] tracking-[0.14em] text-[#8a8a8a]">
          {stains.length} LINKED WALLET{stains.length > 1 ? "S" : ""}
        </span>
      </div>

      <p className="mb-8 max-w-2xl text-xs leading-relaxed text-[#8a8a8a]">
        The wallet that paid a fresh wallet&apos;s first gas fee is usually the
        one really in control. We follow that link two steps out. Wallets that
        pay thousands of people, like exchanges, are skipped, since they are
        not part of any one scheme. Every link below is a real transaction you
        can check yourself.
      </p>

      {downstream.length > 0 && (
        <TrailGroup
          label="WHERE THE MONEY WENT"
          hint="Wallets this rugger sent money to. These may fund the next scam."
          tip="Hop 1 is one transaction: money the rugger sent out directly.
Each Hop 2 row is a SEPARATE, later transaction from that Hop 1 wallet to
someone else. These amounts do not need to add up to the Hop 1 total.
A Hop 2 wallet often has its own history of moving money around, from
before this rug and after it."
          deployer={deployer}
          stains={downstream}
        />
      )}
      {upstream.length > 0 && (
        <TrailGroup
          label="WHO FUNDED THEM"
          hint="Wallets that sent money toward the rugger before the rug."
          deployer={deployer}
          stains={upstream}
        />
      )}
    </div>
  );
}

function TrailGroup({
  label,
  hint,
  tip,
  deployer,
  stains,
}: {
  label: string;
  hint: string;
  /** Optional longer note shown on hover of the "i" mark, for a point the one-line hint can't fit. */
  tip?: string;
  deployer: string;
  stains: WalletStain[];
}) {
  return (
    <div className="mb-10">
      <h3 className="mb-1 flex items-center gap-1.5 font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]">
        {label}
        {tip && <InfoTip text={tip} />}
      </h3>
      <p className="mb-4 text-[11px] text-[#8a8a8a]">{hint}</p>
      <div className="space-y-3">
        {stains.map((s) => (
          <TrailRow key={`${s.direction}-${s.address}`} deployer={deployer} stain={s} />
        ))}
      </div>
    </div>
  );
}

function TrailRow({ deployer, stain }: { deployer: string; stain: WalletStain }) {
  // Build the ordered node chain from the edge path; fall back to a direct link.
  const path: LineageEdge[] =
    stain.path.length > 0
      ? stain.path
      : [{ from: deployer, to: stain.address, txHash: "", block: null, valueEth: null }];

  const nodes: string[] = [path[0]!.from, ...path.map((e) => e.to)];

  return (
    <div className="min-w-0 border border-[#2a2a2a] bg-[#141414] px-4 py-4 sm:px-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-[10px] tracking-[0.16em] text-[#8a8a8a]">
          HOP {stain.hops}
        </span>
        <span
          className="border border-[#2a2a2a] bg-[#1c1c1c] px-2 py-0.5 font-mono text-[10px] tracking-[0.14em]"
          style={{ color: stain.hops === 1 ? "#ededea" : "#8a8a8a" }}
        >
          {stain.hops === 1 ? "DIRECT" : "LINKED"}
        </span>
      </div>

      {/* horizontal chain of custody */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-2 font-mono text-[11px]">
        {nodes.map((addr, i) => {
          const isLast = i === nodes.length - 1;
          const isOrigin = i === 0;
          return (
            <span key={`${addr}-${i}`} className="flex items-center gap-1">
              <a
                href={`${explorerWebUrl}/address/${addr}`}
                target="_blank"
                rel="noopener noreferrer"
                className={`border px-2 py-1 hover:border-[#8a8a8a] ${
                  isLast
                    ? "border-[#8a8a8a] bg-[#1c1c1c] text-[#ededea]"
                    : isOrigin
                      ? "border-[#2a2a2a] text-[#8a8a8a]"
                      : "border-[#2a2a2a] text-[#8a8a8a]"
                }`}
              >
                {isOrigin ? "RUGGER " : ""}
                {short(addr)}
              </a>
              {!isLast && <Edge edge={path[i]!} />}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function Edge({ edge }: { edge: LineageEdge }) {
  const value =
    edge.valueEth != null && edge.valueEth > 0
      ? `${edge.valueEth < 0.001 ? edge.valueEth.toExponential(1) : edge.valueEth.toFixed(3)} ETH`
      : "funded";
  const label = edge.block ? `${value} · blk ${edge.block.toLocaleString("en-US")}` : value;
  return (
    <span className="flex items-center gap-1 text-[#3d3d3d]">
      <span className="text-[#2a2a2a]">→</span>
      {edge.txHash ? (
        <a
          href={`${explorerWebUrl}/tx/${edge.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="whitespace-nowrap text-[10px] tracking-[0.08em] text-[#8a8a8a] underline decoration-[#2a2a2a] hover:text-[#ededea]"
        >
          {label} ↗
        </a>
      ) : (
        <span className="whitespace-nowrap text-[10px] tracking-[0.08em] text-[#8a8a8a]">{label}</span>
      )}
      <span className="text-[#2a2a2a]">→</span>
    </span>
  );
}
