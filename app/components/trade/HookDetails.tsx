"use client";

import { useEffect, useState } from "react";
import { BookOpen, ChevronDown, ExternalLink } from "lucide-react";
import { hookFacts, hookFlagWords } from "@/lib/hooks/describe";
import { HOOKLIST_SOURCE_URL, type UniswapHookInfo } from "@/lib/hooks/types";

export interface HookLookup {
  /** false: the list could not be read, so "not listed" cannot be said. */
  looked: boolean;
  hook: UniswapHookInfo | null;
}

const cache = new Map<string, Promise<HookLookup>>();

function lookupHook(address: string): Promise<HookLookup> {
  const key = address.toLowerCase();
  let hit = cache.get(key);
  if (!hit) {
    hit = fetch(`/api/hooks?addresses=${key}`, { headers: { accept: "application/json" } })
      .then(async (r) => {
        if (!r.ok) return { looked: false, hook: null };
        const j = (await r.json()) as { looked?: boolean; hooks?: Record<string, UniswapHookInfo> };
        return { looked: j.looked === true, hook: j.hooks?.[key] ?? null };
      })
      .catch(() => ({ looked: false, hook: null }));
    // A failed read is not remembered, so the next render can try again.
    hit.then((v) => { if (!v.looked) cache.delete(key); });
    cache.set(key, hit);
  }
  return hit;
}

/**
 * Uniswap hook list entry for one hook, collapsed to one line. Pass `preloaded` from a server
 * page; otherwise it is fetched. Being listed never reads as safe: entries are written by each
 * hook's own team.
 */
export function HookDetails({ address, preloaded, defaultOpen = false, className = "" }: {
  address: string;
  preloaded?: HookLookup;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [lookup, setLookup] = useState<HookLookup | null>(preloaded ?? null);
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (preloaded) return;
    let live = true;
    void lookupHook(address).then((v) => { if (live) setLookup(v); });
    return () => { live = false; };
  }, [address, preloaded]);

  const hook = lookup?.hook ?? null;
  const facts = hook ? hookFacts(hook) : [];
  const warnings = facts.filter((f) => f.tone === "warn").length;
  const summary = lookup === null ? "Checking Uniswap's hook list…"
    : hook ? hook.name
    : lookup.looked ? "Not in Uniswap's hook list"
    : "Uniswap's hook list could not be checked";

  return (
    <div className={`rounded-md border border-white/10 bg-black/25 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
      >
        <BookOpen className="size-3.5 flex-none opacity-70" />
        <span className="min-w-0 flex-1 truncate font-medium">
          <span className="opacity-70">Hook details: </span>{summary}
        </span>
        {warnings > 0 && (
          <span className="flex-none rounded-full border border-[#ffb020]/40 bg-[#ffb020]/10 px-1.5 text-[11px] text-[#ffc861]">
            {warnings} to know
          </span>
        )}
        <ChevronDown className={`size-3.5 flex-none opacity-70 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-white/10 px-2.5 py-2 leading-5">
          {hook ? (
            <>
              <p className="opacity-70">Uniswap&apos;s hook list describes it as:</p>
              {hook.description && <p className="break-words">{hook.description}</p>}
              {facts.length > 0 && (
                <ul className="space-y-1">
                  {facts.map((f) => (
                    <li key={f.text} className={`flex gap-1.5 ${f.tone === "warn" ? "text-[#ffc861]" : "opacity-80"}`}>
                      <span aria-hidden>{f.tone === "warn" ? "!" : "·"}</span>
                      <span>{f.text}</span>
                    </li>
                  ))}
                </ul>
              )}
              {hookFlagWords(hook.flags).length > 0 && (
                <p className="opacity-80">It runs {hookFlagWords(hook.flags).join(", ")}.</p>
              )}
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
                {hook.auditUrl && (
                  <a href={hook.auditUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">
                    Audit <ExternalLink className="size-3" />
                  </a>
                )}
                <a href={HOOKLIST_SOURCE_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">
                  Source: Uniswap hook list <ExternalLink className="size-3" />
                </a>
              </div>
              <p className="text-[12px] opacity-60">Each hook&apos;s own team writes its entry. Being listed does not make a hook safe.</p>
            </>
          ) : lookup?.looked ? (
            <p className="opacity-80">This hook is not in Uniswap&apos;s hook list, so there is no public description of what it does. That is not evidence either way.</p>
          ) : (
            <p className="opacity-80">We could not read Uniswap&apos;s hook list just now, so we cannot say whether this hook is described there.</p>
          )}
        </div>
      )}
    </div>
  );
}
