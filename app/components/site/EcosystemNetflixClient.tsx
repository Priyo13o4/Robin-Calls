"use client";

import React, { useMemo, useRef, useState, useEffect } from "react";
import type { DirectoryPlatform } from "@/lib/types";
import { EcosystemBillboard } from "./EcosystemBillboard";
import { EcosystemRow } from "./EcosystemRow";
import { EcosystemCard } from "./EcosystemCard";
import { EcosystemQuickViewModal } from "./EcosystemQuickViewModal";
import { SkeletonCarouselRow } from "./Skeleton";
import {
  COMMON_FIELDS,
  DIRECTORY_CATEGORIES,
  categoryDef,
  type DirectoryField,
} from "@/lib/config/ecosystem";

type DetailValue = string | string[] | boolean;

const UNISWAP_SYNTHETIC_PLATFORM: DirectoryPlatform = {
  id: 99999,
  name: "Uniswap",
  slug: "uniswap",
  url: "https://uniswap.org/",
  description: "Premier decentralized exchange protocol and automated concentrated liquidity on Robinhood Chain.",
  category: "TRADING",
  status: "published",
  has_mcp: false,
  has_agent: true,
  category_details: {
    trading_type: "Decentralized exchange (DEX)",
    agent_docs_url: "https://docs.uniswap.org",
  },
  banner_url: "https://app.uniswap.org/images/1200x630_Rich_Link_Preview_Image.png",
  created_at: new Date().toISOString(),
};

interface EcosystemNetflixClientProps {
  platforms: DirectoryPlatform[];
}

export function EcosystemNetflixClient({ platforms: initialPlatforms }: EcosystemNetflixClientProps) {
  const [platforms, setPlatforms] = useState<DirectoryPlatform[]>(() => {
    const list = [...initialPlatforms];
    if (!list.some((p) => p.slug === "uniswap" || p.name.toLowerCase() === "uniswap")) {
      list.push(UNISWAP_SYNTHETIC_PLATFORM);
    }
    return list;
  });

  const [loading, setLoading] = useState(initialPlatforms.length === 0);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("ALL");
  const [quickViewPlatform, setQuickViewPlatform] = useState<DirectoryPlatform | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const rowsSectionRef = useRef<HTMLDivElement>(null);
  const formSectionRef = useRef<HTMLDivElement>(null);

  // Client-side fallback fetch
  useEffect(() => {
    if (initialPlatforms.length > 0) {
      setPlatforms((prev) => {
        const list = [...initialPlatforms];
        if (!list.some((p) => p.slug === "uniswap" || p.name.toLowerCase() === "uniswap")) {
          list.push(UNISWAP_SYNTHETIC_PLATFORM);
        }
        return list;
      });
      setLoading(false);
      return;
    }

    let active = true;
    fetch("/api/ecosystem/platforms")
      .then((res) => res.json())
      .then((data) => {
        if (active && data.ok && Array.isArray(data.platforms)) {
          const list = [...data.platforms];
          if (!list.some((p: DirectoryPlatform) => p.slug === "uniswap" || p.name.toLowerCase() === "uniswap")) {
            list.push(UNISWAP_SYNTHETIC_PLATFORM);
          }
          setPlatforms(list);
        }
      })
      .catch((err) => {
        console.error("Failed to fetch live ecosystem platforms:", err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [initialPlatforms]);

  // Keyboard shortcut '/' to focus search input
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== searchInputRef.current) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Top 10 curated ranking list
  const topTenPlatforms = useMemo(() => {
    const topSlugsOrder = [
      "robinhood",
      "letscash",
      "pons",
      "flap",
      "robin-fun",
      "uniswap",
      "paxos-usdg",
      "gmgn-ai",
      "karma",
      "fireblocks",
      "virtuals-protocol",
      "morpho",
    ];

    const ordered: DirectoryPlatform[] = [];
    for (const slug of topSlugsOrder) {
      const found = platforms.find((p) => p.slug === slug || p.name.toLowerCase() === slug);
      if (found && !ordered.some((p) => p.id === found.id)) {
        ordered.push(found);
      }
    }

    // Fill up to 10 if some slugs are not present
    for (const p of platforms) {
      if (ordered.length >= 10) break;
      if (!ordered.some((item) => item.id === p.id)) {
        ordered.push(p);
      }
    }

    return ordered.slice(0, 10);
  }, [platforms]);

  // Group platforms by category
  const platformsByCategory = useMemo(() => {
    const map = new Map<string, DirectoryPlatform[]>();
    for (const cat of DIRECTORY_CATEGORIES) {
      map.set(cat.value, []);
    }

    for (const p of platforms) {
      const list = map.get(p.category) ?? [];
      list.push(p);
      map.set(p.category, list);
    }

    return map;
  }, [platforms]);

  // Filtered search results
  const searchResults = useMemo(() => {
    let list = platforms;
    if (selectedCategory !== "ALL") {
      list = list.filter((p) => p.category === selectedCategory);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.description ?? "").toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q)
      );
    }
    return list;
  }, [platforms, selectedCategory, search]);

  const isSearchOrFilterActive = search.trim().length > 0 || selectedCategory !== "ALL";

  const scrollToRows = () => {
    rowsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const scrollToForm = () => {
    formSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="w-full">
      {/* Top Billboard Hero (Hidden during active search to keep focus clean) */}
      {!isSearchOrFilterActive && (
        <EcosystemBillboard
          platforms={platforms}
          onQuickView={setQuickViewPlatform}
          onExploreClick={scrollToRows}
        />
      )}

      {/* De-cluttered Sticky Filter & Live Search Bar at z-40 */}
      <div
        ref={rowsSectionRef}
        className="sticky top-16 z-40 mb-8 border-y border-[#2a2a2a] bg-[#0a0a0a]/95 backdrop-blur-md py-3.5 px-3 shadow-2xl"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          {/* Left: Search Box */}
          <div className="relative flex-1 sm:max-w-md">
            <div className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-[#8a8a8a]">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </div>
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="SEARCH PLATFORMS, DEFI, TOOLS… (Press '/' to focus)"
              className="w-full border border-[#2a2a2a] bg-[#141414] py-2.5 pl-10 pr-10 font-mono text-xs text-[#ededea] placeholder-[#666] outline-none transition-colors focus:border-[#ccff00]"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="absolute inset-y-0 right-3 flex items-center text-xs text-[#8a8a8a] hover:text-[#ccff00] cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>

          {/* Center: Clean Category Dropdown Selector */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:w-64">
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full appearance-none border border-[#2a2a2a] bg-[#141414] py-2.5 pl-3.5 pr-8 font-mono text-xs text-[#ededea] outline-none transition-colors focus:border-[#ccff00] cursor-pointer"
              >
                <option value="ALL">ALL CATEGORIES ({platforms.length})</option>
                {DIRECTORY_CATEGORIES.map((cat) => {
                  const count = platformsByCategory.get(cat.value)?.length ?? 0;
                  return (
                    <option key={cat.value} value={cat.value}>
                      {cat.emoji} {cat.label} ({count})
                    </option>
                  );
                })}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[#8a8a8a]">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>

            {/* Right: List Your Platform CTA */}
            <button
              type="button"
              onClick={scrollToForm}
              className="border border-[#ccff00]/50 bg-[#1c1c1c] px-4 py-2.5 text-[10px] font-bold tracking-[0.16em] text-[#ccff00] transition-colors hover:bg-[#ccff00] hover:text-[#0a0a0a] whitespace-nowrap cursor-pointer"
            >
              + LIST PLATFORM
            </button>
          </div>
        </div>
      </div>

      {/* Loading state skeleton if fetching client-side */}
      {loading ? (
        <div className="space-y-8">
          <SkeletonCarouselRow />
          <SkeletonCarouselRow />
        </div>
      ) : isSearchOrFilterActive ? (
        /* VIEW A: Search / Filter Results Grid */
        <div className="mb-16">
          <div className="mb-6 flex items-center justify-between border-b border-[#2a2a2a] pb-3">
            <div className="flex items-center gap-3">
              <h2 className="font-cinzel text-xl font-bold tracking-tight text-[#ededea]">
                SEARCH RESULTS
              </h2>
              <span className="border border-[#2a2a2a] bg-[#141414] px-2.5 py-0.5 font-mono text-xs text-[#ccff00]">
                {searchResults.length} MATCH{searchResults.length === 1 ? "" : "ES"}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setSelectedCategory("ALL");
              }}
              className="font-mono text-xs text-[#8a8a8a] hover:text-[#ccff00] cursor-pointer"
            >
              CLEAR FILTERS ✕
            </button>
          </div>

          {searchResults.length === 0 ? (
            <div className="border border-[#2a2a2a] bg-[#141414] px-6 py-24 text-center">
              <p className="font-cinzel text-xl tracking-[0.08em] text-[#8a8a8a]">
                NO PLATFORMS MATCH YOUR SEARCH.
              </p>
              <p className="mx-auto mt-3 max-w-md text-sm text-[#8a8a8a]">
                Try adjusting your search query or select another category from the dropdown.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setSelectedCategory("ALL");
                }}
                className="mt-6 border border-[#2a2a2a] bg-[#1c1c1c] px-6 py-2.5 font-mono text-xs font-bold text-[#ccff00] hover:border-[#ccff00] cursor-pointer"
              >
                RESET SEARCH
              </button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {searchResults.map((platform) => (
                <EcosystemCard
                  key={platform.id}
                  platform={platform}
                  onQuickView={setQuickViewPlatform}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        /* VIEW B: Netflix-Style Thematic Rails */
        <div className="space-y-4">
          {/* 1. Top 10 on Robinhood Chain */}
          {topTenPlatforms.length > 0 && (
            <EcosystemRow
              title="TOP 10 ON ROBINHOOD CHAIN"
              emoji="🔥"
              platforms={topTenPlatforms}
              isTopTen={true}
              onQuickView={setQuickViewPlatform}
            />
          )}

          {/* 2. Category Rows */}
          {DIRECTORY_CATEGORIES.map((cat) => {
            const list = platformsByCategory.get(cat.value) ?? [];
            if (list.length === 0) return null;
            return (
              <EcosystemRow
                key={cat.value}
                title={cat.label}
                emoji={cat.emoji}
                platforms={list}
                onQuickView={setQuickViewPlatform}
              />
            );
          })}
        </div>
      )}

      {/* Quick View Inspection Modal */}
      <EcosystemQuickViewModal
        platform={quickViewPlatform}
        onClose={() => setQuickViewPlatform(null)}
      />

      {/* Listing Submission Section */}
      <div ref={formSectionRef} id="submit" className="mt-20">
        <SubmitForm />
      </div>
    </div>
  );
}

const inputCls =
  "w-full border border-[#2a2a2a] bg-[#141414] px-4 py-3 font-mono text-sm text-[#ededea] placeholder-[#3d3d3d] outline-none focus:border-[#ccff00]";

function DetailField({
  spec,
  value,
  onChange,
}: {
  spec: DirectoryField;
  value: DetailValue | undefined;
  onChange: (key: string, value: DetailValue | undefined) => void;
}) {
  const label = (
    <span className="mb-1.5 block font-mono text-[10px] tracking-[0.18em] text-[#8a8a8a]">
      {spec.label}
    </span>
  );

  if (spec.type === "toggle") {
    const on = value === true;
    return (
      <div>
        {label}
        <button
          type="button"
          onClick={() => onChange(spec.key, on ? undefined : true)}
          className={`border px-4 py-2 font-mono text-[11px] tracking-[0.14em] transition-colors ${
            on
              ? "border-[#ccff00] text-[#ccff00]"
              : "border-[#2a2a2a] text-[#8a8a8a] hover:text-[#ededea]"
          }`}
        >
          {on ? "YES" : "NO"}
        </button>
        {spec.hint && <p className="mt-1 text-[11px] text-[#8a8a8a]">{spec.hint}</p>}
      </div>
    );
  }

  if (spec.type === "select") {
    return (
      <div>
        {label}
        <select
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(spec.key, e.target.value || undefined)}
          className={inputCls}
        >
          <option value="">—</option>
          {spec.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (spec.type === "multiselect") {
    const picked = Array.isArray(value) ? value : [];
    return (
      <div className="sm:col-span-2">
        {label}
        <div className="flex flex-wrap gap-2">
          {spec.options?.map((o) => {
            const on = picked.includes(o);
            return (
              <button
                key={o}
                type="button"
                onClick={() => {
                  const next = on ? picked.filter((x) => x !== o) : [...picked, o];
                  onChange(spec.key, next.length ? next : undefined);
                }}
                className={`border px-3 py-1.5 font-mono text-[10px] tracking-[0.1em] transition-colors ${
                  on
                    ? "border-[#ccff00] text-[#ccff00]"
                    : "border-[#2a2a2a] text-[#8a8a8a] hover:text-[#ededea]"
                }`}
              >
                {o}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div>
      {label}
      <input
        value={typeof value === "string" ? value : ""}
        onChange={(e) => onChange(spec.key, e.target.value || undefined)}
        placeholder={spec.placeholder}
        maxLength={300}
        className={inputCls}
      />
    </div>
  );
}

function SubmitForm() {
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState("");
  const [details, setDetails] = useState<Record<string, DetailValue>>({});

  const catDef = categoryDef(category);

  function setDetail(key: string, value: DetailValue | undefined) {
    setDetails((d) => {
      const next = { ...d };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setState("sending");
    try {
      const res = await fetch("/api/ecosystem/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          url: form.get("url"),
          category,
          description: form.get("description"),
          contact: form.get("contact"),
          banner_url: form.get("banner_url"),
          details,
          website: form.get("website"), // honeypot
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setMessage(body.error ?? "Could not submit.");
        setState("error");
        return;
      }
      setState("done");
    } catch {
      setMessage("Network error. Try again.");
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <div className="border border-[#2a2a2a] bg-[#1c1c1c] px-6 py-10 text-center">
        <p className="font-cinzel text-lg tracking-[0.08em] text-[#ededea]">SUBMITTED.</p>
        <p className="mt-2 text-sm text-[#8a8a8a]">
          Manually reviewed before publishing. We verify; that&apos;s the whole brand.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-[#2a2a2a] bg-[#1c1c1c] p-6 sm:p-8">
      <h2 className="font-cinzel text-2xl font-bold tracking-[0.06em] text-[#ededea]">
        LIST YOUR PLATFORM
      </h2>
      <p className="mt-2 text-sm text-[#8a8a8a]">
        Manually reviewed before publishing. We verify; that&apos;s the whole brand.
      </p>
      <form onSubmit={onSubmit} className="mt-6 grid gap-4 sm:grid-cols-2">
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="pointer-events-none absolute left-[-9999px] h-0 w-0 opacity-0"
        />
        <input name="name" required placeholder="PLATFORM NAME" className={inputCls} />
        <input name="url" required placeholder="https://…" className={inputCls} />
        <select
          name="category"
          required
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setDetails({});
          }}
          className={inputCls}
        >
          <option value="" disabled>
            CATEGORY
          </option>
          {DIRECTORY_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.emoji} {c.label}
            </option>
          ))}
        </select>
        <input name="contact" placeholder="CONTACT (optional)" className={inputCls} />
        <input
          name="banner_url"
          type="url"
          placeholder="BANNER IMAGE URL (optional)"
          className={inputCls}
        />
        <textarea
          name="description"
          placeholder="ONE-LINE DESCRIPTION"
          rows={2}
          className={`${inputCls} sm:col-span-2`}
        />
        <p className="-mt-2 text-[11px] text-[#8a8a8a] sm:col-span-2">
          Leave banner blank and we&apos;ll pull one from your site automatically. We
          re-check it&apos;s live on every visit — no stale broken images.
        </p>

        {catDef && (
          <div className="sm:col-span-2 mt-2 border border-[#2a2a2a] bg-[#141414] p-5">
            <p className="font-mono text-[11px] tracking-[0.2em] text-[#ededea]">
              {catDef.emoji} {catDef.label} DETAILS
              <span className="ml-2 text-[#3d3d3d]">ALL OPTIONAL</span>
            </p>
            <p className="mt-1 text-[11px] text-[#8a8a8a]">
              The more you declare, the richer your card. We verify every claim
              before it ships.
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {catDef.fields.map((f) => (
                <DetailField key={f.key} spec={f} value={details[f.key]} onChange={setDetail} />
              ))}
            </div>
            <p className="mt-6 font-mono text-[10px] tracking-[0.2em] text-[#8a8a8a]">
              AGENT-READY? <span className="text-[#3d3d3d]">MCP + API ACCESS</span>
            </p>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              {COMMON_FIELDS.map((f) => (
                <DetailField key={f.key} spec={f} value={details[f.key]} onChange={setDetail} />
              ))}
            </div>
          </div>
        )}

        <div className="sm:col-span-2">
          {state === "error" && <p className="mb-3 text-sm text-[#8a8a8a]">{message}</p>}
          <button
            type="submit"
            disabled={state === "sending"}
            className="border border-[#2a2a2a] px-6 py-3 text-[11px] font-medium tracking-[0.18em] text-[#ededea] transition-colors hover:border-[#ccff00] hover:text-[#ccff00] disabled:opacity-60 cursor-pointer"
          >
            {state === "sending" ? "SUBMITTING…" : "SUBMIT FOR REVIEW"}
          </button>
        </div>
      </form>
    </div>
  );
}
