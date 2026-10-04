"use client";

import { useState } from "react";
import { Toast, ToastAction, type ToastPosition, type ToastSkin, type ToastVariant } from "@/components/ui/toast";
import { Toaster } from "@/components/ui/toaster";
import { toast, dismissAllToasts } from "@/components/ui/use-toast";

const VARIANTS: ToastVariant[] = ["default", "success", "warning", "destructive", "info", "loading"];
const SKINS: ToastSkin[] = ["solid", "card", "pill"];
const POSITIONS: ToastPosition[] = [
  "top-left", "top-center", "top-right",
  "bottom-left", "bottom-center", "bottom-right",
];

/** Copy that reads like the real thing, so the samples are judged at the right length. */
const SAMPLE: Record<ToastVariant, { title: string; description: string }> = {
  default: { title: "Noted", description: "Sale address saved to site config." },
  success: { title: "Confirmed", description: "Fee address 1 updated. Frozen once the sale opens." },
  warning: { title: "Partial read", description: "Some sale details could not be read just now. Anything showing as — is unknown, not zero." },
  destructive: { title: "Rejected", description: "Wallet is on chain 4663, this panel targets Robinhood Chain Testnet." },
  info: { title: "Heads up", description: "Contributions are not open in the sale's current state." },
  loading: { title: "Working", description: "Waiting for the transaction to confirm." },
};

export function ToastLab() {
  const [skin, setSkin] = useState<ToastSkin>("solid");
  const [position, setPosition] = useState<ToastPosition>("bottom-right");

  return (
    <main className="min-h-screen bg-[#0A0A0A] px-6 py-12 text-[#EDEDEA]">
      <div className="mx-auto max-w-5xl">
        <h1 className="font-mono text-[11px] uppercase tracking-[0.24em] text-[#8A8A8A]">Toast lab</h1>
        <p className="mt-2 max-w-2xl text-2xl font-bold leading-tight">
          Three skins, six variants, six positions.
        </p>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#8A8A8A]">
          Static previews below show every combination at once. The buttons fire real toasts into
          the live viewport, so you can judge stacking, the progress bar, and hover-to-pause.
          Nothing here is linked from the site.
        </p>

        {/* ── controls ── */}
        <section className="mt-10 flex flex-wrap items-end gap-6">
          <Control label="Live skin">
            {SKINS.map((s) => (
              <Chip key={s} on={skin === s} onClick={() => setSkin(s)}>{s}</Chip>
            ))}
          </Control>
          <Control label="Live position">
            {POSITIONS.map((p) => (
              <Chip key={p} on={position === p} onClick={() => setPosition(p)}>{p}</Chip>
            ))}
          </Control>
        </section>

        <section className="mt-6 flex flex-wrap gap-2">
          {VARIANTS.map((v) => (
            <button
              key={v}
              onClick={() =>
                toast({
                  variant: v,
                  skin,
                  title: SAMPLE[v].title,
                  description: SAMPLE[v].description,
                  duration: v === "loading" || v === "destructive" ? null : 5000,
                  action: v === "warning" ? <ToastAction onClick={() => {}}>Retry</ToastAction> : undefined,
                })
              }
              className="brutalist-box brutalist-shadow-dark brutalist-pressable halftone-dark border-[#2A2A2A] bg-[#141414] px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-[#EDEDEA] hover:border-[#CCFF00]"
            >
              fire {v}
            </button>
          ))}
          <button
            onClick={() => VARIANTS.forEach((v, i) => setTimeout(() => toast({ variant: v, skin, ...SAMPLE[v] }), i * 220))}
            className="brutalist-box brutalist-shadow-dark brutalist-pressable halftone-light border-[#CCFF00] bg-[#CCFF00] px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-[#0A0A0A]"
          >
            fire all
          </button>
          <button
            onClick={() => dismissAllToasts()}
            className="brutalist-box brutalist-shadow-dark brutalist-pressable halftone-light border-[#EDEDEA] bg-[#EDEDEA] px-4 py-2.5 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-[#0A0A0A]"
          >
            clear
          </button>
        </section>

        {/* ── static grid: every skin x every variant ── */}
        {SKINS.map((s) => (
          <section key={s} className="mt-14">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.24em] text-[#CCFF00]">skin: {s}</h2>
            <p className="mt-1 text-xs text-[#8A8A8A]">{SKIN_NOTE[s]}</p>
            <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {VARIANTS.map((v) => (
                <div key={v} className="min-w-0">
                  <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#5A5A5A]">{v}</p>
                  <Toast
                    variant={v}
                    skin={s}
                    title={SAMPLE[v].title}
                    description={SAMPLE[v].description}
                    duration={null}
                    showProgress={false}
                    closable
                    action={v === "warning" ? <ToastAction>Retry</ToastAction> : undefined}
                  />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <Toaster position={position} skin={skin} />
    </main>
  );
}

const SKIN_NOTE: Record<ToastSkin, string> = {
  solid: "The hero CTA treatment: solid fill, hard border, offset shadow, light halftone dots.",
  card: "The feature-card treatment: dark panel, coloured border carries the meaning, dark dots.",
  pill: "Quiet rounded pill, closest to the existing sale-page chrome. No dots.",
};

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#5A5A5A]">{label}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`border-2 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] transition-colors ${
        on ? "border-[#CCFF00] bg-[#CCFF00] text-[#0A0A0A]" : "border-[#2A2A2A] text-[#8A8A8A] hover:border-[#5A5A5A]"
      }`}
    >
      {children}
    </button>
  );
}
