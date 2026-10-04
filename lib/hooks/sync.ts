import { ROBINHOOD_CHAIN_ID } from "@/lib/config/chain";
import { countUniswapHooks, replaceUniswapHooks } from "@/lib/data/uniswap-hooks";
import type { uniswapHooks } from "@/lib/db/schema";
import { HOOKLIST_URL } from "./types";

const MAX_BYTES = 40 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;
/** A list that lost more than half our chain's entries is a bad download or a repo change, not news. */
const MIN_KEEP_RATIO = 0.5;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

type HookRow = typeof uniswapHooks.$inferInsert;

/** Rows for one chain from the raw list. Malformed entries are dropped, never half-written. */
export function parseHooklist(raw: unknown, chainId: number, fetchedAt: string): HookRow[] {
  if (!Array.isArray(raw)) throw new Error("hooklist_not_an_array");
  const rows = new Map<string, HookRow>();
  for (const entry of raw) {
    const hook = (entry as { hook?: Record<string, unknown> })?.hook;
    if (!hook || hook.chainId !== chainId || typeof hook.address !== "string" || !ADDRESS.test(hook.address)) continue;
    const bools = (o: unknown) => Object.fromEntries(Object.entries((o ?? {}) as Record<string, unknown>).filter(([, v]) => typeof v === "boolean" || typeof v === "string"));
    rows.set(hook.address.toLowerCase(), {
      chainId,
      address: hook.address.toLowerCase(),
      name: text(hook.name, 120) || "Unnamed hook",
      description: text(hook.description, 4000),
      deployer: text(hook.deployer, 64),
      verifiedSource: typeof hook.verifiedSource === "boolean" ? hook.verifiedSource : null,
      auditUrl: /^https:\/\//.test(text(hook.auditUrl, 500)) ? text(hook.auditUrl, 500) : "",
      flags: bools((entry as { flags?: unknown }).flags),
      properties: bools((entry as { properties?: unknown }).properties),
      fetchedAt,
    });
  }
  return [...rows.values()];
}

export async function syncUniswapHooklist(deps = { fetch: globalThis.fetch, now: () => new Date() }) {
  const res = await deps.fetch(HOOKLIST_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: "no-store" });
  if (!res.ok || !res.body) throw new Error(`hooklist_http_${res.status}`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) throw new Error("hooklist_too_large");
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel(); throw new Error("hooklist_too_large"); }
    chunks.push(value);
  }
  const rows = parseHooklist(JSON.parse(Buffer.concat(chunks).toString("utf8")), ROBINHOOD_CHAIN_ID, deps.now().toISOString());
  const before = (await countUniswapHooks(ROBINHOOD_CHAIN_ID)) ?? 0;
  if (rows.length === 0 || rows.length < before * MIN_KEEP_RATIO) {
    throw new Error(`hooklist_shrank:${before}->${rows.length}`);
  }
  const result = await replaceUniswapHooks(ROBINHOOD_CHAIN_ID, rows);
  return { ok: true as const, bytes: size, before, ...result };
}
