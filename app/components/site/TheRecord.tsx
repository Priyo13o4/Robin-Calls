import type { RecordStamp, TokenMark, TokenRecord } from "@/lib/types";

/**
 * THE RECORD (#2) — a token's rap sheet as a strip of rubber-stamp imprints,
 * one per past verdict. No dropdown, no chart, no table: discrete judgments,
 * stamped and chained, exactly the product story ("Robin remembers it").
 *
 * Monochrome by design — the lime budget lives on the live score numeral in
 * VerdictView. Stamp rotation is derived deterministically from each verdict's
 * entry hash so it is stable across renders (no hydration drift) and no two
 * stamps sit at the same angle.
 */
export function TheRecord({
  record,
  currentVerdictId,
  tokenAddress,
}: {
  record: TokenRecord | null;
  currentVerdictId?: number | null;
  tokenAddress: string;
}) {
  const stamps = record?.stamps ?? [];
  const totalCount = record?.totalCount ?? stamps.length;
  const hiddenCount = Math.max(0, totalCount - stamps.length);
  const mark = record?.mark ?? null;
  const watch = record?.watch ?? false;

  if (stamps.length === 0 && !mark && !watch) {
    return (
      <div
        data-testid="the-record"
        className="mt-12 w-full min-w-0"
      >
        <RecordLabel />
        <div className="mt-3 inline-block -rotate-2 border-2 border-dashed border-[#2a2a2a] px-5 py-3 font-cinzel text-xs tracking-[0.2em] text-[#3d3d3d]">
          FIRST SCAN ON RECORD
        </div>
      </div>
    );
  }

  const newest = stamps[0];
  const firstScore = record?.firstScore ?? stamps.at(-1)?.score ?? null;
  const delta = newest && firstScore !== null ? newest.score - firstScore : 0;

  return (
    <div
      data-testid="the-record"
      className="mt-12 w-full min-w-0"
    >
      <RecordLabel />

      {/* delta line */}
      {stamps.length > 0 && (
        <p className="mt-2 font-mono text-[11px] tracking-[0.1em] text-[#8a8a8a]">
          {totalCount} VERDICT{totalCount !== 1 ? "S" : ""} ON RECORD
          {stamps.length > 1 && (
            <>
              {" · "}
              MOVED {delta >= 0 ? "+" : ""}
              {delta} SINCE FIRST SCAN ({firstScore} → {newest!.score})
            </>
          )}
        </p>
      )}

      {/* the strip — newest (this scan) first, scrolls like a filmstrip */}
      <div className="relative w-full min-w-0 max-w-full overflow-hidden">
        <div
          data-testid="record-strip"
          className="mt-4 flex w-full min-w-0 max-w-full snap-x gap-5 overflow-x-auto px-2 pb-5 pt-3 [scrollbar-color:#2a2a2a_transparent] [scrollbar-width:thin]"
        >
          {mark && <OffenderStamp mark={mark} />}
          {watch && <WatchStamp />}
          {stamps.map((s, i) => (
            <Stamp
              key={s.id}
              stamp={s}
              isCurrent={i === 0 && (currentVerdictId == null || s.id === currentVerdictId)}
            />
          ))}
          {hiddenCount > 0 && (
            <a
              href={`/ledger?token=${encodeURIComponent(tokenAddress)}`}
              className="flex h-[132px] w-[150px] shrink-0 snap-start flex-col items-center justify-center border border-dashed border-[#3d3d3d] px-4 text-center font-mono text-[#8a8a8a] hover:border-[#ccff00] hover:text-[#ededea]"
            >
              <span className="font-cinzel text-2xl font-bold">+{hiddenCount}</span>
              <span className="mt-2 text-[10px] tracking-[0.14em]">MORE IN THE LEDGER</span>
            </a>
          )}
        </div>
        {(stamps.length + Number(Boolean(mark)) + Number(watch) > 4 || hiddenCount > 0) && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-3 right-0 w-12 bg-gradient-to-l from-[#0a0a0a] to-transparent"
          />
        )}
      </div>
    </div>
  );
}

function RecordLabel() {
  return (
    <div className="flex items-center gap-3">
      <span className="font-cinzel text-lg font-bold tracking-[0.2em] text-[#ededea]">
        THE RECORD
      </span>
      <span className="h-px flex-1 bg-[#2a2a2a]" />
    </div>
  );
}

/** Ink treatment per tier — the guilty end of the sheet is stamped hardest. */
function inkFor(tier: RecordStamp["tier"]) {
  switch (tier) {
    case "CRITICAL":
      return { fg: "#ededea", ring: "#ededea", opacity: 1, weight: 2 };
    case "DANGER":
      return { fg: "#ededea", ring: "#8a8a8a", opacity: 0.92, weight: 2 };
    case "CAUTION":
      return { fg: "#c7c7c2", ring: "#8a8a8a", opacity: 0.82, weight: 1 };
    default: // CLEAR
      return { fg: "#ededea", ring: "#4a4a4a", opacity: 0.8, weight: 1 };
  }
}

/** Deterministic -5..+5° tilt from the entry hash. */
function tiltOf(hash: string): number {
  const n = parseInt(hash.replace(/^0x/, "").slice(0, 4) || "0", 16);
  return (n % 11) - 5;
}

function Stamp({ stamp, isCurrent }: { stamp: RecordStamp; isCurrent: boolean }) {
  const ink = inkFor(stamp.tier);
  const tilt = tiltOf(stamp.entryHash);
  const date = stamp.createdAt.slice(0, 10);
  const criticalWord =
    stamp.criticalOverride === "honeypot" ? "HONEYPOT" : stamp.tier;

  return (
    <a
      href={`/ledger?v=${stamp.id}#v${stamp.id}`}
      className="group relative shrink-0 snap-start"
      title={`Verdict #${stamp.id}: verify in the ledger`}
      style={{ transform: `rotate(${tilt}deg)` }}
    >
      <div
        className="relative flex h-[132px] w-[132px] flex-col items-center justify-center px-2 text-center transition-transform duration-200 group-hover:scale-[1.04]"
        style={{
          color: ink.fg,
          opacity: ink.opacity,
          border: `${ink.weight}px solid ${ink.ring}`,
          boxShadow: `inset 0 0 0 ${ink.weight}px ${ink.ring}`,
          background:
            "radial-gradient(120% 120% at 30% 20%, rgba(20,20,20,0.0) 40%, rgba(10,10,10,0.5) 100%)",
        }}
      >
        {/* ink texture */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 mix-blend-overlay opacity-[0.18]"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)'/%3E%3C/svg%3E\")",
          }}
        />
        <div className="font-cinzel text-[38px] font-black leading-none">{stamp.score}</div>
        <div className="mt-1 font-cinzel text-[11px] font-semibold tracking-[0.14em]">
          {criticalWord}
        </div>
        <div className="mt-2 font-mono text-[9px] tracking-[0.08em] text-current">
          #{stamp.id} · {date}
        </div>
      </div>
      {isCurrent && (
        <span className="absolute -top-2 left-1/2 -translate-x-1/2 whitespace-nowrap bg-[#0a0a0a] px-2 font-mono text-[9px] tracking-[0.2em] text-[#8a8a8a]">
          THIS SCAN
        </span>
      )}
    </a>
  );
}

/** Slow-rug watch stamp (§4.3) — the token is bleeding out gradually. */
function WatchStamp() {
  return (
    <div className="relative shrink-0 snap-start" style={{ transform: "rotate(4deg)" }}>
      <div
        className="relative flex h-[132px] w-[132px] flex-col items-center justify-center px-2 text-center"
        style={{
          color: "#c7c7c2",
          border: "2px dashed #8a8a8a",
        }}
      >
        <div className="font-cinzel text-sm font-black leading-tight">WATCH</div>
        <div className="mt-1 font-cinzel text-[10px] font-semibold tracking-[0.16em]">
          LIST
        </div>
        <div className="mt-2 font-mono text-[9px] tracking-[0.08em]">
          GRADUAL DRAIN
        </div>
      </div>
    </div>
  );
}

/** The lead stamp when a permanent honeypot mark is active or was lifted. */
function OffenderStamp({ mark }: { mark: TokenMark }) {
  const lifted = mark.liftedAt !== null;
  const markedOn = mark.createdAt.slice(0, 10);
  return (
    <div className="relative shrink-0 snap-start" style={{ transform: "rotate(-7deg)" }}>
      <div
        className="relative flex h-[150px] w-[168px] flex-col items-center justify-center px-3 text-center"
        style={{
          color: lifted ? "#8a8a8a" : "#ededea",
          border: `3px double ${lifted ? "#8a8a8a" : "#ededea"}`,
          boxShadow: `inset 0 0 0 2px ${lifted ? "#3d3d3d" : "#8a8a8a"}`,
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 mix-blend-overlay opacity-[0.2]"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)'/%3E%3C/svg%3E\")",
          }}
        />
        <div className={`font-cinzel text-base font-black leading-tight ${lifted ? "line-through" : ""}`}>
          PRIOR
          <br />
          OFFENDER
        </div>
        <div className="mt-1 font-cinzel text-[10px] font-semibold tracking-[0.16em]">
          HONEYPOT
        </div>
        <div className="mt-1 font-mono text-[9px] tracking-[0.08em]">
          {markedOn}
          {mark.firedCount > 1 && ` · ×${mark.firedCount}`}
        </div>
      </div>
      {lifted && (
        <span className="absolute -bottom-3 left-1/2 w-[180px] -translate-x-1/2 text-center font-mono text-[9px] leading-tight tracking-[0.06em] text-[#8a8a8a]">
          LIFTED AFTER REVIEW
        </span>
      )}
    </div>
  );
}
