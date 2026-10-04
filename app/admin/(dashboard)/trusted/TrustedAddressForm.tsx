"use client";

import { useActionState, useState } from "react";
import { saveTrustedAddressAction } from "./actions";

const categories = ["rwa-token", "trusted-proxy", "dex-factory", "dex-router", "dex-quoter", "dex-position-manager", "dex-pool-manager", "dex-state-view", "permit2", "lp-locker", "burn-address", "infra-asset", "rwa-beacon", "rwa-impl", "rwa-factory", "rwa-vault", "rwa-operator", "bridge-system-owner"];
const input = "w-full border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2 font-mono text-xs text-[#ededea] placeholder-[#3d3d3d] outline-none focus:border-[#ccff00]";

export function TrustedAddressForm() {
  const [category, setCategory] = useState("rwa-token");
  const [state, action, pending] = useActionState(saveTrustedAddressAction, {});
  const rwa = category === "rwa-token";
  return <form action={action} className="mb-8 space-y-3 border border-[#2a2a2a] bg-[#141414] p-4">
    <div className="grid gap-3 sm:grid-cols-2">
      <select name="category" value={category} onChange={(e) => setCategory(e.target.value)} className={input}>
        {categories.map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
      </select>
      <input name="address" required pattern="0x[0-9a-fA-F]{40}" placeholder="0x… address" className={input} />
      <input name="label" required minLength={2} placeholder={rwa ? "Official asset name" : "Human-readable label"} className={input} />
      {rwa ? <input name="symbol" required placeholder="Ticker, e.g. MSFT" className={input} /> : <input name="subtype" placeholder="Subtype (e.g. permanent / timelock)" className={input} />}
    </div>
    {rwa ? <select name="asset_category" className={input}><option value="stock-token">STOCK</option><option value="etf">ETF</option></select> : <>
      <input name="dex_id" placeholder="DEX ID (uniswap, sushiswap, pancakeswap)" className={input} />
      <input name="metadata" placeholder='Optional metadata JSON, e.g. {"protocol":"v3"}' className={input} />
      <label className="flex items-center gap-2 font-mono text-[11px] text-[#8a8a8a]"><input name="override" type="checkbox" /> Override an advisory or failed probe after independent review</label>
    </>}
    <p className="text-xs text-[#8a8a8a]">{rwa ? "RWA saves are hard-gated by the canonical beacon and implementation. The saved evidence below is produced by that live probe." : "Every address receives a live plausibility probe. An override is intentionally explicit; it is never automatic."}</p>
    {state.message && <div className={state.ok ? "text-xs text-[#ccff00]" : "text-xs text-[#e0897a]"}>{state.message}{state.evidence ? ` Evidence: ${JSON.stringify(state.evidence)}` : ""}</div>}
    <button disabled={pending} className="border border-[#2a2a2a] px-4 py-2 text-[11px] tracking-[0.14em] text-[#ededea] hover:border-[#ccff00] hover:text-[#ccff00] disabled:opacity-50">{pending ? "VERIFYING…" : rwa ? "VERIFY & SAVE RWA" : "PROBE & SAVE"}</button>
  </form>;
}
