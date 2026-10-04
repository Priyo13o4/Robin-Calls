"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Runs the normal scan, then re-renders the server page from the new ledger row.
 * The scan's own result (which carries a score) is drained and never rendered.
 */
export function OwnTokenRescan({ address }: { address: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "scanning" | "error">("idle");

  async function run() {
    setPhase("scanning");
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      });
      await res.text();
      if (!res.ok) throw new Error(`scan ${res.status}`);
      setPhase("idle");
      router.refresh();
    } catch {
      // The stored record stays on screen; only this button reports the failure.
      setPhase("error");
    }
  }

  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={phase === "scanning"}
      className="underline hover:text-[#ededea] disabled:no-underline disabled:opacity-60"
    >
      {phase === "scanning" ? "SCANNING…" : phase === "error" ? "SCAN DID NOT FINISH · TRY AGAIN" : "RUN A FRESH SCAN"}
    </button>
  );
}
