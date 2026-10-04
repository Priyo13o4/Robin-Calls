import { ActionForm } from "@/app/admin/components/ActionForm";
import { AdminHeading } from "../../components/AdminShell";
import { Badge, EmptyState, InfoPanel } from "../../components/ui";
import { ConfirmButton } from "../../components/ConfirmButton";
import { readRpcEndpointsRedacted } from "@/lib/data/rpc-endpoints";
import { parseEndpointConfig } from "@/lib/rpc/provider-pool";
import {
  deleteRpcEndpointAction,
  saveRpcEndpointAction,
  seedRpcEndpointsAction,
  toggleRpcEndpointAction,
} from "./actions";

export const dynamic = "force-dynamic";

const input =
  "w-full border border-[#2a2a2a] bg-[#0a0a0a] px-3 py-2 font-mono text-xs text-[#ededea] placeholder-[#3d3d3d] outline-none focus:border-[#ccff00]";
const label = "font-mono text-[10px] tracking-[0.16em] text-[#8a8a8a]";

function envSeedIds(): string[] {
  try {
    return parseEndpointConfig(process.env).map((e) => e.id);
  } catch {
    return [];
  }
}

export default async function RpcPage() {
  const rows = await readRpcEndpointsRedacted();
  const seedIds = envSeedIds();
  const enabled = rows.filter((r) => r.enabled);
  const swapOn = enabled.filter((r) => r.pool === "swap");

  return (
    <>
      <AdminHeading
        title="Infrastructure · RPC Pool"
        sub="The ordered provider pool. Disabling an endpoint takes it out of routing within a minute — no deploy, no container restart."
      />

      <InfoPanel title="WHAT DISABLING ACTUALLY DOES">
        <p>
          The circuit breaker already sidelines a <em>sick</em> provider for 60s at a time. It has
          no idea what a billing cycle is, so an endpoint that is out of monthly quota gets
          re-probed every minute for the rest of the month. This switch is the tier the breaker
          cannot have.
        </p>
        <p>
          <span className="text-[#ededea]">Order matters.</span> Ties in routing break on{" "}
          <code>sort order</code> (low first). A method listed in <code>preferMethods</code> jumps
          the queue for that endpoint; <code>maxLogSpan</code> is a hard constraint and routes wide{" "}
          <code>eth_getLogs</code> reads away from providers that would refuse them.
        </p>
        <p>
          <span className="text-[#ededea]">Swap-only keys.</span> A row set to the swap pool serves
          swap quotes first and is never used by scans, so neither can spend the other&apos;s
          monthly budget. When every swap key is off or over its per-second budget, quotes use the
          shared pool. {swapOn.length > 0 ? `${swapOn.length} swap key${swapOn.length === 1 ? "" : "s"} on.` : "No swap key is on, so quotes use the shared pool."}
        </p>
        <p className="text-[#4a4a4a]">
          An empty table is not an empty pool — with no rows here the scanner falls back to the{" "}
          <code>RPC_ENDPOINTS_JSON</code> seed. That is also why the last enabled endpoint cannot
          be switched off: the fallback would turn it straight back on.
        </p>
      </InfoPanel>

      {rows.length === 0 ? (
        <div className="mb-8 border border-[#2a2a2a] bg-[#141414] p-4">
          <p className="mb-3 font-mono text-xs text-[#8a8a8a]">
            Nothing configured yet — the pool is running from{" "}
            <code className="text-[#ededea]">RPC_ENDPOINTS_JSON</code>
            {seedIds.length > 0 ? ` (${seedIds.join(", ")})` : ""}. Import it once, then the env
            var can be removed from <code>.env.production</code>.
          </p>
          <ActionForm action={seedRpcEndpointsAction}>
            <button
              type="submit"
              className="border border-[#ccff00] px-4 py-2 font-mono text-[11px] tracking-[0.14em] text-[#ccff00] transition-colors hover:bg-[#ccff00] hover:text-[#0a0a0a]"
              disabled={seedIds.length === 0}
            >
              IMPORT {seedIds.length} ENDPOINT{seedIds.length === 1 ? "" : "S"} FROM ENV
            </button>
          </ActionForm>
        </div>
      ) : (
        <p className="mb-6 font-mono text-[11px] text-[#8a8a8a]">
          {enabled.length} of {rows.length} enabled · this table is authoritative, the env seed is
          only a fallback.
        </p>
      )}

      <div className="mb-10 flex flex-col gap-4">
        {rows.length === 0 && <EmptyState>No endpoints stored.</EmptyState>}
        {rows.map((r) => (
          <div
            key={r.id}
            className={`border p-4 ${r.enabled ? "border-[#2a2a2a] bg-[#141414]" : "border-[#3a2a2a] bg-[#120f0f]"}`}
          >
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <span className="font-mono text-sm text-[#ededea]">{r.id}</span>
              <Badge tone={r.enabled ? "success" : "danger"}>{r.enabled ? "ENABLED" : "DISABLED"}</Badge>
              {r.pool === "swap" && <Badge tone="accent">SWAP ONLY</Badge>}
              <span className="font-mono text-[11px] text-[#8a8a8a]">{r.urlHost}</span>
              {/* Two Alchemy keys share a hostname. Without this the operator
                  cannot tell the exhausted row from the healthy one. */}
              <span
                className="font-mono text-[10px] text-[#5a5a5a]"
                title="One-way fingerprint of the full URL — same URL, same fingerprint. The key is not recoverable from it."
              >
                #{r.urlFingerprint}
              </span>
              <span className="font-mono text-[10px] text-[#4a4a4a]">order {r.sortOrder}</span>
              {!r.enabled && r.disabledAt && (
                <span className="font-mono text-[10px] text-[#8a5a5a]">
                  off since {r.disabledAt.slice(0, 16).replace("T", " ")}
                </span>
              )}
            </div>

            {r.note && <p className="mb-3 font-mono text-[11px] text-[#8a8a8a]">{r.note}</p>}

            <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 font-mono text-[10px] text-[#6a6a6a]">
              <span>maxLogSpan {r.maxLogSpan ?? "∞"}</span>
              <span>cu/s {r.maxCuPerSecond ?? "—"}</span>
              <span>req/s {r.maxRequestsPerSecond ?? "—"}</span>
              <span>concurrent {r.maxConcurrentRequests ?? "—"}</span>
              {r.preferMethods.length > 0 && <span>prefers {r.preferMethods.join(", ")}</span>}
              {r.denyMethods.length > 0 && <span>denies {r.denyMethods.join(", ")}</span>}
              {r.allowMethods.length > 0 && <span>only {r.allowMethods.join(", ")}</span>}
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <ActionForm action={toggleRpcEndpointAction} className="flex items-end gap-2">
                <input type="hidden" name="id" value={r.id} />
                <input type="hidden" name="enable" value={String(!r.enabled)} />
                {r.enabled && (
                  <input
                    name="note"
                    placeholder="why (e.g. monthly quota, resets Sep 1)"
                    className={`${input} w-72`}
                  />
                )}
                <button
                  type="submit"
                  className={`border px-3 py-2 font-mono text-[11px] tracking-[0.14em] transition-colors ${
                    r.enabled
                      ? "border-[#6a3a3a] text-[#d08a8a] hover:bg-[#6a3a3a] hover:text-[#ededea]"
                      : "border-[#ccff00] text-[#ccff00] hover:bg-[#ccff00] hover:text-[#0a0a0a]"
                  }`}
                >
                  {r.enabled ? "DISABLE" : "ENABLE"}
                </button>
              </ActionForm>

              <ActionForm action={deleteRpcEndpointAction}>
                <input type="hidden" name="id" value={r.id} />
                <ConfirmButton
                  confirmText={`Delete endpoint ${r.id}? Its URL (and key) is removed from the database.`}
                  className="border border-[#3a3a3a] px-3 py-2 font-mono text-[11px] tracking-[0.14em] text-[#6a6a6a] transition-colors hover:border-[#6a3a3a] hover:text-[#d08a8a]"
                >
                  DELETE
                </ConfirmButton>
              </ActionForm>
            </div>

            <details className="mt-4">
              <summary className="cursor-pointer font-mono text-[10px] tracking-[0.16em] text-[#6a6a6a] hover:text-[#ccff00]">
                EDIT
              </summary>
              <EndpointForm row={r} />
            </details>
          </div>
        ))}
      </div>

      <h2 className="mb-3 font-mono text-[11px] tracking-[0.2em] text-[#8a8a8a]">ADD ENDPOINT</h2>
      <EndpointForm row={null} />
    </>
  );
}

function EndpointForm({
  row,
}: {
  row: Awaited<ReturnType<typeof readRpcEndpointsRedacted>>[number] | null;
}) {
  return (
    <ActionForm
      action={saveRpcEndpointAction}
      className="mt-3 grid grid-cols-1 gap-3 border border-[#2a2a2a] bg-[#0f0f0f] p-4 sm:grid-cols-2"
    >
      <div className="flex flex-col gap-1">
        <span className={label}>ID</span>
        <input
          name="id"
          required
          defaultValue={row?.id ?? ""}
          readOnly={!!row}
          pattern="[a-z0-9][a-z0-9-]{1,40}"
          placeholder="alchemy-secondary"
          className={input}
        />
      </div>
      <div className="flex flex-col gap-1">
        <span className={label}>
          URL {row && <span className="text-[#4a4a4a]">— blank keeps the stored secret</span>}
        </span>
        {/* The stored URL is never rendered: it carries the Alchemy key. */}
        <input
          name="url"
          required={!row}
          type="password"
          autoComplete="off"
          placeholder={row ? "unchanged" : "https://…"}
          className={input}
        />
      </div>
      {[
        ["sortOrder", "SORT ORDER", row?.sortOrder ?? 100],
        ["maxLogSpan", "MAX LOG SPAN", row?.maxLogSpan ?? ""],
        ["maxCuPerSecond", "MAX CU/S", row?.maxCuPerSecond ?? ""],
        ["maxRequestsPerSecond", "MAX REQ/S", row?.maxRequestsPerSecond ?? ""],
        ["maxConcurrentRequests", "MAX CONCURRENT", row?.maxConcurrentRequests ?? ""],
      ].map(([name, text, value]) => (
        <div key={String(name)} className="flex flex-col gap-1">
          <span className={label}>{text}</span>
          <input name={String(name)} defaultValue={String(value)} inputMode="numeric" className={input} />
        </div>
      ))}
      {[
        ["preferMethods", "PREFER METHODS", row?.preferMethods ?? []],
        ["denyMethods", "DENY METHODS", row?.denyMethods ?? []],
        ["allowMethods", "ALLOW METHODS (empty = all)", row?.allowMethods ?? []],
      ].map(([name, text, value]) => (
        <div key={String(name)} className="flex flex-col gap-1">
          <span className={label}>{text}</span>
          <input
            name={String(name)}
            defaultValue={(value as string[]).join(", ")}
            placeholder="eth_getLogs, eth_call"
            className={input}
          />
        </div>
      ))}
      <div className="flex flex-col gap-1 sm:col-span-2">
        <span className={label}>NOTE</span>
        <input name="note" defaultValue={row?.note ?? ""} className={input} />
      </div>
      <div className="flex flex-col gap-1">
        <span className={label}>POOL</span>
        <select name="pool" defaultValue={row?.pool ?? "shared"} className={input}>
          <option value="shared">shared (scans and swaps)</option>
          <option value="swap">swap only</option>
        </select>
      </div>
      <label className="flex items-center gap-2 font-mono text-[11px] text-[#8a8a8a]">
        <input type="checkbox" name="enabled" defaultChecked={row ? row.enabled : true} />
        ENABLED
      </label>
      <div className="sm:col-span-2">
        <button
          type="submit"
          className="border border-[#ccff00] px-4 py-2 font-mono text-[11px] tracking-[0.14em] text-[#ccff00] transition-colors hover:bg-[#ccff00] hover:text-[#0a0a0a]"
        >
          {row ? "SAVE" : "ADD ENDPOINT"}
        </button>
      </div>
    </ActionForm>
  );
}
