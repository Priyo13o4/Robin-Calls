"use client";

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TOKEN_ADDRESS, isOwnToken } from "@/lib/sale/token";
import { VerdictView, type LedgerStamp } from "./VerdictView";
import { announceScan } from "@/lib/trade/scan-signal";
import type { TokenRecord, Verdict } from "@/lib/types";
import type { ScanMeta } from "@/lib/scan-control/serve";
import type { TopTrader } from "@/lib/market/top-traders";

/** Mirrors lib/observability/context.ts's ScanProgressEvent (kept local — that
 * module pulls in Node-only "crypto"/"async_hooks" and must never reach the
 * client bundle). */
type ScanEvent =
  | { type: "phase"; step: "ingest" | "honeypot" | "checks" | "receipt" }
  | { type: "retry"; source: "explorer" | "rpc"; detail: string }
  | {
      type: "done";
      body: {
        verdict: Verdict;
        ledger: LedgerStamp | null;
        record: TokenRecord | null;
        scanMeta: ScanMeta;
        traders: TopTrader[] | null;
      };
    }
  | { type: "error"; code: string; message: string; httpStatus: number };

type ScanState =
  | { phase: "idle" }
  | { phase: "scanning"; stepIndex: number; detail: string | null }
  | { phase: "error"; message: string }
  | {
      phase: "done";
      verdict: Verdict;
      ledger: LedgerStamp | null;
      record: TokenRecord | null;
      scanMeta: ScanMeta | null;
      traders: TopTrader[] | null;
    };

/** Order matches ScanEvent["phase"]["step"] — index into this IS the step id's position. */
const STEP_IDS = ["ingest", "honeypot", "checks", "receipt"] as const;
const PIPELINE_STEPS = [
  "READING THE CHAIN",
  "SIMULATING THE EXIT",
  "WEIGHING THE EVIDENCE",
  "WRITING THE RECEIPT",
];

/**
 * Applies one NDJSON line to scan state. Returns true for the two terminal
 * event types ("done"/"error") so the caller knows the stream reached a real
 * outcome — a stream that closes without either means the connection dropped
 * mid-scan, which the caller treats as a failure rather than silently idling.
 */
function applyScanEvent(
  evt: ScanEvent,
  addr: string,
  setState: Dispatch<SetStateAction<ScanState>>
): boolean {
  switch (evt.type) {
    case "phase": {
      const stepIndex = STEP_IDS.indexOf(evt.step);
      setState({ phase: "scanning", stepIndex, detail: null });
      return false;
    }
    case "retry":
      setState((prev) => (prev.phase === "scanning" ? { ...prev, detail: evt.detail } : prev));
      return false;
    case "done":
      setState({
        phase: "done",
        verdict: evt.body.verdict,
        ledger: evt.body.ledger,
        record: evt.body.record ?? null,
        scanMeta: evt.body.scanMeta ?? null,
        traders: evt.body.traders ?? null,
      });
      window.history.replaceState(null, "", `/scan/${addr}`);
      return true;
    case "error":
      setState({ phase: "error", message: evt.message });
      return true;
  }
}

/**
 * /scan interactive core. STATE A (empty): the lime "RUN THE VERDICT"
 * button is the page's single lime element. Once a result renders,
 * VerdictView owns the lime budget instead.
 */
export function ScanForm({ initialAddress }: { initialAddress?: string }) {
  const [address, setAddress] = useState(initialAddress ?? "");
  const [state, setState] = useState<ScanState>({ phase: "idle" });
  const router = useRouter();
  const doneAddress = state.phase === "done" ? state.verdict.tokenAddress : null;
  useEffect(() => { if (doneAddress) announceScan(doneAddress); }, [doneAddress]);

  const run = useCallback(async (addr: string) => {
    const trimmed = addr.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
      setState({ phase: "error", message: "That is not a contract address. 0x + 40 hex characters." });
      return;
    }
    // Our own token is never shown with a score; its page runs the scan itself.
    if (isOwnToken(trimmed)) {
      router.push(`/scan/${TOKEN_ADDRESS}`);
      return;
    }
    setState({ phase: "scanning", stepIndex: 0, detail: null });
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: trimmed }),
      });

      // The fresh-pipeline path streams NDJSON progress events; every other
      // branch (cache hit, capacity, validation, lock-join) still answers
      // with one plain JSON body and a real HTTP status, exactly as before.
      if (res.body && (res.headers.get("content-type") ?? "").includes("application/x-ndjson")) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let settled = false;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line) continue;
            settled ||= applyScanEvent(JSON.parse(line) as ScanEvent, trimmed, setState);
          }
        }
        if (!settled) {
          setState({ phase: "error", message: "Scan failed. The chain did not answer. Try again." });
        }
        return;
      }

      const body = await res.json();
      if (!res.ok) {
        setState({ phase: "error", message: body.error ?? "Scan failed." });
        return;
      }
      setState({
        phase: "done",
        verdict: body.verdict,
        ledger: body.ledger,
        record: body.record ?? null,
        scanMeta: body.scanMeta ?? null,
        traders: body.traders ?? null,
      });
      window.history.replaceState(null, "", `/scan/${trimmed}`);
    } catch {
      setState({ phase: "error", message: "Scan failed. The chain did not answer. Try again." });
    }
  }, [router]);

  useEffect(() => {
    if (!initialAddress) return;
    const timer = window.setTimeout(() => void run(initialAddress), 0);
    return () => window.clearTimeout(timer);
  }, [initialAddress, run]);

  if (state.phase === "done") {
    return (
      <VerdictView
        verdict={state.verdict}
        ledger={state.ledger}
        record={state.record}
        scanMeta={state.scanMeta}
        traders={state.traders}
      />
    );
  }

  return (
    <section className="mx-auto flex max-w-3xl flex-col items-center px-4 pb-32 mt-[25vh] text-center sm:px-6">
      <form
        className="w-full"
        onSubmit={(e) => {
          e.preventDefault();
          void run(address);
        }}
      >
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="PASTE A CONTRACT ADDRESS"
          spellCheck={false}
          disabled={state.phase === "scanning"}
          className="w-full border border-[#2a2a2a] bg-[#141414] px-5 py-4 font-mono text-sm text-[#ededea] placeholder-[#3d3d3d] outline-none focus:border-[#ccff00]"
        />
        <button
          type="submit"
          disabled={state.phase === "scanning"}
          className="brutalist-box brutalist-pressable brutalist-shadow-dark mt-6 border-[#0a0a0a] bg-[#ccff00] px-10 py-4 font-cinzel text-sm font-bold tracking-[0.2em] text-[#0a0a0a] disabled:opacity-60"
        >
          {state.phase === "scanning" ? PIPELINE_STEPS[state.stepIndex] : "RUN THE VERDICT"}
        </button>
      </form>

      <Link
        href="/ledger"
        className="brutalist-box brutalist-shadow-dark brutalist-pressable halftone-light mt-4 border-[#ededea] bg-[#ededea] px-10 py-3 text-center font-inter text-[11px] font-bold uppercase tracking-[0.18em] text-[#0a0a0a]"
      >
        VIEW THE LEDGER
      </Link>

      {state.phase === "scanning" && (
        <div className="mt-8 font-mono text-xs text-[#8a8a8a]">
          {PIPELINE_STEPS.map((s, i) => {
            const isActive = i === state.stepIndex;
            const isPast = i < state.stepIndex;
            return (
              <div key={s} className={isPast || isActive ? "text-[#ededea]" : "text-[#3d3d3d]"}>
                <span className="inline-flex items-center gap-2">
                  {isActive && (
                    <span
                      aria-hidden
                      className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[#3d3d3d] border-t-[#ccff00]"
                    />
                  )}
                  {String(i + 1).padStart(2, "0")} {s}
                  {isPast && " ✓"}
                </span>
                {isActive && state.detail && (
                  <div className="mt-1 pl-5 text-[10px] normal-case tracking-normal text-[#6a6a6a]">
                    {state.detail}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {state.phase === "error" && (
        <p className="mt-6 text-sm text-[#8a8a8a]">{state.message}</p>
      )}

      {state.phase === "idle" && (
        <p className="mt-6 text-xs tracking-[0.14em] text-[#8a8a8a]">
          Deterministic. Reproducible. On record.
        </p>
      )}
    </section>
  );
}
