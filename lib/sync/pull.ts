import { signSyncRequest } from "@/lib/security/sync-auth";
import { upsertSyncRows, SYNC_TABLES, MAX_SYNC_PAGE, type SyncTable } from "@/lib/data/sync";
import { readSequencerCheckpoint, writeSequencerCheckpoint } from "@/lib/data/sequencer";

/**
 * Local-smoke side of the prod sync: pages changed rows from prod's /api/sync/v1 into the local DB,
 * so the smoke stack never spends RPC re-deriving what prod already paid for. Never runs on prod:
 * see syncPullConfig. Cursors live in sequencer_checkpoints as `sync:<table>`.
 */

export const IDLE_MS = 15_000;
/** Pages per table per cycle; a table still behind is picked up again after BUSY_MS. */
export const MAX_PAGES_PER_CYCLE = 10;
const BUSY_MS = 1_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const DEFAULT_BOOTSTRAP_H = 48;

export interface SyncPullConfig { baseUrl: string; signingKey: string; bootstrapHours: number }

/** Null unless this is explicitly a puller: flag on, key present, and it does not also serve (prod holds SYNC_PUBLIC_KEY). */
export function syncPullConfig(env: NodeJS.ProcessEnv = process.env): SyncPullConfig | null {
  if (env.PROD_SYNC_PULL !== "true") return null;
  const baseUrl = env.PROD_SYNC_URL?.trim().replace(/\/+$/, "");
  const signingKey = env.PROD_SYNC_SIGNING_KEY?.trim();
  if (!baseUrl || !signingKey || env.SYNC_PUBLIC_KEY?.trim()) return null;
  try {
    const u = new URL(baseUrl);
    if (u.protocol !== "https:") return null;
    const self = env.NEXT_PUBLIC_SITE_URL ? new URL(env.NEXT_PUBLIC_SITE_URL).host : null;
    if (self && u.host === self) return null; // would sync from itself
  } catch {
    return null;
  }
  const h = Number(env.PROD_SYNC_BOOTSTRAP_HOURS ?? DEFAULT_BOOTSTRAP_H);
  return { baseUrl, signingKey, bootstrapHours: Number.isFinite(h) && h > 0 ? h : DEFAULT_BOOTSTRAP_H };
}

export const pullDeps = {
  fetch: (url: string, init: RequestInit) => fetch(url, init),
  cursor: async (table: SyncTable) => ((await readSequencerCheckpoint(`sync:${table}`))?.after as string | undefined) ?? null,
  saveCursor: (table: SyncTable, after: string) => writeSequencerCheckpoint(`sync:${table}`, { after, at: new Date().toISOString() }),
  upsert: upsertSyncRows,
};

const encode = (c: { ts: string; key: string }) => Buffer.from(JSON.stringify(c)).toString("base64url");

/** One table, up to MAX_PAGES_PER_CYCLE pages. Returns rows written and whether more remain. */
export async function pullTable(cfg: SyncPullConfig, table: SyncTable, deps = pullDeps): Promise<{ rows: number; more: boolean }> {
  let after = await deps.cursor(table);
  if (after === null && table !== "launchpads") {
    after = encode({ ts: new Date(Date.now() - cfg.bootstrapHours * 3600_000).toISOString(), key: table === "launch_events" ? "0" : "" });
  }
  let rows = 0;
  for (let page = 0; page < MAX_PAGES_PER_CYCLE; page++) {
    const q = new URLSearchParams({ limit: String(MAX_SYNC_PAGE), ...(after ? { after } : {}) });
    const path = `/api/sync/v1/${table}?${q}`;
    const res = await deps.fetch(`${cfg.baseUrl}${path}`, { headers: { accept: "application/json", ...signSyncRequest(cfg.signingKey, "GET", path) }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`sync ${table}: HTTP ${res.status}`);
    const body = (await res.json()) as { rows?: Record<string, unknown>[]; next?: string | null; more?: boolean };
    const got = body.rows ?? [];
    rows += await deps.upsert(table, got);
    if (body.next) {
      after = body.next;
      await deps.saveCursor(table, after);
    }
    if (!body.more) return { rows, more: false };
  }
  return { rows, more: true };
}

let stop: (() => void) | null = null;

export function startSyncPull(cfg: SyncPullConfig): void {
  if (stop) return;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let stopped = false;
  const cycle = async () => {
    let behind = false;
    try {
      for (const table of SYNC_TABLES) {
        const r = await pullTable(cfg, table);
        behind ||= r.more;
        if (r.rows) console.log(JSON.stringify({ event: "prod_sync", table, rows: r.rows, behind: r.more }));
      }
      failures = 0;
    } catch (error) {
      failures++;
      // Message only: never the URL's query or headers (they carry the signature).
      console.error(JSON.stringify({ event: "prod_sync_failed", reason: error instanceof Error ? error.message.slice(0, 200) : "unknown" }));
    }
    if (stopped) return;
    const wait = failures ? Math.min(MAX_BACKOFF_MS, 30_000 * 2 ** (failures - 1)) : behind ? BUSY_MS : IDLE_MS;
    timer = setTimeout(() => void cycle(), wait);
    timer.unref?.();
  };
  void cycle();
  stop = () => { stopped = true; if (timer) clearTimeout(timer); stop = null; };
}
