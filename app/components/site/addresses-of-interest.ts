import type { CheckResult } from "@/lib/types";

/**
 * The "ADDRESSES OF INTEREST" panel's data (KNOWN-PROBLEMS L130).
 *
 * The rule this file exists to enforce: **an address's role comes from a named
 * evidence field, never from the name of the check that mentioned it.** A check
 * name is the QUESTION asked, not an answer about the address. Labelling by
 * check name published the Pons V2 Meme Hook 17 times under "HONEYPOT" and the
 * Launchpad V2 Launch Locker 22 times under "HOLDER CONCENTRATION" on FAIL
 * verdicts: 65 rows across 62 verdicts naming a registry-known piece of
 * infrastructure as a party to investigate (§10, no accusation by implication).
 *
 * The stated LIMIT of an evidence-only reader: it can name a locker only where
 * the verdict recorded one. `lockersMatched` is about POOL liquidity, so on a
 * token where a locker holds supply instead it is legitimately empty, and 14
 * historical verdicts (newest #250, score_version 1.39) therefore still show
 * that locker as "LARGEST HOLDER" — which is exactly what their own
 * holder-concentration sentence says, and 1.44 already excludes permanent
 * supply lockers from the float. Do NOT close that gap with an address list in
 * this file: a literal here would go stale against `trusted_address` (§8 #11)
 * and would make the panel contradict the sentence beside it (§10, rewrite the
 * wording, never the claim).
 *
 * Second rule: nothing is harvested from `reason` prose. The old harvest ran
 * over the five flags the page displays, and on a CLEAR verdict those are
 * sorted PASS-first, so every address it could find came from a sentence saying
 * nothing was wrong, while the actual largest holder was cut by the slice.
 */
export interface AddressOfInterest {
  address: string;
  /** What the address IS. Merged with " · " when one address holds two roles. */
  role: string;
  rank: number;
}

/**
 * A glance, not a census. Ranked before it is sliced (§8 #18): `rank` is the
 * order of consequence to the reader, so the cut can only ever drop the least
 * consequential row, and the parties that decide the verdict cannot be crowded
 * out by infrastructure.
 */
export const ADDRESSES_OF_INTEREST_MAX = 4;

type Ev = Record<string, unknown>;
const ZERO = "0x0000000000000000000000000000000000000000";
const ev = (c: CheckResult | undefined): Ev => (c?.evidence ?? {}) as Ev;
const addr = (v: unknown): string | null =>
  typeof v === "string" && /^0x[a-fA-F0-9]{40}$/.test(v) && v.toLowerCase() !== ZERO ? v : null;

export function addressesOfInterest(checks: CheckResult[]): AddressOfInterest[] {
  const by = (id: string) => checks.find((c) => c.id === id);
  const found: AddressOfInterest[] = [];
  const add = (rank: number, role: string, value: unknown) => {
    const hex = addr(value);
    if (hex) found.push({ address: hex, role, rank });
  };

  const lineage = by("funding_lineage");
  const custody = ev(by("lp_custody"));
  const holders = ev(by("holder_concentration"));
  const owner = ev(by("ownership"));

  // Only from an adverse status. `originDeployer` is also set on the clean
  // path, where it is simply the end of a traced chain and accuses nobody.
  if (lineage?.status === "FAIL") add(0, "CONFIRMED RUGGER", ev(lineage).originDeployer);

  add(1, "LIQUIDITY REMOVED BY", custody.largestPuller);

  const top10 = Array.isArray(holders.top10) ? (holders.top10 as Ev[]) : [];
  add(2, "LARGEST HOLDER", top10[0]?.address);

  if (owner.renounced === false) add(3, "ACTIVE OWNER KEY", owner.owner);

  // Only checks built by `subjectEvidence` carry `subjectVia`, and only there
  // does `deployer` mean the person: `lp_custody.deployer` is the creating
  // ADDRESS, which for a pad-launched token is the factory contract.
  const subject = checks.find((c) => typeof ev(c).subjectVia === "string" && addr(ev(c).deployer));
  if (subject) {
    const e = ev(subject);
    add(4, e.subjectVia === "creator" ? "DEPLOYER" : "LAUNCH CREATOR", e.deployer);
    add(6, "DEPLOYING CONTRACT", e.creator);
  } else if (custody.deployerKind === "CONTRACT") {
    add(6, "DEPLOYING CONTRACT", custody.deployer);
  } else {
    add(4, "DEPLOYER", custody.deployer);
  }

  // `lockersMatched` is derived from `trustedLockers()`, so every entry is a
  // registry row, and it carries that row's own label. Ranked above the factory
  // because on a clean verdict the locker is the most useful thing on the page.
  //
  // The label is AUTHORITATIVE for its address, not one role among several
  // (see the merge below). Replaying this function over all 289 published
  // verdicts caught 47 rows where the locker also satisfied "LARGEST HOLDER",
  // because older score versions did not yet exclude permanent lockers from the
  // float. "Largest holder" is a claim about a quantity someone can act on, and
  // a permanent locker cannot act; merging the two labels reintroduces L130's
  // accusation in a new coat. The quantity itself is untouched, it stays in the
  // holder-concentration sentence, so this reclassifies rather than deletes
  // (§8 #13).
  const lockerLabels = new Map<string, string>();
  for (const l of (Array.isArray(custody.lockersMatched) ? custody.lockersMatched : []) as Ev[]) {
    const hex = addr(l?.address);
    if (!hex) continue;
    lockerLabels.set(hex.toLowerCase(), typeof l?.label === "string" ? l.label.toUpperCase() : "TRUSTED LOCKER");
    add(5, lockerLabels.get(hex.toLowerCase())!, hex);
  }

  add(7, "FUNDING WALLET", ev(by("funder_rug_history")).funder ?? ev(lineage).funder);

  const sell = ev(by("honeypot")).adapterSell as Ev | undefined;
  add(8, "SWAP HOOK", sell?.hooks ?? custody.hooks);

  const merged = new Map<string, AddressOfInterest>();
  for (const row of [...found].sort((a, b) => a.rank - b.rank)) {
    const key = row.address.toLowerCase();
    const seen = merged.get(key);
    // One address can hold two roles and the merge IS the finding (§8 #14): a
    // launch creator who is also the largest holder is a different token than
    // either fact alone, and two separate rows would hide it. A registered
    // locker is the exception, above: its label is what the address IS, and it
    // keeps whatever rank it earned so a locker holding the biggest position
    // still leads the panel, correctly named.
    if (!seen) merged.set(key, { ...row, role: lockerLabels.get(key) ?? row.role });
    else if (!lockerLabels.has(key) && !seen.role.includes(row.role)) {
      seen.role = `${seen.role} · ${row.role}`;
    }
  }
  return [...merged.values()].sort((a, b) => a.rank - b.rank).slice(0, ADDRESSES_OF_INTEREST_MAX);
}
