/**
 * Redaction for everything that leaves the process as a log row (PRD §20.2).
 *
 * The reporter must never persist authorization material, provider URLs
 * (Alchemy keys ride in the path), cookies, or unbounded payloads. Redaction
 * is defensive: it assumes the caller forgot to sanitize.
 */

/** Object keys whose values are always replaced wholesale. */
const SENSITIVE_KEY =
  /(secret|token|key|password|passwd|credential|authorization|cookie|session|private|signature|bearer)/i;

/** Inline patterns scrubbed out of every string value. */
const URL_PATTERN = /(https?:\/\/[^\s"'<>)\]]+)/g;
const BEARER_PATTERN = /\bBearer\s+[\w.~+/=-]+/gi;
const SUPABASE_KEY_PATTERN = /\bsb_(secret|publishable)_[\w-]+/g;

const REDACTED = "[redacted]";
const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_CHARS = 2_000;
const MAX_STACK_LINES = 30;

/**
 * Keep only the origin of any URL. Path and query are where credentials live
 * (`/v2/<alchemy-key>`, `?apikey=`), and evidence never needs them.
 */
export function redactString(value: string): string {
  return value
    .replace(/\0/g, "")
    .replace(URL_PATTERN, (raw) => {
      try {
        return `${new URL(raw).origin}/${REDACTED}`;
      } catch {
        return REDACTED;
      }
    })
    .replace(BEARER_PATTERN, `Bearer ${REDACTED}`)
    .replace(SUPABASE_KEY_PATTERN, REDACTED);
}

function redactValue(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    const scrubbed = redactString(value);
    return scrubbed.length > MAX_STRING_CHARS
      ? `${scrubbed.slice(0, MAX_STRING_CHARS)}… [${scrubbed.length} chars]`
      : scrubbed;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (depth >= MAX_DEPTH) return "[depth capped]";
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((v) => redactValue(v, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) items.push(`[+${value.length - MAX_ARRAY_ITEMS} more]`);
    return items;
  }
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message) };
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redactValue(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

/** Redact an arbitrary details object. Does not enforce the byte cap — pair with capJsonBytes. */
export function redactDetails(details: unknown): unknown {
  return redactValue(details, 0);
}

/**
 * Enforce the persistence byte cap (§20.2: 16 KiB default). Oversized payloads
 * are replaced with a marker + preview rather than silently dropped, so the
 * admin panel shows that detail existed.
 */
export function capJsonBytes(value: unknown, maxBytes: number): unknown {
  let json: string;
  try {
    json = JSON.stringify(value) ?? "null";
  } catch {
    return { _unserializable: true };
  }
  if (Buffer.byteLength(json, "utf8") <= maxBytes) return value;
  return {
    _truncated: true,
    _bytes: Buffer.byteLength(json, "utf8"),
    _preview: json.slice(0, Math.max(0, maxBytes - 200)),
  };
}

/** Sanitize a stack trace: bounded lines, no URLs/credentials. */
export function redactStack(error: unknown): string | null {
  if (!(error instanceof Error) || !error.stack) return null;
  return error.stack
    .split("\n")
    .slice(0, MAX_STACK_LINES)
    .map(redactString)
    .join("\n");
}
