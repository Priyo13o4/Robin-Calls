import type { Metadata } from "next";
import Link from "next/link";
import { NoirShell, PageHeader } from "../../components/site/NoirShell";
import { MoneyTrail } from "../../components/site/MoneyTrail";
import { FamilyTree } from "../../components/site/FamilyTree";
import { readDeployerFamilyTree, type FamilyTreeNode } from "@/lib/data/wanted";
import { readFamilyTreeWithCurrentCustody } from "@/lib/trade/wanted-custody";
import { explorerWebUrl } from "@/lib/config/chain";
import type { WalletStain } from "@/lib/types";
import { CopyAddressChip } from "../../components/site/CopyAddressChip";

// Was a fixed string for every wallet on the board — the one fact that
// actually distinguishes a page (which wallet, how much it extracted) never
// reached the title or description. Same duplicated-read tradeoff as
// scan/[address]/page.tsx: one extra indexed call, no shared cache layer.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ deployer: string }>;
}): Promise<Metadata> {
  const { deployer } = await params;
  const addr = deployer.toLowerCase();
  const res = await readDeployerFamilyTree(addr);
  const rugged = (res?.nodes ?? []).filter((n) => n.rugged).length;
  const confirmedRugs = res?.confirmedRugs ?? 0;

  const rawTitle = confirmedRugs
    ? `${short(addr)}: ${confirmedRugs} Confirmed Rug${confirmedRugs === 1 ? "" : "s"} | RobinCalls`
    : `${short(addr)}: Family Tree | RobinCalls`;
  const title = rawTitle.length <= 60 ? rawTitle : `${short(addr)}: Rug History | RobinCalls`;
  const takeSentence =
    res?.takenUsd != null && Number.isFinite(res.takenUsd)
      ? res.takenIsCeiling
        ? `taking up to $${Math.round(res.takenUsd).toLocaleString("en-US")}`
        : `taking $${Math.round(res.takenUsd).toLocaleString("en-US")}`
      : null;
  const description = confirmedRugs
    ? `${short(addr)} deployed ${rugged} token${rugged === 1 ? "" : "s"} that rugged on Robinhood Chain${takeSentence ? `, ${takeSentence}` : ""}. Documented on-chain evidence.`
    : `Every token wallet ${short(addr)} deployed on Robinhood Chain, and whether any of them rugged.`;

  return {
    title,
    description,
    keywords: [
      short(addr),
      `${short(addr)} deployer`,
      "robinhood chain rug pulls",
      "robinhood chain rugged tokens",
    ],
    alternates: { canonical: `/wanted/${addr}` },
    openGraph: {
      title,
      description,
      images: [
        {
          url: "/brand/og-default.jpg",
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/brand/og-default.jpg"],
    },
  };
}

export const revalidate = 300;

const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-4)}`;

export default async function FamilyTreePage({
  params,
}: {
  params: Promise<{ deployer: string }>;
}) {
  const { deployer } = await params;
  const addr = deployer.toLowerCase();

  const res = await readFamilyTreeWithCurrentCustody(addr);
  const nodes: FamilyTreeNode[] = res?.nodes ?? [];
  const takenUsd = res?.takenUsd ?? null;
  const takenIsCeiling = res?.takenIsCeiling ?? false;
  const operatorRugs = res?.operatorRugs ?? [];
  const confirmedRugs = res?.confirmedRugs ?? 0;
  const stains: WalletStain[] = res?.stains ?? [];
  const funderAddress = res?.funderAddress ?? null;
  const rugged = nodes.filter((n) => n.rugged).length;


  return (
    <NoirShell>
      <PageHeader
        eyebrow={
          <Link href="/wanted" className="text-[#8a8a8a] hover:text-[#ededea]">
            ← THE WANTED BOARD
          </Link>
        }
        title="FAMILY TREE"
        subline={
          <>
            Every deploy from{" "}
            <a
              href={`${explorerWebUrl}/address/${addr}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono not-italic text-[#ededea] hover:underline"
            >
              {short(addr)}
            </a>
            . The ones that ran are marked.
          </>
        }
      />

      <section className="mx-auto max-w-3xl px-4 pb-24 sm:px-6">
        <div className="mb-8 flex flex-wrap gap-4 font-mono text-xs text-[#8a8a8a]">
          <span className="border border-[#2a2a2a] bg-[#141414] px-4 py-2">
            {nodes.length} DEPLOYS
          </span>
          <span className="border border-[#2a2a2a] bg-[#141414] px-4 py-2">
            {confirmedRugs} CONFIRMED RUGS
          </span>
          <span className="border border-[#2a2a2a] bg-[#141414] px-4 py-2">
            {takenUsd != null && Number.isFinite(takenUsd)
              ? `${takenIsCeiling ? "UP TO " : ""}$${takenUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} TAKEN`
              : "— TAKEN"}
          </span>
          {stains.length > 0 && (
            <span className="border border-[#2a2a2a] bg-[#141414] px-4 py-2 text-[#ededea]">
              {stains.length} LINKED WALLET{stains.length > 1 ? "S" : ""}
            </span>
          )}
        </div>

        {/* `confirmedRugs` is a counter on the deployer row; `rugged` is derived
            from the rugs table on this page. They should agree — when they do
            not, one of the two is stale, and silently showing only the counter
            would hide that. */}
        {confirmedRugs !== rugged && (
          <div className="mb-8 border border-[#2a2a2a] bg-[#1c1c1c] px-4 py-3 font-mono text-[11px] text-[#8a8a8a]">
            NOTE — the deployer counter reads {confirmedRugs} confirmed rug
            {confirmedRugs === 1 ? "" : "s"}, but {rugged} of the deploys below
            carry a rug record. One of the two is stale.
          </div>
        )}

        {/* L177: hidden unless a shared funder links this wallet to another indicted one. */}
        {operatorRugs.length > 0 && (
          <div className="mb-8 border border-[#3a2a2a] bg-[#1a1414] px-4 py-4 font-mono">
            <p className="text-[11px] tracking-[0.16em] text-[#d08a8a]">
              SAME OPERATOR · {operatorRugs.length} OTHER RUG{operatorRugs.length === 1 ? "" : "S"}
            </p>
            <p className="mt-2 text-[11px] text-[#8a8a8a]">
              Funded by the same wallet ({short(operatorRugs[0].via)}) as the deployer of:
            </p>
            <ul className="mt-3 flex flex-col gap-3">
              {operatorRugs.map((o) => (
                <li key={`${o.deployer}-${o.token_address ?? "none"}`} className="flex flex-wrap items-center gap-3">
                  <span className="text-xs text-[#ededea]">{o.token_symbol ?? "Unnamed token"}</span>
                  {o.token_address && <CopyAddressChip address={o.token_address} compact />}
                  {o.rugged_at && <span className="text-[10px] text-[#6a6a6a]">{o.rugged_at.slice(0, 10)}</span>}
                  <Link href={`/wanted/${o.deployer}`} className="text-[10px] tracking-[0.14em] text-[#8a8a8a] hover:text-[#ededea]">
                    VIEW THAT RUG →
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mb-12">
          <FamilyTree
            deployer={addr}
            funderAddress={funderAddress}
            nodes={nodes}
            stains={stains}
          />
        </div>

        {/* The deploys now hang off the tree above; MoneyTrail keeps the
            per-hop transaction paths, which are proof, not structure. */}
        <MoneyTrail deployer={addr} stains={stains} />
      </section>
    </NoirShell>
  );
}
