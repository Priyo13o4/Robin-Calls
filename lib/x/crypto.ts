import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

/**
 * Authenticated symmetric encryption for the short-lived X onboarding cookies
 * (the PKCE state and the session that holds the user's access token). AES-256-
 * GCM gives confidentiality + integrity, so a tampered or forged cookie fails
 * to open rather than being trusted.
 *
 * The key is derived from a server secret — a dedicated X_SESSION_SECRET if set,
 * otherwise BETTER_AUTH_SECRET (already a 32-byte hex string in every
 * environment). No new required env var.
 */

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const secret =
    process.env.X_SESSION_SECRET?.trim() ||
    process.env.BETTER_AUTH_SECRET?.trim();
  if (!secret) {
    throw new Error(
      "X cookie encryption needs X_SESSION_SECRET or BETTER_AUTH_SECRET"
    );
  }
  // Fixed salt: the secret is already high-entropy, and a per-value salt would
  // have to be stored alongside the ciphertext anyway. scrypt stretches it to
  // a 32-byte AES key deterministically.
  cachedKey = scryptSync(secret, "robincalls-x-oauth", 32);
  return cachedKey;
}

/** Encrypt any JSON-serialisable value to a compact `iv.tag.ciphertext` string. */
export function seal(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

/** Decrypt a `seal()` string. Returns null on any tamper / malformed input. */
export function open<T>(sealed: string | undefined | null): T | null {
  if (!sealed) return null;
  const parts = sealed.split(".");
  if (parts.length !== 3) return null;
  try {
    const [ivB64, tagB64, ctB64] = parts;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key(),
      Buffer.from(ivB64, "base64url")
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ctB64, "base64url")),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString("utf8")) as T;
  } catch {
    return null; // wrong key, tampered tag, or garbage
  }
}
