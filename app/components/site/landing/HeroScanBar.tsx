"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LandingIcon } from "./icons";

const TRUST = [
  { icon: "shield", label: "No wallet required" },
  { icon: "document", label: "Deterministic scoring" },
  { icon: "blocks", label: "On-chain record" },
] as const;

/**
 * The landing hero's scan entry. Deliberately thin — it only validates and
 * redirects. `/scan/[address]` (ScanForm's `initialAddress` prop) is what
 * actually runs the pipeline, so a paste-and-go here lands on a page that is
 * already mid-scan rather than a second, parallel scan implementation.
 */
export function HeroScanBar() {
  const router = useRouter();
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = address.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
      setError("That is not a contract address. 0x followed by 40 hex characters.");
      return;
    }
    setError(null);
    router.push(`/scan/${trimmed}`);
  };

  return (
    <form onSubmit={submit} className="w-full max-w-[620px]">
      {/* One box holding the field and the action, not a field beside a
          button. `focus-within` moves the ring to the container so the seam
          between the two halves never lights up on its own. */}
      <div className="brutalist-box brutalist-shadow-dark flex items-center border-2 border-[#2a2a2a] bg-[#141414] p-1.5 focus-within:border-[#ccff00]">
        <span className="pl-2 pr-1.5 text-[#8a8a8a] sm:pl-3 sm:pr-2">
          <LandingIcon name="search" size={17} />
        </span>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Paste a token address"
          spellCheck={false}
          aria-label="Contract address"
          className="min-w-0 flex-1 bg-transparent py-3 font-inter text-[13px] sm:text-[14px] text-[#ededea] placeholder-[#5a5a5a] outline-none"
        />
        <button
          type="submit"
          className="brutalist-pressable halftone-light shrink-0 border-2 border-[#ccff00] bg-[#ccff00] px-3.5 py-3 font-mono text-[12px] font-bold uppercase tracking-[0.12em] sm:px-6 sm:tracking-[0.18em] text-[#0a0a0a]"
        >
          Scan →
        </button>
      </div>

      {error && <p className="mt-2.5 font-inter text-[12px] text-[#c7c7c2]">{error}</p>}

      <ul className="mt-4 flex flex-wrap gap-x-6 gap-y-2.5 sm:mt-5">
        {TRUST.map((t) => (
          <li
            key={t.label}
            className="flex items-center gap-2 font-inter text-[12px] text-[#8a8a8a]"
          >
            <span className="text-[#8a8a8a]">
              <LandingIcon name={t.icon} size={15} />
            </span>
            {t.label}
          </li>
        ))}
      </ul>
    </form>
  );
}
