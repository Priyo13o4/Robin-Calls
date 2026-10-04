import { createPrivateKey, createPublicKey, randomBytes, sign, verify, type KeyObject } from "node:crypto";
import { redisClient } from "@/lib/redis/client";

/**
 * Prod -> local-smoke sync auth (lib/sync/). Ed25519: the local stack holds the private key
 * (PROD_SYNC_SIGNING_KEY, .env.local only); prod holds only the public key (SYNC_PUBLIC_KEY), so
 * nothing on prod, in SSM history or in a leaked prod env can sign a request.
 * Each request is signed over method, path+query, time and a single-use nonce.
 */

export const MAX_SKEW_MS = 60_000;
const NONCE_TTL_S = 120;
const NONCE_PREFIX = "sync:nonce:";
const NONCE = /^[0-9a-f]{32}$/;

let publicKey: { raw: string; key: KeyObject } | null = null;

function verifyKey(): KeyObject | null {
  const raw = process.env.SYNC_PUBLIC_KEY?.trim();
  if (!raw) return null;
  if (publicKey?.raw === raw) return publicKey.key;
  try {
    const key = createPublicKey({ key: Buffer.from(raw, "base64"), format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ed25519") return null;
    publicKey = { raw, key };
    return key;
  } catch {
    return null; // malformed key: fail closed
  }
}

export const syncServingEnabled = () => verifyKey() !== null;

const message = (method: string, pathWithQuery: string, ts: string, nonce: string) =>
  Buffer.from(`${method.toUpperCase()}\n${pathWithQuery}\n${ts}\n${nonce}`);

export function signSyncRequest(signingKeyB64: string, method: string, pathWithQuery: string, now = Date.now()): Record<string, string> {
  const key = createPrivateKey({ key: Buffer.from(signingKeyB64, "base64"), format: "der", type: "pkcs8" });
  const ts = String(now);
  const nonce = randomBytes(16).toString("hex");
  return { "x-sync-ts": ts, "x-sync-nonce": nonce, "x-sync-sig": sign(null, message(method, pathWithQuery, ts, nonce), key).toString("base64") };
}

export const syncAuthDeps = {
  /** True when the nonce was unused (and is now spent). Throws when the store is down. */
  spendNonce: async (nonce: string): Promise<boolean> => {
    const redis = redisClient();
    if (!redis) throw new Error("nonce store unavailable");
    return (await redis.set(`${NONCE_PREFIX}${nonce}`, "1", "EX", NONCE_TTL_S, "NX")) === "OK";
  },
};

/** Every failure is the same false: the caller answers 404 and names no reason. */
export async function verifySyncRequest(req: Request, now = Date.now()): Promise<boolean> {
  const key = verifyKey();
  if (!key) return false;
  const ts = req.headers.get("x-sync-ts") ?? "";
  const nonce = req.headers.get("x-sync-nonce") ?? "";
  const sig = req.headers.get("x-sync-sig") ?? "";
  const t = Number(ts);
  if (!/^\d{13}$/.test(ts) || Math.abs(now - t) > MAX_SKEW_MS || !NONCE.test(nonce) || !sig || sig.length > 200) return false;
  const url = new URL(req.url);
  let ok: boolean;
  try {
    ok = verify(null, message(req.method, `${url.pathname}${url.search}`, ts, nonce), key, Buffer.from(sig, "base64"));
  } catch {
    return false;
  }
  if (!ok) return false;
  // Spent only after the signature checks, so a stranger cannot fill the nonce store.
  try {
    return await syncAuthDeps.spendNonce(nonce);
  } catch {
    return false; // cannot prove single use: refuse
  }
}
