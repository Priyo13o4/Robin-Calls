import { NextResponse } from "next/server";
import { verifySyncRequest } from "@/lib/security/sync-auth";
import { readSyncPage, SYNC_TABLES, MAX_SYNC_PAGE, type SyncCursor, type SyncTable } from "@/lib/data/sync";
import { reportError } from "@/lib/observability/reporter";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
/** Pages in flight per process. Bounds prod's CPU and memory whatever the caller does. */
const MAX_IN_FLIGHT = 2;
let inFlight = 0;

const notFound = () => new NextResponse("Not Found", { status: 404, headers: NO_STORE });

function parseCursor(raw: string | null): SyncCursor | null | undefined {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as SyncCursor;
    return typeof c.ts === "string" && typeof c.key === "string" && c.ts.length < 64 && c.key.length < 80 && !Number.isNaN(Date.parse(c.ts)) ? c : undefined;
  } catch {
    return undefined;
  }
}

/**
 * GET /api/sync/v1/<table>?after=<cursor>&limit=<n>
 * Prod -> local-smoke sync (lib/sync/). Signed by the local stack's Ed25519 key; any failure is a
 * plain 404 so the route does not reveal it exists. Off entirely unless SYNC_PUBLIC_KEY is set.
 */
export async function GET(req: Request, { params }: { params: Promise<{ table: string }> }) {
  if (!(await verifySyncRequest(req))) return notFound();
  const table = (await params).table as SyncTable;
  const url = new URL(req.url);
  const after = parseCursor(url.searchParams.get("after"));
  const limit = Number(url.searchParams.get("limit") ?? MAX_SYNC_PAGE);
  if (!SYNC_TABLES.includes(table) || after === undefined || !Number.isInteger(limit) || limit < 1 || limit > MAX_SYNC_PAGE) {
    return NextResponse.json({ ok: false, error: "Invalid request" }, { status: 400, headers: NO_STORE });
  }
  if (inFlight >= MAX_IN_FLIGHT) return NextResponse.json({ ok: false, error: "Busy" }, { status: 429, headers: { ...NO_STORE, "Retry-After": "5" } });
  inFlight++;
  try {
    const page = await readSyncPage(table, after, limit);
    if (!page) return NextResponse.json({ ok: false, error: "Unavailable" }, { status: 503, headers: NO_STORE });
    return NextResponse.json({
      ok: true,
      rows: page.rows,
      next: page.next ? Buffer.from(JSON.stringify(page.next)).toString("base64url") : null,
      more: page.more,
    }, { headers: NO_STORE });
  } catch (error) {
    await reportError({ code: "RC_SYNC_FAILED", message: `${table}: ${error instanceof Error ? error.message : String(error)}`, route: "/api/sync/v1", operation: table, error });
    return NextResponse.json({ ok: false, error: "Unavailable" }, { status: 503, headers: NO_STORE });
  } finally {
    inFlight--;
  }
}
