import type { ReactNode } from "react";

/**
 * One semantic tone system for the whole admin console. Before this, danger/
 * warning/success had 3-6 near-identical, inconsistently-picked shades spread
 * across pages (Capacity, Logs, Marks...) — a FATAL log and a WARN log read at
 * nearly the same red. Every status color in /admin should come from here.
 */
export const TONE = {
  danger: {
    border: "border-[#8a3a30]",
    text: "text-[#e0897a]",
    bg: "bg-[#1c1414]",
    dot: "bg-[#e0897a]",
  },
  warning: {
    border: "border-[#8a6d1f]",
    text: "text-[#d9c96a]",
    bg: "bg-[#1c1a14]",
    dot: "bg-[#d9c96a]",
  },
  success: {
    border: "border-[#3d5c3d]",
    text: "text-[#8fbf6a]",
    bg: "bg-[#141c14]",
    dot: "bg-[#8fbf6a]",
  },
  neutral: {
    border: "border-[#2a2a2a]",
    text: "text-[#8a8a8a]",
    bg: "bg-[#141414]",
    dot: "bg-[#8a8a8a]",
  },
  accent: {
    border: "border-[#ccff00]",
    text: "text-[#ccff00]",
    bg: "bg-[#1a1f0a]",
    dot: "bg-[#ccff00]",
  },
} as const;
export type Tone = keyof typeof TONE;

/** Small uppercase status pill — the one badge shape used everywhere. */
export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  const t = TONE[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 border ${t.border} ${t.bg} px-2 py-0.5 font-mono text-[10px] tracking-[0.12em] ${t.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
      {children}
    </span>
  );
}

/** The flat bordered card shape used for every list row / form / panel. */
export function Card({
  children,
  className = "",
  muted = false,
}: {
  children: ReactNode;
  className?: string;
  muted?: boolean;
}) {
  return (
    <div
      className={`border border-[#2a2a2a] bg-[#141414] p-4 ${muted ? "opacity-60" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

/** Empty-state placeholder — the "nothing here" card every list page needs. */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="border border-[#2a2a2a] bg-[#141414] px-5 py-8 text-center text-sm text-[#8a8a8a]">
      {children}
    </p>
  );
}

/**
 * A prose alert box, toned. Replaces three separately-invented alert styles
 * (Capacity's "not configured" red, "unreachable" amber, Overview/Wanted's
 * plain gray notice) with one component.
 */
export function InfoBox({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children: ReactNode;
}) {
  const t = TONE[tone];
  return (
    <p className={`mb-6 border ${t.border} ${t.bg} px-4 py-3 text-sm leading-relaxed ${t.text}`}>
      {children}
    </p>
  );
}

/** The "SECTION LABEL (N)" mono uppercase header used above every list. */
export function SectionLabel({
  children,
  count,
}: {
  children: ReactNode;
  count?: number;
}) {
  return (
    <h2 className="mb-3 font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]">
      {children}
      {count !== undefined && <span className="text-[#3d3d3d]"> ({count})</span>}
    </h2>
  );
}

/**
 * Collapsible reference panel for methodology/glossary text that used to be
 * crammed into a one-line AdminHeading subtitle (Lockers' verification rules,
 * The Web's stains/hops jargon). Closed by default so the page reads clean;
 * the knowledge is one click away instead of a wall of text up top.
 */
export function InfoPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="mb-6 border border-[#2a2a2a] bg-[#141414] open:pb-4">
      <summary className="cursor-pointer px-4 py-2.5 font-mono text-[11px] tracking-[0.16em] text-[#8a8a8a] hover:text-[#ededea]">
        {title}
      </summary>
      <div className="space-y-2 border-t border-[#2a2a2a] px-4 pt-3 text-xs leading-relaxed text-[#8a8a8a]">
        {children}
      </div>
    </details>
  );
}

/** A single stat tile — number first, label under it, optional link + tone. */
export function StatTile({
  label,
  value,
  href,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: string | number | null;
  href?: string;
  tone?: Tone;
  hint?: string;
}) {
  const t = TONE[tone];
  const inner = (
    <div className={`border ${tone === "neutral" ? "border-[#2a2a2a]" : t.border} bg-[#141414] px-5 py-5`}>
      <div className={`text-3xl font-bold tabular-nums ${tone === "neutral" ? "text-[#ededea]" : t.text}`}>
        {value ?? "—"}
      </div>
      <div className="mt-2 text-[11px] tracking-[0.16em] text-[#8a8a8a]">{label}</div>
      {hint && <div className="mt-1 text-[11px] leading-snug text-[#4a4a4a]">{hint}</div>}
    </div>
  );
  return href ? (
    <a href={href} className="block transition-colors hover:[&>div]:border-[#8a8a8a]">
      {inner}
    </a>
  ) : (
    inner
  );
}
