import Link from "next/link";
import type { CanonicalVerdictRow } from "@/lib/data/ledger";
import type { LandingStats } from "@/lib/data/observability";
import { Display, Eyebrow, GhostButton, Section, Standfirst } from "./Section";
import { compactUsd, scoreColor, shortAddr } from "./format";
import { PRODUCT_ACCENT, tint } from "./palette";
import type { DeployerRow } from "@/lib/types";
import { isOwnToken } from "@/lib/sale/token";

/** UTC clock time, matching the ledger's own stamps — a landing page rendered
 *  at revalidate cadence must not print a relative age that is minutes stale. */
function stampTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.toISOString().slice(11, 19)} GMT`;
}

/**
 * "A score you can cite tomorrow" — the hash-chain pitch, the last three
 * receipts, the platform counters and the wanted board in one section.
 *
 * Wanted sits here rather than beside Night Market because it is the same
 * claim: a verdict is a record, and a wallet earns a place on that board by
 * accumulating records. Next to a launch feed it read as a third live ticker.
 *
 * Every counter is a real read (`readLandingStats`). The comps show round
 * marketing figures ("210K+ contracts scanned", "98.7% accuracy") and none of
 * those exist as a measurement here; publishing an accuracy rate we never
 * backtested would be the exact claim this page is selling against.
 */
export function RecordSection({
  rows,
  stats,
  wanted,
}: {
  rows: CanonicalVerdictRow[];
  stats: LandingStats;
  wanted: DeployerRow[];
}) {
  const metrics = [
    { label: "Verdicts issued", value: stats.verdicts_issued },
    { label: "Curve graduations", value: stats.curve_graduations },
    { label: "Wallets indicted", value: stats.wallets_indicted },
    { label: "Launchpads live", value: stats.launchpads_live },
  ];

  return (
    <Section>
      {/* One header row, then a full-width counter strip, then the two boards
          side by side. The previous three-column split put a tall copy column
          beside a one-row board and left most of the section empty at desktop;
          it only read correctly once the columns stacked on a phone. */}
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
        <div className="min-w-0 max-w-2xl">
          <Eyebrow>The record</Eyebrow>
          <Display>A score you can cite tomorrow.</Display>
          <Standfirst>
            Every verdict is hash-chained, with on-chain anchoring as the next stage. Nobody edits
            the past, including us. The same record is what puts a wallet on the wanted board, so
            an accusation there can be traced back to the scans it came from.
          </Standfirst>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <GhostButton href="/ledger" accent={PRODUCT_ACCENT.ledger}>
            View the ledger →
          </GhostButton>
          <GhostButton href="/wanted" accent={PRODUCT_ACCENT.wanted}>
            Wanted board →
          </GhostButton>
        </div>
      </div>

      <div className="mt-7 grid grid-cols-2 gap-px border border-[#2a2a2a] bg-[#2a2a2a] sm:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.label} className="bg-[#141414] px-4 py-3.5">
            <p className="font-cinzel text-[22px] font-black leading-none text-[#ededea]">
              {m.value.toLocaleString("en-US")}
            </p>
            <p className="mt-1.5 font-inter text-[9px] uppercase leading-tight tracking-[0.12em] text-[#8a8a8a]">
              {m.label}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <div>
          <Eyebrow>Latest receipts</Eyebrow>
          {rows.length === 0 ? (
            <p className="mt-3 font-inter text-[13px] text-[#8a8a8a]">No verdicts on record yet.</p>
          ) : (
            /* The rail: a lime tick per receipt against a single hairline, which
               is the chain the copy above is describing. */
            <div className="relative mt-3 flex flex-col gap-1.5 pl-5">
              <span aria-hidden className="absolute bottom-2.5 left-[3px] top-2.5 w-px bg-[#2a2a2a]" />
              {rows.slice(0, 3).map((v) => (
                <Link
                  key={v.id}
                  href={`/ledger?v=${v.id}`}
                  className="relative flex items-center justify-between gap-4 border border-[#2a2a2a] bg-[#141414] px-3.5 py-2.5 transition-colors hover:border-[#8a8a8a]"
                >
                  <span
                    aria-hidden
                    className="absolute -left-5 top-1/2 h-[7px] w-[7px] -translate-y-1/2 rounded-full bg-[#ccff00]"
                  />
                  <span className="min-w-0">
                    <span className="flex items-baseline gap-2">
                      <span className="truncate font-cinzel text-[13px] font-bold uppercase text-[#ededea]">
                        {v.token_symbol ? v.token_symbol : "Unnamed"}
                      </span>
                      <span className="truncate font-mono text-[10.5px] text-[#8a8a8a]">
                        {shortAddr(v.token_address)}
                      </span>
                    </span>
                    <span className="mt-0.5 block font-mono text-[10px] text-[#8a8a8a]">
                      #{v.id} · {stampTime(v.created_at)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2.5">
                    {isOwnToken(v.token_address) ? (
                      <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-[#ededea]">
                        Our token · not scored
                      </span>
                    ) : (
                      <>
                        <span
                          className="font-cinzel text-[21px] font-black leading-none"
                          style={{ color: scoreColor(v.tier) }}
                        >
                          {v.score}
                        </span>
                        <span className="w-[48px] font-mono text-[9px] uppercase tracking-[0.12em] text-[#8a8a8a]">
                          {v.tier}
                        </span>
                      </>
                    )}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* The wanted board, compressed to the one line that matters per wallet.
            `confirmed_rugs > 1` is the only thing coloured: the board's whole
            claim is REPEAT, and a single indictment is not that yet. */}
        <div>
          <Eyebrow accent={PRODUCT_ACCENT.wanted} dot>
            Wanted board
          </Eyebrow>
          {wanted.length === 0 ? (
            <p className="mt-3 font-inter text-[12px] text-[#8a8a8a]">
              No indicted deployers on record yet.
            </p>
          ) : (
            <div className="mt-3 flex flex-col gap-1.5">
              {wanted.slice(0, 3).map((d) => {
                const repeat = d.confirmed_rugs > 1;
                return (
                  <Link
                    key={d.address}
                    href={`/wanted/${d.address}`}
                    className="flex items-center justify-between gap-3 border border-[#2a2a2a] bg-[#141414] px-3.5 py-2.5 transition-colors hover:border-[#8a8a8a]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-[11.5px] text-[#ededea]">
                        {shortAddr(d.address)}
                      </span>
                      <span className="mt-0.5 block font-mono text-[10px] uppercase tracking-[0.12em] text-[#8a8a8a]">
                        {d.launches_total} launches
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2.5">
                      <span
                        style={{ color: repeat ? PRODUCT_ACCENT.wanted : "#c7c7c2" }}
                        className="font-mono text-[12px] tabular-nums"
                      >
                        {`${d.taken_is_ceiling && d.taken_usd != null ? "up to " : ""}${compactUsd(d.taken_usd)}`}
                      </span>
                      <span
                        style={
                          repeat
                            ? {
                                borderColor: tint(PRODUCT_ACCENT.wanted, 0.55),
                                color: PRODUCT_ACCENT.wanted,
                              }
                            : { borderColor: "#2a2a2a", color: "#8a8a8a" }
                        }
                        className="w-[52px] border px-1.5 py-px text-center font-mono text-[8px] uppercase tracking-[0.08em]"
                      >
                        {repeat ? "Repeat" : "Indicted"}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Section>
  );
}
