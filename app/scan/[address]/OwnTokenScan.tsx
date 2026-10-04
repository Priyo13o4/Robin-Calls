import Link from "next/link";
import type { ReactNode } from "react";
import { explorerWebUrl } from "@/lib/config/chain";
import { TOKEN_ADDRESS, TOKEN_SYMBOL, TOKEN_VERIFIERS } from "@/lib/sale/token";
import { PINKLOCK_ADDRESS, PINKSALE_LOGO_URL, VESTING_LOCKS, pinklockRecordUrl, type VestingLock } from "@/lib/sale/vesting-locks";
import type { CheckResult, Verdict } from "@/lib/types";
import { OwnTokenRescan } from "./OwnTokenRescan";

// Operator decision 2026-09-30: we issued this token, so its page shows what the
// scanner read and never a score, tier or deduction. The ledger row is untouched.

/** Checks that only describe the score itself; their sentences name a cap. */
const SCORE_ONLY_CHECKS = new Set(["unread_surface"]);

// Static on purpose: RobinCalls.sol is immutable and verified. The scanner's own
// reads render below, so a disagreement between the two is visible on the page.
const CAPABILITIES: { title: string; body: string }[] = [
  { title: "Fixed supply", body: "10,000,000 minted once at deployment. There is no mint function." },
  { title: "Code can't change", body: "No proxy and no upgrade path. The code that runs is the verified code." },
  { title: "No fees or switches", body: "No transfer tax, no blacklist, no pause, no trading switch, no wallet limit." },
  { title: "Owner can't touch balances", body: "The owner key can only hand ownership on or renounce it. Nothing else." },
  { title: "Burn your own", body: "Any holder can burn their own tokens. Nobody can burn someone else's." },
  { title: "No lost-token trap", body: "Sending tokens to the token contract itself is refused, so they can't get stuck there." },
];

const SEGMENT_COLOURS = ["#ededea", "#f95997", "#ccff00", "#6ec1ff", "#ffb35c"];

interface HolderRow {
  address: string;
  value: bigint;
}

interface HolderRead {
  rows: HolderRow[];
  total: bigint;
  holderCount: number | null;
}

function readHolders(check: CheckResult | undefined): HolderRead | null {
  const ev = check?.evidence as
    | { top10?: { address?: string; value?: string }[]; totalSupply?: string; holderCount?: number }
    | undefined;
  if (!ev?.top10 || !ev.totalSupply) return null;
  try {
    const total = BigInt(ev.totalSupply);
    if (total === BigInt(0)) return null;
    const rows = ev.top10.flatMap((h) =>
      h.address && h.value ? [{ address: h.address.toLowerCase(), value: BigInt(h.value) }] : [],
    );
    return { rows, total, holderCount: typeof ev.holderCount === "number" ? ev.holderCount : null };
  } catch {
    // Malformed evidence renders as "not read", never as an empty holder list.
    return null;
  }
}

const pctNumber = (value: bigint, total: bigint) => Number((value * BigInt(10000)) / total) / 100;
const tokens = (wei: bigint) => Number(wei / BigInt(10) ** BigInt(18));
const fmt = (n: number) => n.toLocaleString("en-US");
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function holderLabel(address: string, owner: string | null): { name: string; note?: string } {
  if (address === PINKLOCK_ADDRESS) return { name: "PinkLock vesting", note: "Five time-locked allocations, below." };
  if (owner && address === owner) {
    return { name: "Token owner", note: "Holds the public sale, liquidity and airdrop until they go out." };
  }
  const group = VESTING_LOCKS.find(
    (g) => g.locks.some((l) => l.claimWallet === address) || g.unlockedOutside?.wallet === address,
  );
  if (group?.unlockedOutside?.wallet === address) {
    return { name: `${titleCase(group.label)} wallet`, note: `Holds ${group.unlockedOutside.why}.` };
  }
  if (group) return { name: `${titleCase(group.label)} wallet` };
  return { name: "Holder" };
}

function titleCase(label: string): string {
  return label.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

function receiptAge(createdAt: string | null | undefined): string {
  if (!createdAt) return "date unknown";
  const then = new Date(createdAt).getTime();
  if (!Number.isFinite(then)) return "date unknown";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

function Caption({ children }: { children: ReactNode }) {
  return <p className="font-mono text-[10px] tracking-[0.22em] text-[#8a8a8a]">{children}</p>;
}

function Section({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section className="mx-auto max-w-5xl px-4 pb-14 sm:px-6">
      <Caption>{eyebrow}</Caption>
      <h2 className="mb-5 mt-1 font-cinzel text-2xl font-bold tracking-wide text-white sm:text-3xl">{title}</h2>
      {children}
    </section>
  );
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`border border-[#2a2a2a] bg-[#111111]/90 backdrop-blur-sm ${className}`}>{children}</div>;
}

function AddressLink({ address, label }: { address: string; label?: string }) {
  return (
    <a
      href={`${explorerWebUrl}/address/${address}`}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-white underline decoration-[#3d3d3d] underline-offset-2 hover:text-[#ccff00]"
    >
      {label ?? short(address)}
    </a>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="px-4 py-4">
      <Caption>{label}</Caption>
      <p className="mt-2 font-cinzel text-2xl font-black leading-none text-white">{value}</p>
      {sub && <p className="mt-1.5 text-xs text-white/80">{sub}</p>}
    </Card>
  );
}

export function OwnTokenScan({
  verdict,
  ledger,
}: {
  verdict: Verdict | null;
  ledger: { id: number; createdAt: string | null } | null;
}) {
  const checks = verdict?.checks ?? [];
  const ownerRaw = (checks.find((c) => c.id === "ownership")?.evidence as { owner?: unknown } | undefined)?.owner;
  const owner = typeof ownerRaw === "string" ? ownerRaw.toLowerCase() : null;
  const holders = readHolders(checks.find((c) => c.id === "holder_concentration"));
  const shown = checks.filter((c) => !SCORE_ONLY_CHECKS.has(c.id));
  const read = shown.filter((c) => c.status !== "SKIP");
  const notRead = shown.filter((c) => c.status === "SKIP");
  const allLocks = VESTING_LOCKS.flatMap((g) => g.locks.map((l) => ({ group: g.label, lock: l })));
  const lockedTotal = allLocks.reduce((s, { lock }) => s + lock.amount, 0);
  const pinkRow = holders?.rows.find((h) => h.address === PINKLOCK_ADDRESS);

  return (
    <>
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 pb-8 font-mono text-[11px] tracking-[0.14em] text-white sm:px-6">
        <span className="border border-[#a08b5b]/60 px-2 py-1 text-[#e6c98a]">
          {ledger ? `LAST SCAN ${receiptAge(ledger.createdAt).toUpperCase()}` : "NO SCAN RECORD READ"}
        </span>
        <OwnTokenRescan address={TOKEN_ADDRESS} />
        <Link href="/tokenomics" className="underline underline-offset-4 hover:text-[#ccff00]">
          TOKENOMICS
        </Link>
        <AddressLink address={TOKEN_ADDRESS} label="VIEW ON EXPLORER" />
      </div>

      {/* Why there is no score */}
      <section className="mx-auto max-w-5xl px-4 pb-10 sm:px-6">
        <Card className="flex flex-col gap-4 border-[#ccff00]/40 p-6 sm:flex-row sm:items-center sm:gap-8">
          <div className="flex-none border-2 border-[#ccff00] px-4 py-3 text-center">
            <p className="font-cinzel text-xl font-black tracking-[0.14em] text-[#ccff00]">NOT</p>
            <p className="font-cinzel text-xl font-black tracking-[0.14em] text-[#ccff00]">SCORED</p>
          </div>
          <div>
            <p className="text-lg font-semibold text-white">We built the scanner and we issued this token.</p>
            <p className="mt-1.5 text-sm leading-relaxed text-white">
              A grade we gave ourselves would be worth nothing, so there isn&apos;t one. The scanner still runs the
              same checks it runs on every token, and every result is below, word for word.
            </p>
          </div>
        </Card>
      </section>

      {/* Headline numbers */}
      <section className="mx-auto grid max-w-5xl grid-cols-2 gap-3 px-4 pb-14 sm:px-6 lg:grid-cols-4">
        <Stat
          label="TOTAL SUPPLY"
          value={holders ? fmt(tokens(holders.total)) : "—"}
          sub={holders ? "At the last scan" : "Not read on the last scan"}
        />
        <Stat
          label="IN PINKLOCK"
          value={pinkRow && holders ? `${pctNumber(pinkRow.value, holders.total).toFixed(1)}%` : "—"}
          sub={pinkRow ? `${fmt(tokens(pinkRow.value))} ${TOKEN_SYMBOL}` : `${fmt(lockedTotal)} locked at creation`}
        />
        <Stat
          label="HOLDERS"
          value={holders?.holderCount != null ? fmt(holders.holderCount) : "—"}
          sub={holders?.holderCount != null ? "At the last scan" : "Not read on the last scan"}
        />
        <Stat label="CONTRACT" value="VERIFIED" sub={`On ${TOKEN_VERIFIERS.length} explorers, fixed code`} />
      </section>

      <Section eyebrow="FROM THE VERIFIED SOURCE" title="What the contract can do">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map((c) => (
            <Card key={c.title} className="p-5">
              <div className="flex items-center gap-2.5">
                <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-full border border-[#ccff00]/60 text-[12px] text-[#ccff00]">
                  ✓
                </span>
                <p className="font-semibold text-white">{c.title}</p>
              </div>
              <p className="mt-2.5 text-sm leading-relaxed text-white">{c.body}</p>
            </Card>
          ))}
        </div>
        <p className="mt-4 text-sm text-white">
          Read the source yourself on{" "}
          {TOKEN_VERIFIERS.map((v, i) => (
            <span key={v.name}>
              {i > 0 && (i === TOKEN_VERIFIERS.length - 1 ? " or " : ", ")}
              <a href={v.href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-[#ccff00]">
                {v.name}
              </a>
            </span>
          ))}
          .
        </p>
      </Section>

      <Section eyebrow="AT THE LAST SCAN" title="Where the supply sits">
        {holders ? (
          <Card className="p-5">
            <div className="flex h-4 w-full overflow-hidden rounded-sm">
              {holders.rows.map((h, i) => (
                <span
                  key={h.address}
                  style={{ width: `${pctNumber(h.value, holders.total)}%`, background: SEGMENT_COLOURS[i % SEGMENT_COLOURS.length] }}
                />
              ))}
            </div>
            <ul className="mt-5 grid gap-4 sm:grid-cols-3">
              {holders.rows.map((h, i) => {
                const label = holderLabel(h.address, owner);
                return (
                  <li key={h.address} className="flex gap-3">
                    <span aria-hidden className="mt-1.5 h-3 w-3 flex-none rounded-sm" style={{ background: SEGMENT_COLOURS[i % SEGMENT_COLOURS.length] }} />
                    <div className="min-w-0">
                      <p className="font-cinzel text-2xl font-black leading-none text-white">
                        {pctNumber(h.value, holders.total).toFixed(1)}%
                      </p>
                      <p className="mt-1 font-semibold text-white">{label.name}</p>
                      <p className="text-sm text-white">
                        {fmt(tokens(h.value))} {TOKEN_SYMBOL} · <AddressLink address={h.address} />
                      </p>
                      {label.note && <p className="mt-0.5 text-sm text-white/80">{label.note}</p>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        ) : (
          <Card className="p-5 text-white">
            {verdict ? "The holder list was not read on the last scan." : "No scan record was read, so holders are not shown."}
          </Card>
        )}
      </Section>

      <Section eyebrow={`PINKLOCK · ${fmt(lockedTotal)} ${TOKEN_SYMBOL}`} title="Vesting locks">
        <div className="grid gap-3 md:grid-cols-2">
          {allLocks.map(({ group, lock }) => (
            <LockCard key={lock.lockId} group={group} lock={lock} />
          ))}
        </div>
        <p className="mt-4 text-sm text-white">
          Held by PinkLock at <AddressLink address={PINKLOCK_ADDRESS} />. A lock&apos;s owner can push its dates later or
          add tokens. Nobody can shorten or shrink a lock.
        </p>
      </Section>

      <Section eyebrow="SAME CHECKS AS EVERY TOKEN" title="Everything the scanner read">
        {shown.length === 0 ? (
          <Card className="p-5 text-white">No scan record was read for this token. Run a fresh scan above.</Card>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              {read.map((c) => (
                <CheckCard key={c.id} check={c} />
              ))}
            </div>
            {notRead.length > 0 && (
              <>
                <div className="mb-3 mt-8">
                  <Caption>NOT READ ON THIS SCAN · MOSTLY MARKET DATA, THERE IS NO POOL YET</Caption>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {notRead.map((c) => (
                    <CheckCard key={c.id} check={c} dim />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </Section>
    </>
  );
}

/** Where a lock sits on its schedule at request time. Bar runs first unlock → fully unlocked. */
function lockTimeline(lock: VestingLock, now = Date.now()) {
  const start = Date.parse(`${lock.firstUnlock}T00:00:00Z`);
  const end = Date.parse(`${lock.fullyUnlocked}T00:00:00Z`);
  return {
    state: now < start ? "LOCKED" : now < end ? "RELEASING" : "FULLY UNLOCKED",
    days: Math.ceil((start - now) / 86_400_000),
    progress: Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100)),
  };
}

function LockCard({ group, lock }: { group: string; lock: VestingLock }) {
  const { state, days, progress } = lockTimeline(lock);

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Caption>{group}</Caption>
          <p className="mt-1 font-cinzel text-2xl font-black text-white">
            {fmt(lock.amount)} <span className="text-base">{TOKEN_SYMBOL}</span>
          </p>
        </div>
        <span
          className={`border px-2 py-1 font-mono text-[10px] tracking-[0.16em] ${
            state === "LOCKED" ? "border-white/60 text-white" : "border-[#ccff00]/60 text-[#ccff00]"
          }`}
        >
          {state}
        </span>
      </div>
      <div className="mt-4 h-1.5 w-full bg-[#2a2a2a]">
        <div className="h-full bg-[#f95997]" style={{ width: `${progress}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[11px] text-white">
        <span>{lock.firstUnlock}</span>
        <span>{lock.fullyUnlocked}</span>
      </div>
      <p className="mt-3 text-sm text-white">
        {state === "LOCKED" ? `First unlock in ${fmt(days)} day${days === 1 ? "" : "s"}. ` : ""}
        Releases {lock.release}.
      </p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-sm text-white">
          Claim wallet <AddressLink address={lock.claimWallet} />
        </span>
        <a
          href={pinklockRecordUrl(lock.lockId)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 font-mono text-[12px] font-bold text-[#f95997] hover:text-[#ffa3c4]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={PINKSALE_LOGO_URL} alt="" aria-hidden width={14} height={14} className="h-3.5 w-3.5 rounded-full" />
          LOCK #{lock.lockId} ↗
        </a>
      </div>
    </Card>
  );
}

function CheckCard({ check, dim = false }: { check: CheckResult; dim?: boolean }) {
  return (
    <Card className={`p-4 ${dim ? "opacity-70" : ""}`}>
      <Caption>{check.name.toUpperCase()}</Caption>
      <p className="mt-1.5 text-sm leading-relaxed text-white">{check.reason}</p>
    </Card>
  );
}
