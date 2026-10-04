import { AdminHeading } from "../../components/AdminShell";
import { Badge, EmptyState, InfoPanel, SectionLabel } from "../../components/ui";
import { ConfirmButton } from "../../components/ConfirmButton";
import { readAllTrustedAddresses } from "@/lib/data/admin-trust";
import { primeTrustedAddresses, rwaProbeTransientCount } from "@/lib/config/trusted-addresses";
import { TrustedAddressForm } from "./TrustedAddressForm";
import { refreshTrustedAddressesAction, toggleTrustedAddressAction } from "./actions";
import { ActionForm } from "@/app/admin/components/ActionForm";

export const dynamic = "force-dynamic";
type Row = { address: string; category: string; subtype: string | null; label: string; dex_id: string | null; enabled: boolean; verify_status: string; verified_at: string | null; created_by: string | null };
const explorer = (address: string) => `${process.env.EXPLORER_WEB_URL ?? "https://robinhoodchain.blockscout.com"}/address/${address}`;

export default async function TrustedAddressPage() {
  // Await the prime before reading the counter: it is per-process, so an
  // unprimed read returns 0 meaning "never probed", not "all probes passed"
  // (§8 #9). The prime is memoized + single-flight, so this is not a refill.
  await primeTrustedAddresses();
  const rows = await readAllTrustedAddresses(4663);
  const degraded = rwaProbeTransientCount();
  return <>
    <div className="flex flex-wrap items-start justify-between gap-4"><AdminHeading title="Scanner · Trusted Address Registry" sub="The single typed trust source for DEX plumbing, custody infrastructure, lockers, and authenticated Robinhood RWAs. Cache TTL: 10 minutes." /><ActionForm action={refreshTrustedAddressesAction}><button className="border border-[#2a2a2a] px-3 py-2 text-[10px] tracking-[0.14em] text-[#8a8a8a] hover:border-[#ccff00] hover:text-[#ccff00]">FORCE REFRESH</button></ActionForm></div>
    <InfoPanel title="AUTHENTICITY, NOT A RISK-FREE LABEL"><p>Trusted RWA means the address is canonical and currently proves the registered Robinhood beacon and Stock implementation. It does not remove issuer pause/block controls or thin-liquidity risk.</p></InfoPanel>
    {degraded > 0 && <InfoPanel title="RWA AUTHENTICITY PROBES DEGRADED"><p>{degraded} RWA {degraded === 1 ? "row" : "rows"} kept stored trust on the last registry refill because the live beacon probe faulted. Those badges assert a canonical match that was not re-confirmed this cycle. Use FORCE REFRESH once RPC is healthy.</p></InfoPanel>}
    <TrustedAddressForm />
    <SectionLabel count={rows.length}>REGISTERED ADDRESSES</SectionLabel>
    {rows.length === 0 ? <EmptyState>No trusted addresses are available.</EmptyState> : <div className="space-y-2">{rows.map((row) => <div key={row.address} className={`border border-[#2a2a2a] bg-[#141414] p-3 ${row.enabled ? "" : "opacity-50"}`}><div className="flex flex-wrap items-center gap-2"><Badge tone={row.verify_status === "ok" ? "accent" : "neutral"}>{row.category.toUpperCase()}</Badge><span className="text-sm text-[#ededea]">{row.label}</span>{row.subtype && <span className="font-mono text-[10px] text-[#8a8a8a]">{row.subtype}</span>}{row.dex_id && <span className="font-mono text-[10px] text-[#8a8a8a]">{row.dex_id}</span>}<span className="font-mono text-[10px] text-[#8a8a8a]">{row.verify_status.toUpperCase()}</span><a href={explorer(row.address)} target="_blank" rel="noopener noreferrer" className="font-mono text-[11px] text-[#8a8a8a] hover:text-[#ccff00]">{row.address}</a><ActionForm action={toggleTrustedAddressAction} className="ml-auto"><input type="hidden" name="address" value={row.address}/><input type="hidden" name="enabled" value={String(!row.enabled)}/><ConfirmButton confirmText={`${row.enabled ? "Disable" : "Enable"} ${row.label}?`} className="border border-[#2a2a2a] px-2 py-1 text-[10px] text-[#8a8a8a] hover:border-[#ccff00] hover:text-[#ccff00]">{row.enabled ? "DISABLE" : "ENABLE"}</ConfirmButton></ActionForm></div></div>)}</div>}
  </>;
}
