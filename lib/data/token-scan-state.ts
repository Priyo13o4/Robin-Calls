import { eq } from "drizzle-orm";
import { database } from "@/lib/db/client";
import { tokenScanState } from "@/lib/db/schema";

/**
 * token_scan_state repository (PRD §16.2, §17.1) — one mutable pointer row
 * per token. Cache/index only: the verdict row stays the source of truth, so
 * every write here is best-effort and a failure can never fail a scan.
 */

export interface TokenScanState {
  tokenAddress: string;
  latestVerdictId: number | null;
  resultFingerprint: string | null;
  lastCompleteScanAt: string | null;
  lastReceiptAt: string | null;
  dexProtocols: string[];
  primaryPoolAddress: string | null;
}

export async function readTokenScanState(
  tokenAddress: string
): Promise<TokenScanState | null> {
  const conn = database();
  if (!conn) return null;

  const rows = await conn
    .select()
    .from(tokenScanState)
    .where(eq(tokenScanState.tokenAddress, tokenAddress.toLowerCase()))
    .limit(1);

  const data = rows[0];
  if (!data) return null;

  return {
    tokenAddress: data.tokenAddress,
    latestVerdictId: data.latestVerdictId ?? null,
    resultFingerprint: data.resultFingerprint ?? null,
    lastCompleteScanAt: data.lastCompleteScanAt ? new Date(data.lastCompleteScanAt).toISOString() : null,
    lastReceiptAt: data.lastReceiptAt ? new Date(data.lastReceiptAt).toISOString() : null,
    dexProtocols: data.dexProtocols ?? [],
    primaryPoolAddress: data.primaryPoolAddress ?? null,
  };
}

/** Best-effort upsert; failure is console-logged, never throws. */
export async function upsertTokenScanState(
  state: TokenScanState
): Promise<void> {
  const conn = database();
  if (!conn) return;

  try {
    await conn
      .insert(tokenScanState)
      .values({
        tokenAddress: state.tokenAddress.toLowerCase(),
        latestVerdictId: state.latestVerdictId,
        resultFingerprint: state.resultFingerprint,
        lastCompleteScanAt: state.lastCompleteScanAt,
        lastReceiptAt: state.lastReceiptAt,
        dexProtocols: state.dexProtocols,
        primaryPoolAddress: state.primaryPoolAddress,
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoUpdate({
        target: tokenScanState.tokenAddress,
        set: {
          latestVerdictId: state.latestVerdictId,
          resultFingerprint: state.resultFingerprint,
          lastCompleteScanAt: state.lastCompleteScanAt,
          lastReceiptAt: state.lastReceiptAt,
          dexProtocols: state.dexProtocols,
          primaryPoolAddress: state.primaryPoolAddress,
          updatedAt: new Date().toISOString(),
        },
      });
  } catch (error) {
    console.error("[RC_DB_WRITE_FAILED] token_scan_state upsert failed:", (error as Error).message);
  }
}
