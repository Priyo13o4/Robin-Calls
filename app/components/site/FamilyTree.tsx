import Link from "next/link";
import { explorerWebUrl } from "@/lib/config/chain";
import { CopyAddressChip } from "./CopyAddressChip";
import { InfoTip } from "./InfoTip";
import type { FamilyTreeNode } from "@/lib/data/wanted";
import type { WalletStain } from "@/lib/types";

/**
 * THE FAMILY TREE — one indicted wallet's lineage, drawn as an actual tree.
 *
 * The previous rendering was a flat `<ol>` with a left rule: a timeline, not a
 * tree, so nothing on screen distinguished "who funded this wallet" from "what
 * this wallet deployed" from "who it funded next". Those are three different
 * relationships and the page is called Family Tree, so they get three different
 * positions in a hierarchy:
 *
 *     FUNDER               (deployers.funder_address — upstream, may be unknown)
 *       └── DEPLOYER       (the indicted wallet — the root of the indictment)
 *             ├── DEPLOYS  (tokens.deployer_id, rugged ones marked)
 *             └── FUNDED   (wallet_stains, direction = downstream)
 *
 * Connectors are CSS borders rather than SVG so the tree reflows on a phone
 * without a viewBox to recompute — the rails are `absolute` inside a
 * `relative` row, which keeps each branch's elbow attached to its own card
 * regardless of how tall that card wraps.
 *
 * Every address on this page is copyable (CLAUDE.md §2 — reuse
 * CopyAddressChip, do not hand-roll a fourth clipboard implementation): the
 * whole point of the board is that a reader can re-verify the accusation
 * against the chain, and that starts with being able to take the address with
 * them.
 */

const RAIL = "#2a2a2a";

/**
 * DESIGN.md has ONE color and spends it sparingly, so depth here is carried by
 * value and weight, not hue. Three moves, each meaning something:
 *
 * - The trunk FADES downward. Guilt attenuates with distance from the indicted
 *   wallet (a hop-2 stain is weighted, not a kill shot), and the rail says so
 *   before any label does.
 * - Rugged deploys and hop-1 stains carry a Paper edge; everything else does
 *   not. That is the page's one scannable axis.
 * - Exactly ONE lime element per viewport — the INDICTED badge — because that
 *   is the page's whole assertion. Marking every rugged token would put lime on
 *   screen five times and kill the device (DESIGN.md, Lime Usage Rules).
 */
const TRUNK = "linear-gradient(180deg, #454545 0%, #2a2a2a 45%, #1a1a1a 100%)";
const LIME = "#ccff00";

/** Danger reads as WEIGHT, never as hue. */
const EDGE_KILL = "#ededea";
const EDGE_MUTED = "#2a2a2a";

/**
 * Everything below the deployer hangs off ONE trunk, drawn by the container.
 * Each row reaches back to it with an elbow at `-left-6` (`-left-8` from `sm`),
 * which is exactly the container's own left padding — so the elbow lands on the
 * trunk at every breakpoint without a second magic number to keep in sync.
 *
 * The trunk is `h-full`, so the last row must end flush with the container: no
 * bottom padding on the container, and `last` rows drop their own. Otherwise
 * the line dangles below the final card and reads as "more, cut off".
 */
function TreeRow({
  children,
  last = false,
  marked = false,
}: {
  children: React.ReactNode;
  last?: boolean;
  /** This branch carries the finding — brightens its own elbow to match. */
  marked?: boolean;
}) {
  return (
    <div className={`relative ${last ? "" : "pb-3"}`}>
      <span
        aria-hidden="true"
        className="absolute -left-6 top-[1.6rem] h-px w-6 sm:-left-8 sm:w-8"
        style={{ background: marked ? EDGE_KILL : RAIL }}
      />
      {children}
    </div>
  );
}

/**
 * A branch card. `marked` is the only visual difference between a token that
 * rugged and one that did not, so it has to survive a squint at arm's length —
 * a 2px Paper edge does, a border-color change does not.
 */
function BranchCard({
  children,
  marked = false,
}: {
  children: React.ReactNode;
  marked?: boolean;
}) {
  return (
    <div
      className="border border-[#2a2a2a] bg-[#141414] px-4 py-4 sm:px-5"
      style={{ borderLeft: `2px solid ${marked ? EDGE_KILL : EDGE_MUTED}` }}
    >
      {children}
    </div>
  );
}

function TreeSectionLabel({
  label,
  hint,
  count,
}: {
  label: string;
  hint: string;
  count?: number;
}) {
  return (
    <div className="relative pb-3 pt-7">
      <span
        aria-hidden="true"
        className="absolute -left-6 top-[2.1rem] h-px w-6 sm:-left-8 sm:w-8"
        style={{ background: RAIL }}
      />
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[10px] tracking-[0.2em] text-[#ededea]">{label}</span>
        {count != null && (
          <span className="font-mono text-[10px] tracking-[0.14em] text-[#8a8a8a]">
            {String(count).padStart(2, "0")}
          </span>
        )}
      </div>
      {/* Smoke, not Fog: this is a sentence a human reads (DESIGN.md legibility). */}
      <div className="mt-1 text-[11px] text-[#8a8a8a]">{hint}</div>
    </div>
  );
}

function TierBadge({ tier, score }: { tier: string | null; score: number | null }) {
  if (!tier) {
    return (
      <span className="font-mono text-[10px] tracking-[0.14em] text-[#8a8a8a]">
        NEVER SCANNED
      </span>
    );
  }
  // Severity as VALUE, not hue: the eye sorts a column of these without reading
  // a single word, and the noir palette stays intact.
  const ramp: Record<string, { fg: string; bd: string }> = {
    CRITICAL: { fg: "#ededea", bd: "#8a8a8a" },
    DANGER: { fg: "#ededea", bd: "#3d3d3d" },
    WARN: { fg: "#c4c4c4", bd: "#2a2a2a" },
  };
  const tone = ramp[tier.toUpperCase()] ?? { fg: "#8a8a8a", bd: "#2a2a2a" };
  return (
    <span
      className="bg-[#1c1c1c] px-2 py-1 font-mono text-[10px] tracking-[0.14em]"
      style={{ color: tone.fg, border: `1px solid ${tone.bd}` }}
      title={`Latest stored verdict: ${tier}${score != null ? ` (${score}/100)` : ""}`}
    >
      {tier}
      {score != null ? ` · ${score}` : ""}
    </span>
  );
}

export function FamilyTree({
  deployer,
  funderAddress,
  nodes,
  stains,
}: {
  deployer: string;
  funderAddress: string | null;
  nodes: FamilyTreeNode[];
  stains: WalletStain[];
}) {
  const downstream = stains.filter((s) => s.direction === "downstream");

  return (
    <div className="w-full min-w-0">
      {/* ── ROOT: who funded the rugger ───────────────────────────────── */}
      <div className="relative">
        <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] tracking-[0.2em] text-[#8a8a8a]">
          FUNDED BY
          <InfoTip text="This is whoever first paid this wallet's gas fee. We could not
find one for this wallet. That does not mean it wasn't funded, only
that our check could not trace it back far enough." />
        </div>
        {funderAddress ? (
          <CopyAddressChip address={funderAddress} label="FUNDER" />
        ) : (
          // Smoke, not Fog: this is the §4 disclosure that our trace came up
          // empty. A gap we admit to has to be as readable as a fact we assert,
          // or the admission is decorative. An unknown funder is unknown, not
          // absent — the trace either has not run yet or could not resolve it.
          // Saying "none" here would be the empty-means-clean mistake.
          <div className="border border-dashed border-[#2a2a2a] bg-[#111] px-3 py-2 font-mono text-[10px] text-[#8a8a8a]">
            WE COULD NOT FIND ONE
          </div>
        )}
      </div>

      {/* Connector down into the deployer. DASHED when upstream is unresolved:
          an unknown funder is a gap in the trace, and a solid line would draw a
          relationship we never established. */}
      <span
        aria-hidden="true"
        className="ml-4 block h-7 w-px sm:ml-6"
        style={
          funderAddress
            ? { background: "linear-gradient(180deg,#2a2a2a,#454545)" }
            : { backgroundImage: "linear-gradient(180deg,#2a2a2a 55%,transparent 55%)",
                backgroundSize: "1px 7px" }
        }
      />

      {/* ── THE INDICTED WALLET ───────────────────────────────────────── */}
      <div
        className="border border-[#454545] bg-[#1c1c1c] px-4 py-5 sm:px-5"
        style={{ boxShadow: "0 0 0 1px #0a0a0a, 0 18px 40px -28px #000" }}
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="font-cinzel text-base font-bold tracking-[0.16em] text-[#ededea]">
            THE DEPLOYER
          </span>
          {/* The single lime element on this page. It is the assertion the whole
              board exists to make; spending the accent anywhere else — on each
              RUGGED tag, say — would put it on screen five times and retire the
              device (DESIGN.md, Lime Usage Rules). */}
          <span
            className="px-2 py-0.5 font-mono text-[10px] font-semibold tracking-[0.18em]"
            style={{ color: LIME, border: `1px solid ${LIME}`, background: "#0a0a0a" }}
          >
            INDICTED
          </span>
        </div>
        <CopyAddressChip address={deployer} label="WALLET" />
      </div>

      {/* ── BRANCHES ──────────────────────────────────────────────────── */}
      <div className="relative ml-4 pl-6 sm:ml-6 sm:pl-8">
        {/* the trunk */}
        <span
          aria-hidden="true"
          className="absolute left-0 top-0 h-full w-px"
          style={{ background: TRUNK }}
        />

        <TreeSectionLabel
          label="DEPLOYS"
          count={nodes.length}
          hint="Every token this wallet has put on chain. The ones that ran are marked."
        />
        {nodes.length === 0 ? (
          <TreeRow last={downstream.length === 0}>
            <div className="border border-dashed border-[#2a2a2a] bg-[#111] px-4 py-6 text-center">
              <p className="font-mono text-[11px] tracking-[0.08em] text-[#8a8a8a]">
                NO INDEXED DEPLOYS.
              </p>
            </div>
          </TreeRow>
        ) : (
          nodes.map((n, i) => (
            <TreeRow
              key={n.id}
              last={downstream.length === 0 && i === nodes.length - 1}
              marked={n.rugged}
            >
              <BranchCard marked={n.rugged}>
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-cinzel text-lg font-semibold text-[#ededea]">
                        {n.name || n.symbol || "UNNAMED"}
                      </div>
                      <div className="font-mono text-[11px] text-[#8a8a8a]">
                        {n.symbol ? `$${n.symbol}` : "no symbol on record"}
                        {n.deploy_block
                          ? ` · block ${n.deploy_block.toLocaleString("en-US")}`
                          : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {n.rugged ? (
                        <span className="border border-[#ededea] bg-[#ededea] px-2 py-1 font-mono text-[10px] font-semibold tracking-[0.14em] text-[#0a0a0a]">
                          RUGGED
                        </span>
                      ) : n.is_dead ? (
                        <span className="font-mono text-[10px] tracking-[0.14em] text-[#8a8a8a]">
                          DEAD POOL
                        </span>
                      ) : (
                        <span className="font-mono text-[10px] tracking-[0.14em] text-[#8a8a8a]">
                          LIVE
                        </span>
                      )}
                      <TierBadge tier={n.tier} score={n.score} />
                      <Link
                        href={`/scan/${n.address}`}
                        className="border border-[#2a2a2a] px-3 py-1 font-mono text-[10px] tracking-[0.14em] text-[#ededea] hover:border-[#8a8a8a]"
                      >
                        SCAN
                      </Link>
                    </div>
                  </div>
                <CopyAddressChip address={n.address} label="TOKEN" />
                {n.currentWalletShare && (
                  <p className="mt-2 font-mono text-[10px] leading-5 text-[#b7bdb3]">
                    Current pool read at block {n.currentWalletShare.asOfBlock.toLocaleString("en-US")}: one wallet holds {n.currentWalletShare.pct.toLocaleString("en-US", { maximumFractionDigits: 2 })}% of active liquidity. This does not show who held liquidity when the rug occurred.
                  </p>
                )}
              </BranchCard>
            </TreeRow>
          ))
        )}

        {downstream.length > 0 && (
          <>
            <TreeSectionLabel
              label="WALLETS THIS ONE FUNDED"
              count={downstream.length}
              hint="Guilt propagates two hops through the funding web. Full paths in The Money Trail below."
            />
            {downstream.map((s, i) => (
              <TreeRow
                key={s.address}
                last={i === downstream.length - 1}
                marked={s.hops === 1}
              >
                <BranchCard marked={s.hops === 1}>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-[10px] tracking-[0.16em] text-[#8a8a8a]">
                      HOP {s.hops}
                    </span>
                    <span
                      className="border border-[#2a2a2a] bg-[#1c1c1c] px-2 py-0.5 font-mono text-[10px] tracking-[0.14em]"
                      style={{ color: s.hops === 1 ? "#ededea" : "#8a8a8a" }}
                    >
                      {s.hops === 1 ? "DIRECT" : "LINKED"}
                    </span>
                  </div>
                  <CopyAddressChip address={s.address} label="WALLET" />
                </BranchCard>
              </TreeRow>
            ))}
          </>
        )}
      </div>

      <div className="mt-6 text-[11px] leading-relaxed text-[#8a8a8a]">
        Every address here links to{" "}
        <a
          href={explorerWebUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-[#2a2a2a] hover:text-[#ededea]"
        >
          the explorer
        </a>{" "}
        and copies to your clipboard. Nothing on this board asks you to take our
        word for it.
      </div>
    </div>
  );
}
