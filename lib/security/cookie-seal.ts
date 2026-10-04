import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

/**
 * Authenticated symmetric encryption for short-lived onboarding cookies —
 * generic factory so each domain (X, Telegram, …) gets its own key-separated
 * sealer without duplicating the crypto. AES-256-GCM gives confidentiality +
 * integrity, so a tampered or forged cookie fails to open rather than being
 * trusted.
 *
 * The key is derived from a server secret (a dedicated one if provided, else
 * BETTER_AUTH_SECRET — already a 32-byte hex string in every environment) and a
 * per-domain salt, so an X cookie can never be opened as a Telegram cookie.
 *
 * (lib/x/crypto.ts predates this and keeps its own copy; new domains use this.)
 */
export function makeSealer(opts: { secretEnv: string; salt: string }) {
  let cachedKey: Buffer | null = null;

  function key(): Buffer {
    if (cachedKey) return cachedKey;
    const secret =
      process.env[opts.secretEnv]?.trim() ||
      process.env.BETTER_AUTH_SECRET?.trim();
    if (!secret) {
      throw new Error(
        `cookie encryption needs ${opts.secretEnv} or BETTER_AUTH_SECRET`
      );
    }
    cachedKey = scryptSync(secret, opts.salt, 32);
    return cachedKey;
  }

  function seal(value: unknown): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key(), iv);
    const plaintext = Buffer.from(JSON.stringify(value), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
  }

  function open<T>(sealed: string | undefined | null): T | null {
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

  return { seal, open };
}
