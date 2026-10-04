"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { NoirShell, PageHeader } from "./NoirShell";
import { CopyAddressChip } from "./CopyAddressChip";
import { cdnUrl } from "@/lib/config/cdn";
import { rwaCategoryAccent, rwaCategoryLabel } from "@/lib/config/rwa-categories";
import { SmartImage } from "./SmartImage";
import { useNearViewport } from "./useNearViewport";

export type RwaItem = {
  address: string;
  asset_name: string;
  asset_symbol: string;
  category: string;
  verify_status: string;
  trusted: boolean;
};

export type InfraItem = {
  address: string;
  label: string;
  category: string;
};

import { RwaIcon } from "./RwaIcon";
export { RwaIcon };


export function RwaPageClient({
  rows,
  infrastructure,
}: {
  rows: RwaItem[];
  infrastructure: InfraItem[];
}) {
  // In-memory filter over ~200 rows the server already sent — no endpoint, no
  // debounce needed. Matching a substring anywhere in symbol or name.
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("ALL");
  const q = query.trim().toLowerCase();

  /**
   * Built from the rows we HOLD, never from the category list, so a tab can
   * only ever name a filter that returns something — same rule the landing
   * showcase follows. Counted here too: a tab that says how many it has is the
   * difference between "ETF returned nothing" and "there are no ETFs".
   */
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    return [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  }, [rows]);

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (category !== "ALL" && r.category !== category) return false;
        if (q === "") return true;
        return (
          r.asset_symbol.toLowerCase().includes(q) ||
          r.asset_name.toLowerCase().includes(q) ||
          r.address.toLowerCase().includes(q)
        );
      }),
    [rows, q, category]
  );

  return (
    <NoirShell>
      <div className="relative min-h-screen w-full">
        {/* Background Layer */}
        <div className="pointer-events-none fixed inset-0 z-0 bg-[#0a0a0a]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <SmartImage
            priority
            src={cdnUrl("/backgrounds/rwa-bg.webp")}
            alt=""
            className="absolute left-0 top-0 h-full w-full object-cover object-center opacity-70"
          />
          {/* Gentle vignette to blend the image and keep text readable */}
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
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23n)'/%3E%3C/svg%3E\")",
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
          <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
            <div className="mb-8">
              <input
                type="search"
                inputMode="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search the registry — ticker or asset name"
                aria-label="Search the RWA registry by ticker or asset name"
                className="w-full border border-[#2a2a2a] bg-[#141414] px-5 py-4 font-mono text-sm text-[#ededea] placeholder-[#3d3d3d] outline-none focus:border-[#ccff00]"
              />
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setCategory("ALL")}
                  style={
                    category === "ALL" ? { borderColor: "#ccff00", color: "#ccff00" } : undefined
                  }
                  className="border border-[#2a2a2a] px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[#8a8a8a] transition-colors hover:text-[#ededea]"
                >
                  All <span className="opacity-60">{rows.length}</span>
                </button>
                {categories.map((c) => {
                  const on = category === c.value;
                  return (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setCategory(c.value)}
                      style={{
                        borderColor: on ? rwaCategoryAccent(c.value) : "#2a2a2a",
                        color: on ? rwaCategoryAccent(c.value) : undefined,
                      }}
                      className="border px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-[#8a8a8a] transition-colors hover:text-[#ededea]"
                    >
                      {rwaCategoryLabel(c.value)} <span className="opacity-60">{c.count}</span>
                    </button>
                  );
                })}
              </div>
              {(q !== "" || category !== "ALL") && (
                <p className="mt-2 font-mono text-[11px] tracking-[0.14em] text-[#8a8a8a]">
                  {filtered.length} OF {rows.length} ASSETS
                </p>
              )}
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((r) => {
                return (
                  <Link
                    key={r.address}
                    href={`/rwa/${r.address}`}
                    className="group relative flex flex-col justify-between bg-[#141414]/90 border-2 border-[#2A2A2A] p-6 brutalist-box brutalist-shadow-dark brutalist-pressable halftone-dark hover:border-[#CCFF00] transition-colors cursor-pointer"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-3">
                          <RwaIcon symbol={r.asset_symbol} />
                          <h3 className="font-cinzel text-2xl font-bold text-[#EDEDEA] group-hover:text-[#CCFF00] transition-colors">
                            {r.asset_symbol}
                          </h3>
                        </div>
                        <span
                          className={
                            r.trusted
                              ? "font-mono text-[10px] font-bold tracking-[0.18em] text-[#CCFF00]"
                              : "font-mono text-[10px] font-bold tracking-[0.18em] text-[#e0897a]"
                          }
                        >
                          {r.trusted ? "AUTHENTIC" : "REVIEW"}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-[#8a8a8a]">{r.asset_name}</p>

                      <div className="mt-4">
                        <CopyAddressChip address={r.address} label={rwaCategoryLabel(r.category)} />
                      </div>
                    </div>

                    <div className="mt-6 pt-3 border-t border-[#2a2a2a]/60 flex items-center justify-between gap-3">
                      <div className="w-full brutalist-box brutalist-shadow-dark brutalist-pressable halftone-light font-inter font-bold text-[11px] tracking-[0.18em] uppercase text-[#0a0a0a] bg-[#ededea] border-[#ededea] px-4 py-2.5 cursor-pointer group-hover:bg-[#ccff00] group-hover:border-[#ccff00] transition-colors flex items-center justify-center gap-2">
                        <span>OPEN</span>
                        <svg
                          className="w-3.5 h-3.5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2.5}
                            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                          />
                        </svg>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
            {filtered.length === 0 && (
              <div className="border border-[#2a2a2a] bg-[#141414] px-6 py-16 text-center">
                <p className="font-cinzel text-xl tracking-[0.1em] text-[#ededea]">
                  NO ASSET ON RECORD.
                </p>
                <p className="mt-3 text-sm text-[#8a8a8a]">
                  {q !== "" && category !== "ALL"
                    ? `No ${rwaCategoryLabel(category)} matches “${query.trim()}”.`
                    : q !== ""
                      ? `No registered RWA matches “${query.trim()}”.`
                      : `No registered RWA in ${rwaCategoryLabel(category)}.`}
                </p>
              </div>
            )}

            {/* Transparency Infrastructure Section */}
            <div className="mt-16 border-t-2 border-[#2A2A2A] pt-8">
              <p className="text-[11px] font-bold tracking-[0.24em] text-[#8a8a8a] uppercase">
                TRANSPARENCY · TRUSTED INFRASTRUCTURE
              </p>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[#8a8a8a]">
                These are the exact issuer addresses used by the authenticity gate and scan-time
                infrastructure exclusions. Disabling one takes effect on the next ten-minute cache
                refresh.
              </p>
              <div className="mt-6 space-y-3">
                {infrastructure.map((r) => (
                  <div
                    key={r.address}
                    className="flex flex-wrap items-center justify-between gap-3 bg-[#141414]/90 border-2 border-[#2A2A2A] p-4 brutalist-box brutalist-shadow-dark halftone-dark"
                  >
                    <span className="font-medium text-sm text-[#EDEDEA]">{r.label}</span>
                    <div className="max-w-full overflow-hidden">
                      <CopyAddressChip address={r.address} label={r.category.toUpperCase()} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Feedback & Corrections Line */}
            <div className="mt-10 pt-6 border-t border-[#2a2a2a]/60 text-center">
              <p className="text-xs text-[#8a8a8a]">
                Got something wrong? Let us know on{" "}
                <a
                  href="https://t.me/RobinCallsChat"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-[#ededea] hover:text-[#ccff00] transition-colors underline underline-offset-4"
                >
                  Telegram Chat ↗
                </a>
              </p>
            </div>
          </section>
        </div>
      </div>
    </NoirShell>
  );
}
