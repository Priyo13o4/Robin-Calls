import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NoirShell } from "../components/site/NoirShell";
import { MethodologyChrome } from "./MethodologyChrome";
import { DOC_PARTS } from "./outline";
import {
  CRITICAL_OVERRIDES,
  FORMULA_CHANGELOG,
  FORMULA_VERSION,
  POST_SCORE_RULES,
  TIER_BANDS,
  TOTAL_WEIGHT,
  WEIGHTED_CHECKS,
  tierForScore,
  type CheckSource,
} from "@/lib/config/formula";

import { SITE_URL } from "@/lib/config/site";
import { SEO_ROUTES } from "@/lib/config/seo";

export const metadata: Metadata = {
  title: SEO_ROUTES.methodology.title,
  description: SEO_ROUTES.methodology.description,
  keywords: [...SEO_ROUTES.methodology.keywords],
  alternates: { canonical: "/methodology" },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/methodology`,
    siteName: "RobinCalls",
    title: SEO_ROUTES.methodology.title,
    description: SEO_ROUTES.methodology.description,
    images: [{ url: "/brand/og-default.jpg", width: 1200, height: 630, alt: SEO_ROUTES.methodology.title }],
  },
  twitter: {
    card: "summary_large_image",
    title: SEO_ROUTES.methodology.title,
    description: SEO_ROUTES.methodology.description,
    images: ["/brand/og-default.jpg"],
  },
};

/**
 * The methodology whitepaper.
 *
 * A document, not a product page — numbered parts, a fixed section grammar, and
 * a navigable outline, because the thing it has to survive is someone disputing
 * a specific verdict and needing to cite the exact rule that produced it.
 *
 * ## Everything numeric is read, never written
 *
 * No weight, band, mechanism, cap or changelog entry is transcribed into this
 * file. They are rendered from `lib/config/formula.ts`, the same module the
 * scoring pipeline scores from — so the published methodology cannot describe a
 * formula the engine is not running. That is the whole point of the page: an
 * authored copy would drift on the first weight change and the drift would be
 * invisible, because prose does not fail a typecheck.
 *
 * The same rule applies to the worked example below: its arithmetic is computed
 * from the live weights, not stated.
 *
 * Prose describing MECHANISM (Parts IV–VIII) is authored here, and is held to
 * CLAUDE.md §9 — describe what the engine does, not what it would be nice for
 * it to do. Where the guarantee is a design contract rather than something
 * enforced at every call site, the text says so rather than overclaiming.
 *
 * Headings and their numbering come from `outline.ts` via `Part`/`Section`, so
 * the navigation and the prose read from one list.
 */

const PART_INDEX = new Map(
  DOC_PARTS.map((p, i) => [p.id, { part: p, n: i + 1 }] as const)
);
const SECTION_INDEX = new Map(
  DOC_PARTS.flatMap((p, i) =>
    p.sections.map((s, j) => [s.id, { section: s, label: `${i + 1}.${j + 1}` }] as const)
  )
);

export default function MethodologyPage() {
  const latest = FORMULA_CHANGELOG[0];

  /**
   * Evidence-source census, derived. Answers "how much of this rests on a live
   * chain read versus on our own database" without anyone maintaining a count.
   */
  const sourceCounts = new Map<CheckSource, number>();
  for (const d of [...WEIGHTED_CHECKS, ...CRITICAL_OVERRIDES, ...POST_SCORE_RULES]) {
    sourceCounts.set(d.source, (sourceCounts.get(d.source) ?? 0) + 1);
  }
  const sources = [...sourceCounts.entries()].sort((a, b) => b[1] - a[1]);

  /**
   * The worked example, computed from the live table rather than written down:
   * the heaviest check FAILs and the median-weight check WARNs. Both the
   * arithmetic and the resulting tier come from the same functions the scanner
   * uses, so this example cannot describe a score the engine would not produce.
   */
  const byWeight = [...WEIGHTED_CHECKS].sort((a, b) => b.weight - a.weight);
  const heaviest = byWeight[0];
  const exFail = byWeight[0];
  const exWarn = byWeight[Math.floor(byWeight.length / 2)];
  const exDeduction = exFail.weight + exWarn.weight / 2;
  const exScore = Math.max(0, 100 - exDeduction);
  const exTier = tierForScore(exScore, false);

  return (
    <NoirShell>
      <MethodologyChrome>
        <article className="pb-32 pt-10">
          {/* ── Cover ──────────────────────────────────────────────── */}
          {/* No bottom rule: Part I draws its own top rule, and two hairlines a
              few pixels apart read as a rendering fault rather than a divide. */}
          <header>
            <p className="font-mono text-[10px] tracking-[0.3em] text-[#8a8a8a]">
              TECHNICAL WHITEPAPER · ROBINHOOD CHAIN · ID 4663
            </p>
            <h1 className="mt-5 font-cinzel text-4xl font-black leading-[1.05] tracking-wide text-[#ededea] sm:text-6xl">
              THE METHODOLOGY
            </h1>
            <p className="mt-6 max-w-[62ch] font-serif text-lg italic leading-relaxed text-[#c4c4c4]">
              Every weight public. Every score re-derivable. Every change on the record.
            </p>
            <p className="mt-6 max-w-[68ch] text-[15px] leading-[1.75] text-[#8a8a8a]">
              RobinCalls scores a token by spending down a fixed budget of one hundred
              points against evidence read from the chain, the explorer, the DEX market
              and its own record. This document specifies that procedure completely: the
              checks, their weights, the findings that bypass the weighting entirely, the
              way uncertainty is handled, and the chain of hashes that makes a past
              verdict impossible to quietly rewrite. It is generated from the same
              configuration the scanner runs on — the numbers below are not a description
              of the formula, they are the formula.
            </p>

            <dl className="mt-10 grid grid-cols-2 gap-px border border-[#2a2a2a] bg-[#2a2a2a] sm:grid-cols-3 lg:grid-cols-5">
              <Fact label="FORMULA" value={`v${FORMULA_VERSION}`} accent />
              <Fact label="WEIGHTED CHECKS" value={String(WEIGHTED_CHECKS.length)} />
              <Fact label="DEDUCTION WEIGHT" value={String(TOTAL_WEIGHT)} />
              <Fact label="OVERRIDES" value={String(CRITICAL_OVERRIDES.length)} />
              <Fact label="LAST REVISED" value={latest?.date ?? "—"} />
            </dl>
          </header>

          {/* ── I. SCOPE ───────────────────────────────────────────── */}
          <Part id="scope" />

          <Section id="scope-document">
            <P>
              This is a specification, not marketing copy. It exists so that a verdict can
              be argued with: if you disagree with a score, the rule that produced it is
              on this page, with its weight, its mechanism and the date it last changed.
            </P>
            <P>
              Every number here is rendered from the scanner&apos;s own scoring
              configuration at page load. There is no second copy to fall out of date —
              when a weight changes, this document changes with it, and the change appears
              in the revision history in Part IX.
            </P>
          </Section>

          <Section id="scope-claims">
            <P>
              A verdict asserts one thing: <Em>given the evidence listed in that verdict,
              this is the deduction the published formula produces.</Em> It is a
              reproducible measurement, and every input it used is printed alongside it.
            </P>
            <P>
              Two scans of an unchanged token under an unchanged formula produce an
              identical score, an identical tier, and an identical result fingerprint. The
              score is a function of the evidence and nothing else — not of when you asked,
              who asked, or how long the scan took.
            </P>
          </Section>

          <Section id="scope-limits">
            <P>
              A verdict is not a prediction, and it is not financial advice. A CLEAR token
              can be rugged five minutes later by a key that was never on-chain to begin
              with; the score measures what the contract and the market permit, not what
              the people behind them intend.
            </P>
            <P>
              It is also not a judgement about a project&apos;s merit. The checks look for
              mechanical exit risk — custody of the liquidity, privileged functions,
              concentration, manufactured volume, funding lineage. A token can be
              structurally sound and still worthless.
            </P>
          </Section>

          <Section id="scope-sources">
            <P>
              Every check declares where its evidence comes from, and that declaration is
              published in the verdict. Across the {WEIGHTED_CHECKS.length} weighted
              checks, {CRITICAL_OVERRIDES.length} overrides and {POST_SCORE_RULES.length}{" "}
              post-score rules:
            </P>
            <ul className="mt-6 grid gap-px border border-[#2a2a2a] bg-[#2a2a2a] sm:grid-cols-2">
              {sources.map(([source, count]) => (
                <li key={source} className="flex items-baseline gap-3 bg-[#141414] px-5 py-4">
                  <span className="font-cinzel text-2xl font-semibold tabular-nums text-[#ededea]">
                    {count}
                  </span>
                  <span className="font-mono text-[11px] leading-snug text-[#8a8a8a]">
                    {source}
                  </span>
                </li>
              ))}
            </ul>
            <P>
              A check that cannot reach its source does not silently return a passing
              result — see Part VI.
            </P>
          </Section>

          {/* ── II. THE SCORING MODEL ──────────────────────────────── */}
          <Part id="model" />

          <Section id="model-deduction">
            <P>
              Every token starts at 100 and loses points. A check that <Status s="FAIL" />{" "}
              deducts its full weight; a check that <Status s="WARN" /> deducts half. A{" "}
              <Status s="PASS" /> and a <Status s="SKIP" /> both deduct nothing — which
              means a check that could not run costs a token exactly as much as a check it
              passed, and is the reason the skipped ones are printed on the verdict rather
              than hidden.
            </P>
            <P>
              The weights total {TOTAL_WEIGHT} points across {WEIGHTED_CHECKS.length}{" "}
              checks
              {TOTAL_WEIGHT > 100 ? (
                <>
                  {" "}
                  — deliberately more deduction weight than there are points to spend, so
                  a token failing broadly reaches the floor rather than requiring a clean
                  sweep to get there. The score floors at 0 and never goes negative
                </>
              ) : (
                <>. The score floors at 0 and never goes negative</>
              )}
              .
            </P>
          </Section>

          <Section id="model-bands">
            <P>
              The final score maps to one of four bands. The band is what the verdict
              leads with; the number is what it is derived from.
            </P>
            <div className="mt-6 grid grid-cols-2 gap-px border border-[#2a2a2a] bg-[#2a2a2a] sm:grid-cols-4">
              {TIER_BANDS.map((b, i) => (
                <div
                  key={b.tier}
                  className="px-4 py-6 text-center"
                  style={{ background: ["#1e1e1e", "#1a1a1a", "#151515", "#101010"][i] }}
                >
                  <div
                    className="font-cinzel text-sm font-semibold tracking-[0.12em]"
                    style={{ color: b.tier === "CLEAR" ? "#ccff00" : "#ededea" }}
                  >
                    {b.tier}
                  </div>
                  <div className="mt-1.5 font-mono text-[10px] tabular-nums text-[#8a8a8a]">
                    {b.label}
                  </div>
                </div>
              ))}
            </div>
            <P>
              CRITICAL is reachable two ways: by scoring below its ceiling, or by a single
              override firing regardless of score (Part III).
            </P>
          </Section>

          <Section id="model-weights">
            <P>
              The complete table, in weight order. The bar is each check&apos;s share of
              the {TOTAL_WEIGHT} points available to deduct.
            </P>
            <div className="mt-6 overflow-x-auto border border-[#2a2a2a] bg-[#141414]">
              <table className="w-full min-w-[720px] text-left">
                <thead>
                  <tr className="border-b border-[#2a2a2a] font-mono text-[10px] tracking-[0.2em] text-[#8a8a8a]">
                    <th scope="col" className="px-5 py-3 font-medium">
                      CHECK
                    </th>
                    <th scope="col" className="w-[150px] px-5 py-3 font-medium">
                      WEIGHT
                    </th>
                    <th scope="col" className="px-5 py-3 font-medium">
                      MECHANISM
                    </th>
                    <th scope="col" className="px-5 py-3 font-medium">
                      SOURCE
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {byWeight.map((c) => (
                    <tr
                      key={c.id}
                      id={`check-${c.id}`}
                      className="scroll-mt-24 border-b border-[#2a2a2a] align-top last:border-0"
                    >
                      <th
                        scope="row"
                        className="px-5 py-4 text-left font-cinzel text-sm font-semibold tracking-[0.04em] text-[#ededea]"
                      >
                        {c.name}
                      </th>
                      <td className="px-5 py-4">
                        <div className="font-mono text-sm tabular-nums text-[#ededea]">
                          {c.weight}
                        </div>
                        <div
                          className="mt-1.5 h-[3px] bg-[#8a8a8a]"
                          style={{ width: `${(c.weight / heaviest.weight) * 100}%` }}
                          aria-hidden="true"
                        />
                      </td>
                      <td className="max-w-[46ch] px-5 py-4 text-xs leading-relaxed text-[#8a8a8a]">
                        {c.mechanism}
                      </td>
                      <td className="px-5 py-4">
                        <SourceChip source={c.source} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="model-example">
            <P>
              Worked through with the live weights. Take a token where{" "}
              <Em>{exFail.name}</Em> fails outright and <Em>{exWarn.name}</Em> raises a
              warning, and everything else passes:
            </P>
            <div className="mt-6 border border-[#2a2a2a] bg-[#141414]">
              <ExampleRow label="Starting budget" value="100" />
              <ExampleRow
                label={`${exFail.name} — FAIL, full weight`}
                value={`− ${exFail.weight}`}
              />
              <ExampleRow
                label={`${exWarn.name} — WARN, half weight`}
                value={`− ${exWarn.weight / 2}`}
              />
              <div className="flex items-baseline justify-between gap-4 border-t-2 border-[#2a2a2a] px-5 py-5">
                <span className="font-cinzel text-sm font-bold tracking-[0.1em] text-[#ededea]">
                  SCORE
                </span>
                <span className="font-cinzel text-2xl font-black tabular-nums text-[#ededea]">
                  {exScore}
                  <span className="ml-3 font-mono text-[11px] font-normal tracking-[0.2em] text-[#8a8a8a]">
                    {exTier}
                  </span>
                </span>
              </div>
            </div>
            <P>
              That arithmetic is the whole model. What follows are the two ways the
              arithmetic gets overruled.
            </P>
          </Section>

          {/* ── III. OVERRIDES AND CAPS ────────────────────────────── */}
          <Part id="overrides" />

          <Section id="overrides-critical">
            <P>
              Some findings are not worth points, because no amount of good behaviour
              elsewhere offsets them. Any one of these forces the CRITICAL band outright,
              whatever the score was.
            </P>
            <div className="mt-6 grid gap-px border border-[#2a2a2a] bg-[#2a2a2a] sm:grid-cols-2">
              {CRITICAL_OVERRIDES.map((c) => (
                <DefCard key={c.id} title={c.name} source={c.source}>
                  {c.mechanism}
                </DefCard>
              ))}
            </div>
          </Section>

          <Section id="overrides-caps">
            <P>
              Caps are the softer instrument: the score is computed normally, then
              ceilinged. This is how persistent memory (Part IV) and live market
              manipulation reach into a scan without distorting the weighting.
            </P>
            <div className="mt-6 grid gap-px border border-[#2a2a2a] bg-[#2a2a2a] sm:grid-cols-2">
              {POST_SCORE_RULES.map((r) => (
                <DefCard key={r.id} title={r.name} source={r.source} cap={r.cap}>
                  {r.mechanism}
                </DefCard>
              ))}
            </div>
            <P>
              A cap is published on the verdict as a rule that fired with a deduction of
              zero, because it did not deduct — it ceilinged. Read the ceiling, not the
              zero.
            </P>
          </Section>

          <Section id="overrides-order">
            <P>The three stages run in a fixed order, and each can only lower the result:</P>
            <ol className="mt-6 flex flex-col gap-px border border-[#2a2a2a] bg-[#2a2a2a]">
              <Step n="1" title="Weighted deduction">
                Every check runs; FAIL takes its full weight, WARN half. The result is
                floored at 0.
              </Step>
              <Step n="2" title="Critical overrides">
                If any override fired, the band becomes CRITICAL regardless of the number
                computed in step 1.
              </Step>
              <Step n="3" title="Post-score caps">
                Any active cap ceilings the score, and the band is re-derived from the
                capped number.
              </Step>
            </ol>
          </Section>

          {/* ── IV. PERSISTENT MEMORY ──────────────────────────────── */}
          <Part id="memory" />

          <Section id="memory-record">
            <P>
              Every token that ever fails the honeypot simulation is marked forever. While
              a mark is active the score is capped at the top of DANGER: a scammer who
              switches the trap off later still cannot buy back a CLEAR.
            </P>
            <P>
              An admin can lift a mark for a verified false positive — a token scanned
              before trading was enabled, later audited. The lifted mark stays visible with
              a public reason and date, and <Em>re-arms automatically</Em> if the trap ever
              fires again.
            </P>
          </Section>

          <Section id="memory-web">
            <P>
              The gas that funds a fresh wallet is the umbilical cord back to its operator.
              When a rug is confirmed, guilt propagates through the funding web:{" "}
              <Em>one hop is a kill shot, two hops a heavy deduction</Em>, and no further.
            </P>
            <P>
              High fan-out hubs — exchange hot wallets, faucets, bridges — break the chain
              and never transmit guilt, because everything downstream of them is everyone.
              Every stain carries the exact transaction path that produced it, so any flag
              can be re-verified against public chain data.
            </P>
          </Section>

          <Section id="memory-watch">
            <P>
              Not every rug happens in one transaction. Tokens on record are re-checked for
              liquidity bleeding down from its trailing peak, and that signal earns a
              ON-WATCH mark.
            </P>
            <P>
              A mark is not an indictment. Indictment additionally requires separately
              verified LP control and gradual-drain evidence under the public rug criteria.
              Wallet-cluster supply deltas remain dormant until a holder-snapshot feed is
              live — and are documented here as dormant rather than described as if they
              were running.
            </P>
          </Section>

          {/* ── V. THE CONTRACT AUTHORITY AUDIT ────────────────────── */}
          <Part id="audit" />

          <Section id="audit-inputs">
            <P>
              We analyse the contract&apos;s <Em>verified source</Em> when the deployer has
              published it, and its on-chain bytecode when they have not. If the token is a
              proxy — a shell that forwards to an upgradeable implementation — we follow it
              to the real code first, so an upgradeable token is judged on what it actually
              runs rather than on the empty husk in front of it.
            </P>
          </Section>

          <Section id="audit-powers">
            <P>
              Not function names — <Em>effects</Em>. We catalogue the capabilities that let
              an insider reach into a live market: minting or rebasing supply, pausing
              trading, blacklisting holders, changing fees or wallet and transaction limits,
              granting exemptions, rerouting the AMM, withdrawing liquidity, rescuing
              assets, redeeming custody, upgrading the code, or executing arbitrary calls.
            </P>
            <P>
              Each is listed with the exact functions that carry it, so anyone can check the
              finding against the public contract.
            </P>
          </Section>

          <Section id="audit-authority">
            <P>
              A power that exists is not the same as a power that is loaded. For each
              capability we resolve the authority that gates it and ask whether that
              authority is live or neutralised.
            </P>
            <P>
              <Em>A renounced owner does not mean safe.</Em> Renouncing closes only the
              doors that owner held. If the same power is gated by a different role, a dev
              wallet, a proxy admin or a multisig, it stays live — and we say so.
            </P>
          </Section>

          <Section id="audit-limits">
            <P>
              If the source is not verified, or a node times out mid-read, the audit can
              only go so far — and it reports exactly how far. An analysis that could not
              finish is never dressed up as a clean bill:{" "}
              <Em>the absence of a finding we could not look for is not evidence of
              safety.</Em>
            </P>
            <P>
              Every capability also carries how firmly it is known: traced in source, likely
              through indirection, or a bytecode-only match.
            </P>
          </Section>

          <Section id="audit-score">
            <P>
              The audit drives exactly one weighted check. A privileged power reachable
              through a live or unresolved authority is a FAIL; powers that exist but whose
              only key has been provably renounced are a WARN; a contract with none is a
              PASS.
            </P>
            <P>
              Everything else the audit surfaces — the full capability map, the controlling
              addresses, the proxy graph — is published for transparency but{" "}
              <Em>does not move the number</Em>. When the audit cannot complete, the check
              falls back to a plain bytecode scan rather than guess.
            </P>
          </Section>

          {/* ── VI. UNCERTAINTY ────────────────────────────────────── */}
          <Part id="uncertainty" />

          <Section id="uncertainty-doctrine">
            <P>
              This is the failure mode the engine is built against, and it deserves a part
              of its own because it is the one that produces confident, wrong,
              user-visible verdicts.
            </P>
            <P>
              A failed probe is not a negative result. An RPC node that never replies has
              not told us the token is safe, and it has not told us the token is a
              honeypot; it has told us nothing. Collapsing &ldquo;we could not
              look&rdquo; into &ldquo;we looked and found nothing&rdquo; is how a scanner
              publishes an all-clear it never earned — and an all-clear is the dangerous
              polarity, because a false accusation gets disputed by the token&apos;s own
              holders within the hour and a false exoneration never does.
            </P>
            <P>
              So the two are kept apart everywhere they meet. A contract call that{" "}
              <Em>reverts</Em> is an answer and is scored. A call that{" "}
              <Em>times out</Em> is an absence, is marked transient, and falls back to
              stored state rather than demoting the token. An empty result — no pool found,
              no template matched, no funder on record — is treated as unknown unless the
              read can show it actually looked.
            </P>
          </Section>

          <Section id="uncertainty-completeness">
            <P>
              Each scan is assessed as <Em>complete</Em> or <Em>partial</Em> before it is
              allowed to mint a permanent receipt, and the rule is deliberately narrow:
              only an infrastructure failure of a scoring-required provider degrades a scan.
            </P>
            <div className="mt-6 grid gap-px border border-[#2a2a2a] bg-[#2a2a2a] sm:grid-cols-2">
              <DefCard title="Complete" source="records a receipt">
                Includes domain outcomes that sound like failures but are not — a token
                with no pool at all is a legitimate, defensible thing to record. Nothing
                was missing; the answer was simply &ldquo;none&rdquo;.
              </DefCard>
              <DefCard title="Partial" source="never appends">
                A provider timed out, rate-limited, errored, or was misconfigured. Scoring
                that would risk a fabricated PASS or FAIL from missing data, so the attempt
                is recorded as degraded — with which provider failed and why — and the
                previous verdict stands.
              </DefCard>
            </div>
          </Section>

          <Section id="uncertainty-coverage">
            <P>
              A partial result is not a fact either. A check that answered over a fraction
              of its subject has not answered — a custody audit that could read six percent
              of a pool&apos;s holders knows nothing about the other ninety-four, and the
              largest holder is exactly the one most likely to be missing from a short
              sample.
            </P>
            <P>
              The contract the engine is held to therefore has two halves. Evidence records
              how much of its subject it accounted for, so a conclusion drawn over a sliver
              is visible as one. And an all-clear requires having accounted for the subject,
              not merely having found nothing in the part that was read — for LP custody
              that means the pool must be accounted for before a PASS is available, and
              custody that cannot be attributed to this token&apos;s liquidity is recorded
              without being scored.
            </P>
          </Section>

          {/* ── VII. THE RECORD ────────────────────────────────────── */}
          <Part id="record" />

          <Section id="record-determinism">
            <P>
              Each verdict is serialised to a canonical payload with a fixed key order
              before it is hashed. It contains the token address, the score, the tier,
              whether an override fired, the formula version, the ordered list of check ids
              with their statuses and deductions, and the creation timestamp — and nothing
              else.
            </P>
            <P>
              Request noise never enters: no simulation wallets, no request ids, no
              latency. That is what makes the hash re-derivable by anyone holding the
              public row.
            </P>
          </Section>

          <Section id="record-chain">
            <P>
              Each entry&apos;s hash is <Code>sha256(previous_hash : payload)</Code>. The
              first entry chains from a genesis constant. Change one historical entry and
              every hash after it breaks — there is no way to edit the past that leaves the
              chain intact.
            </P>
            <P>
              The chain head is periodically committed in a transaction from the Robin
              wallet: a public timestamp nobody can backdate, including us.
            </P>
          </Section>

          <Section id="record-fingerprint">
            <P>
              Separately from the chain hash, each outcome gets a{" "}
              <Em>result fingerprint</Em> — a hash over the formula and receipt-policy
              versions, the token, the score, tier and override flag, the ordered checks,
              the active permanent marks, and the selected pool. Two scans with the same
              fingerprint say the same thing about the token, so the second reuses the
              existing receipt instead of minting a duplicate.
            </P>
            <P>
              Liquidity is deliberately <Em>excluded</Em> from the fingerprint. It enters
              the receipt decision through its own threshold comparison; bucketing it into
              the fingerprint as well would both double-count it and make receipts flap
              every time a pool drifted across a bucket edge.
            </P>
          </Section>

          <Section id="record-verify">
            <P>Three steps, entirely from public data:</P>
            <ol className="mt-6 flex flex-col gap-px border border-[#2a2a2a] bg-[#2a2a2a]">
              <Step n="1" title="Rebuild the payload">
                Take any row from the ledger and reconstruct its canonical payload from the
                published fields, in the key order specified above.
              </Step>
              <Step n="2" title="Re-hash it">
                Hash it together with the previous entry&apos;s hash. It must equal the
                entry hash on the row.
              </Step>
              <Step n="3" title="Check the anchor">
                Confirm the chain head appears in the anchoring transaction on-chain. If it
                does, the record held.
              </Step>
            </ol>
          </Section>

          {/* ── VIII. SWAP ──────────────────────────────────────────── */}
          <Part id="swap" />

          <Section id="swap-protections">
            <P>
              The swap trades through the same Uniswap pools and router as
              everyone else. What it adds is a set of checks around the trade, so
              you see what you are buying and why a trade can or cannot happen.
            </P>
            <P>
              The token&apos;s security sits inside the swap. A quick check reads
              the contract&apos;s owner, pause and proxy settings when you review
              a buy. If the token has been scanned, its full verdict and score are
              shown beside it, with the checks that failed. Neither check says a
              token is safe.
            </P>
            <P>
              Every trade is tested on chain from your own wallet before the swap
              can be signed, as described below. A pool with a custom Uniswap V4
              hook is used only after a buy and then a sell through it both pass
              that test, and the swap says what the hook can do.
            </P>
            <P>
              When no route exists, we say why. Listed liquidity can lag the chain
              by minutes, so we read the token&apos;s main pools directly. If the
              main pool is empty, you are told that, how much liquidity is still
              listed for it elsewhere, and, when we saw it happen, the time it
              was removed.
            </P>
            <P>
              Some pools charge a fee far above the usual 1%. The swap counts that
              fee as price impact, so a trade that would lose 15% or more to it
              asks you to confirm first.
            </P>
          </Section>

          <Section id="swap-routing">
            <P>
              V1 routes through Uniswap V2, V3 and V4 pools on Robinhood Chain,
              using the Uniswap Universal Router. It prices the pools it finds for
              the pair directly, and two-hop routes through a bridge asset (ETH,
              USDG, or a verified stock token).
            </P>
            <P>
              When a token has many pools, the deepest ones are priced first, up
              to 12 per request. Pools skipped for this reason are listed in the
              trade details, never dropped silently. Pools with under $100 of
              known liquidity are skipped and listed as skipped.
            </P>
            <P>
              Other venues (for example Sushi or PancakeSwap) can be switched on
              or off by the operator. A venue that was not searched is named as
              not searched.
            </P>
          </Section>

          <Section id="swap-simulation">
            <P>
              Every trade is run on chain as a simulation from your own wallet, at
              the real gas price, before the swap can be signed. A quote that
              still waits on a token approval shows its price first and is tested
              once the approval is in place. The test run
              measures what you would actually receive and checks that the router
              kept nothing.
            </P>
            <P>
              If the test run fails or cannot be completed, no trade is offered. A
              network problem on our side is reported as a network problem, never
              as a problem with the token. If your wallet does not hold enough of
              the token you are spending, you still see the price, but nothing is
              simulated and the trade cannot be sent. The same holds before a
              wallet is connected.
            </P>
            <P>
              Pools with a Uniswap V4 hook are only used if a buy followed by a
              sell through the hook passes the test run. The swap lists what the
              hook is able to do before you confirm. Canonical stock tokens are checked on chain for an issuer
              pause before quoting. Tokens still on a launchpad bonding curve are
              not routed until they graduate to a DEX pool.
            </P>
          </Section>

          <Section id="swap-signing">
            <P>
              Swaps are non-custodial. The trade is sent from your own wallet.
              Token approvals go through Permit2. A wallet that supports batched
              calls can approve and swap in one confirmation.
            </P>
            <P>
              Minimum received: in Auto mode it is set below the output measured
              in the test run by 0.5% plus half of how far the token&apos;s price
              typically moves in five minutes, judged from its last five minutes
              and its last hour, up to 5%. You can set your own
              slippage instead. A
              quote is valid for 45 seconds. After that it must be refreshed.
            </P>
          </Section>

          <Section id="swap-caveats">
            <P>
              A route being offered is not a safety verdict on the token. The
              scanner verdict is shown separately. A successful buy test does not
              guarantee you can sell later.
            </P>
            <P>
              The best route found is the best among the pools searched, not every
              pool that exists. If a trade would lose 15% or more to price impact,
              you have to confirm it before you can continue.
            </P>
          </Section>

          {/* ── IX. REVISION HISTORY ──────────────────────────────── */}
          <Part id="history" />

          <Section id="history-changelog">
            <P>
              Every formula change, newest first. A score that moved without the chain
              moving is always attributable to an entry in this list.
            </P>
            <ol className="mt-8 border-l border-[#2a2a2a]">
              {FORMULA_CHANGELOG.map((e, i) => (
                <li key={e.version} className="relative mb-8 pl-8 last:mb-0">
                  <span
                    className={`absolute -left-[5px] top-[7px] h-[9px] w-[9px] ${
                      i === 0 ? "bg-[#ccff00]" : "bg-[#2a2a2a]"
                    }`}
                    aria-hidden="true"
                  />
                  <div className="font-mono text-[11px] tabular-nums tracking-[0.14em] text-[#8a8a8a]">
                    v{e.version} · {e.date}
                    {i === 0 && <span className="ml-3 text-[#ccff00]">CURRENT</span>}
                  </div>
                  <p className="mt-2 max-w-[70ch] text-[14px] leading-[1.75] text-[#c4c4c4]">
                    {e.changes}
                  </p>
                </li>
              ))}
            </ol>
          </Section>
        </article>
      </MethodologyChrome>
    </NoirShell>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   Document primitives. Headings read their number and title from the
   outline, so the navigation and the prose cannot disagree about either.
   ──────────────────────────────────────────────────────────────────────── */

function Part({ id }: { id: string }) {
  const entry = PART_INDEX.get(id);
  if (!entry) {
    // Loud rather than silent: a part rendered under an id the outline does not
    // know would be unreachable from every navigation on the page.
    throw new Error(`methodology: no outline part for id "${id}"`);
  }
  const { part } = entry;
  return (
    <section>
      <h2
        id={part.id}
        className="mt-20 scroll-mt-24 border-t border-[#2a2a2a] pt-10 font-cinzel text-3xl font-black leading-tight tracking-wide text-[#ededea] sm:text-4xl"
      >
        <span className="mr-4 font-mono text-base font-normal tracking-[0.2em] text-[#8a8a8a]">
          {part.numeral}
        </span>
        {part.title}
      </h2>
      <p className="mt-4 max-w-[62ch] font-serif text-base italic text-[#8a8a8a]">
        {part.summary}
      </p>
    </section>
  );
}

function Section({ id, children }: { id: string; children: ReactNode }) {
  const entry = SECTION_INDEX.get(id);
  if (!entry) {
    throw new Error(`methodology: no outline section for id "${id}"`);
  }
  const { section, label } = entry;
  return (
    <section className="mt-12">
      <h3
        id={section.id}
        className="scroll-mt-24 font-cinzel text-xl font-bold tracking-[0.06em] text-[#ededea]"
      >
        <span className="mr-3 font-mono text-xs font-normal tabular-nums tracking-[0.16em] text-[#8a8a8a]">
          {label}
        </span>
        {section.title}
      </h3>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Body paragraph. One measure, one leading, everywhere. */
function P({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 max-w-[70ch] text-[15px] leading-[1.8] text-[#8a8a8a] first:mt-0">
      {children}
    </p>
  );
}

function Em({ children }: { children: ReactNode }) {
  return <span className="text-[#ededea]">{children}</span>;
}

function Code({ children }: { children: ReactNode }) {
  return (
    <code className="whitespace-nowrap border border-[#2a2a2a] bg-[#1c1c1c] px-1.5 py-0.5 font-mono text-[12px] text-[#c4c4c4]">
      {children}
    </code>
  );
}

function Status({ s }: { s: string }) {
  return (
    <span className="font-mono text-[11px] tracking-[0.16em] text-[#c4c4c4]">{s}</span>
  );
}

function Fact({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-[#141414] px-4 py-5">
      <dt className="font-mono text-[9px] tracking-[0.22em] text-[#3d3d3d]">{label}</dt>
      <dd
        className={`mt-2 font-cinzel text-lg font-bold tabular-nums tracking-[0.06em] ${
          accent ? "text-[#ccff00]" : "text-[#ededea]"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function SourceChip({ source }: { source: string }) {
  return (
    <span className="whitespace-nowrap border border-[#2a2a2a] bg-[#1c1c1c] px-2 py-1 font-mono text-[10px] text-[#8a8a8a]">
      {source}
    </span>
  );
}

function DefCard({
  title,
  source,
  cap,
  children,
}: {
  title: string;
  source: string;
  cap?: number;
  children: ReactNode;
}) {
  return (
    <div className="bg-[#141414] px-5 py-5">
      <div className="flex items-start justify-between gap-3">
        <h4 className="font-cinzel text-sm font-bold tracking-[0.1em] text-[#ededea]">
          {title.toUpperCase()}
        </h4>
        <SourceChip source={source} />
      </div>
      {cap !== undefined && (
        <p className="mt-2 font-mono text-[10px] tracking-[0.16em] text-[#c4c4c4]">
          CEILING · {cap}
        </p>
      )}
      <p className="mt-3 text-[13px] leading-relaxed text-[#8a8a8a]">{children}</p>
    </div>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-5 bg-[#141414] px-5 py-5">
      <span className="font-cinzel text-2xl font-black leading-none tabular-nums text-[#3d3d3d]">
        {n}
      </span>
      <div>
        <h4 className="font-cinzel text-sm font-bold tracking-[0.1em] text-[#ededea]">
          {title.toUpperCase()}
        </h4>
        <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-[#8a8a8a]">
          {children}
        </p>
      </div>
    </li>
  );
}

function ExampleRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[#2a2a2a] px-5 py-4">
      <span className="text-sm text-[#8a8a8a]">{label}</span>
      <span className="font-mono text-sm tabular-nums text-[#ededea]">{value}</span>
    </div>
  );
}
