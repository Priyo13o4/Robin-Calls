"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const SUGGESTIONS = [
  "Analyze this token contract",
  "Trace this wallet's history",
  "Is this a known rugger?",
  "Compare these two projects",
];

/**
 * Landing teaser for /robin-knight. Every entry point here hands off to the
 * real page with `?q=`, which seeds the composer and auto-sends only when
 * the session is not `blocked` (no BYOK key connected) — same rule
 * `openRobinKnight`'s `send` flag enforces on the docked panel. A page
 * element must never spend the user's own key on their behalf.
 */
export function RobinKnightTeaser() {
  const router = useRouter();
  const [question, setQuestion] = useState("");

  const ask = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    router.push(`/robin-knight?q=${encodeURIComponent(trimmed)}`);
  };

  return (
    <div className="border border-[#2a2a2a] bg-[#141414]/95 p-4 backdrop-blur-sm sm:p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center border border-[#2a2a2a] bg-[#0a0a0a]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-sm.webp" alt="" className="h-5 w-5 object-contain" />
        </span>
        <div className="min-w-0">
          <p className="font-inter text-[14px] font-semibold text-[#ededea]">
            How can I help you today?
          </p>
          <p className="mt-1 font-inter text-[12.5px] leading-relaxed text-[#8a8a8a]">
            I can analyze contracts, trace wallets, compare projects, and uncover on-chain
            connections. Ask me anything.
          </p>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => ask(s)}
            className="flex items-center justify-between gap-2 border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2.5 text-left font-inter text-[12.5px] text-[#c7c7c2] transition-colors hover:border-[#ccff00] hover:text-[#ededea]"
          >
            <span className="truncate">{s}</span>
            <span aria-hidden className="shrink-0 text-[#3d3d3d]">
              →
            </span>
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
        className="flex gap-2"
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask anything..."
          aria-label="Ask Robin Knight"
          className="min-w-0 flex-1 border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2.5 font-inter text-[13px] text-[#ededea] placeholder-[#5a5a5a] outline-none focus:border-[#ccff00]"
        />
        <button
          type="submit"
          aria-label="Send question to Robin Knight"
          className="shrink-0 border border-[#2a2a2a] bg-[#1c1c1c] px-4 font-mono text-[13px] text-[#ededea] transition-colors hover:border-[#ccff00] hover:text-[#ccff00]"
        >
          →
        </button>
      </form>
    </div>
  );
}
