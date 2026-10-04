import { isAddress } from "viem";
import type { Address, Hex, SignedPermit, SwapRequest } from "./types";
import { parseSwapPoolHints } from "./pool-hints";

export const MAX_BODY_BYTES = 64 * 1024; // 64 KiB = 65,536 bytes
export const MAX_UINT160 = (1n << 160n) - 1n;
export const MAX_UINT48 = 2 ** 48 - 1; // 281,474,976,710,655
export const MAX_UINT256 = (1n << 256n) - 1n;
export const MAX_SIGNATURE_BYTES = 4096; // 4096 bytes = 8192 hex characters
export const MIN_SLIPPAGE_BPS = 1;
export const MAX_SLIPPAGE_BPS = 5000;

const CANONICAL_POSITIVE_INT = /^[1-9]\d*$/;
const CANONICAL_UINT = /^(0|[1-9]\d*)$/;
const HEX_PATTERN = /^0x[0-9a-fA-F]+$/;

export type ValidationResult =
  | { ok: true; value: SwapRequest }
  | { ok: false; error: { status: "invalid"; detail: string } };

export type BoundedJsonResult =
  | { ok: true; data: unknown }
  | { ok: false; error: { status: "invalid"; detail: string } };

/**
 * Reads the request body enforcing a strict byte limit (default 64 KiB).
 * Content-Length is checked early as a fast path; actual bytes are bounded
 * while reading the stream chunk-by-chunk to prevent streaming denial-of-service.
 * Does not log bodies or signatures.
 */
export async function readBoundedJson(
  req: Request,
  maxBytes: number = MAX_BODY_BYTES,
): Promise<BoundedJsonResult> {
  // 1. Early Content-Length check
  const contentLength = req.headers.get("content-length");
  if (contentLength !== null) {
    const length = Number(contentLength);
    if (!Number.isSafeInteger(length) || length < 0 || length > maxBytes) {
      return {
        ok: false,
        error: {
          status: "invalid",
          detail: length > maxBytes
            ? "The request body exceeds the 64 KiB limit."
            : "The request body was not valid JSON.",
        },
      };
    }
  }

  // 2. Read stream with chunk-level byte counter
  if (!req.body) {
    try {
      const text = await req.text();
      if (!text || text.trim() === "") {
        return {
          ok: false,
          error: { status: "invalid", detail: "The request body was not valid JSON." },
        };
      }
      if (text.length > maxBytes) {
        return {
          ok: false,
          error: { status: "invalid", detail: "The request body exceeds the 64 KiB limit." },
        };
      }
      const data = JSON.parse(text);
      return { ok: true, data };
    } catch {
      return {
        ok: false,
        error: { status: "invalid", detail: "The request body was not valid JSON." },
      };
    }
  }

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          try {
            await reader.cancel();
          } catch {
            // Ignore stream cancel failures
          }
          return {
            ok: false,
            error: { status: "invalid", detail: "The request body exceeds the 64 KiB limit." },
          };
        }
        chunks.push(value);
      }
    }
  } catch {
    return {
      ok: false,
      error: { status: "invalid", detail: "The request body was not valid JSON." },
    };
  }

  if (chunks.length === 0 || totalBytes === 0) {
    return {
      ok: false,
      error: { status: "invalid", detail: "The request body was not valid JSON." },
    };
  }

  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(merged);
  } catch {
    return {
      ok: false,
      error: { status: "invalid", detail: "The request body was not valid JSON." },
    };
  }

  if (!text || text.trim() === "") {
    return {
      ok: false,
      error: { status: "invalid", detail: "The request body was not valid JSON." },
    };
  }

  try {
    const data = JSON.parse(text);
    return { ok: true, data };
  } catch {
    return {
      ok: false,
      error: { status: "invalid", detail: "The request body was not valid JSON." },
    };
  }
}

/**
 * Pure validator for runtime SwapRequest payloads.
 * Enforces:
 * - account, tokenIn, tokenOut are valid viem addresses
 * - tokenIn and tokenOut must differ
 * - amountIn is a canonical positive base-10 integer string <= 2^160 - 1
 * - slippageBps is 'auto' or integer in 1..5000
 * - rejection of unknown top-level keys
 * - optional permit object validation (addresses, canonical decimals, safe uint48, bounded hex signature)
 * Returns { ok: true, value } or { ok: false, error: { status: "invalid", detail } }
 * Never throws.
 */
export function validateSwapRequest(input: unknown): ValidationResult {
  try {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      return {
        ok: false,
        error: { status: "invalid", detail: "The request body must be an object." },
      };
    }

    const req = input as Record<string, unknown>;

    // 1. Unknown top-level keys
    const ALLOWED_KEYS = new Set([
      "account",
      "tokenIn",
      "tokenOut",
      "amountIn",
      "slippageBps",
      "permit",
      "poolHints",
      "atomicBatch",
      "preferRoute",
    ]);
    for (const key of Object.keys(req)) {
      if (!ALLOWED_KEYS.has(key)) {
        return {
          ok: false,
          error: { status: "invalid", detail: `Unknown field in request: ${key}` },
        };
      }
    }

    // 2. account
    if (typeof req.account !== "string" || !isAddress(req.account, { strict: false })) {
      return {
        ok: false,
        error: { status: "invalid", detail: "That is not a valid address." },
      };
    }

    // 3. tokenIn and tokenOut
    if (typeof req.tokenIn !== "string" || !isAddress(req.tokenIn, { strict: false })) {
      return {
        ok: false,
        error: { status: "invalid", detail: "That is not a valid address." },
      };
    }
    if (typeof req.tokenOut !== "string" || !isAddress(req.tokenOut, { strict: false })) {
      return {
        ok: false,
        error: { status: "invalid", detail: "That is not a valid address." },
      };
    }
    if (req.tokenIn.toLowerCase() === req.tokenOut.toLowerCase()) {
      return {
        ok: false,
        error: { status: "invalid", detail: "Pick two different tokens." },
      };
    }

    // 4. amountIn: canonical positive base-10 integer string <= 2^160 - 1
    if (typeof req.amountIn !== "string" || !CANONICAL_POSITIVE_INT.test(req.amountIn)) {
      if (typeof req.amountIn === "string" && (req.amountIn === "0" || /^0+$/.test(req.amountIn))) {
        return {
          ok: false,
          error: { status: "invalid", detail: "Enter an amount above zero." },
        };
      }
      return {
        ok: false,
        error: { status: "invalid", detail: "The amount must be a whole number of base units." },
      };
    }
    const amountInBigInt = BigInt(req.amountIn);
    if (amountInBigInt > MAX_UINT160) {
      return {
        ok: false,
        error: { status: "invalid", detail: "The amount exceeds the maximum allowable uint160 value." },
      };
    }

    // 5. slippageBps: 'auto' or integer in 1..5000
    if (req.slippageBps !== "auto") {
      if (
        typeof req.slippageBps !== "number" ||
        !Number.isInteger(req.slippageBps) ||
        req.slippageBps < MIN_SLIPPAGE_BPS ||
        req.slippageBps > MAX_SLIPPAGE_BPS
      ) {
        return {
          ok: false,
          error: { status: "invalid", detail: "Slippage must be between 0.01% and 50%." },
        };
      }
    }

    const poolHints = parseSwapPoolHints(req.poolHints);
    if (!poolHints) {
      return { ok: false, error: { status: "invalid", detail: "The pool hints are malformed." } };
    }
    if (req.atomicBatch !== undefined && typeof req.atomicBatch !== "boolean") {
      return { ok: false, error: { status: "invalid", detail: "atomicBatch must be true or false." } };
    }
    if (req.preferRoute !== undefined && (typeof req.preferRoute !== "string" || !/^[a-z0-9-]{1,40}:[0-9a-fx>-]{1,300}$/.test(req.preferRoute))) {
      return { ok: false, error: { status: "invalid", detail: "preferRoute is malformed." } };
    }

    // 6. Optional permit object
    let validatedPermit: SignedPermit | undefined = undefined;
    if (req.permit !== undefined) {
      if (req.permit === null || typeof req.permit !== "object" || Array.isArray(req.permit)) {
        return {
          ok: false,
          error: { status: "invalid", detail: "The signed permit is malformed." },
        };
      }
      const p = req.permit as Record<string, unknown>;

      const ALLOWED_PERMIT_KEYS = new Set([
        "token",
        "spender",
        "amount",
        "expiration",
        "nonce",
        "sigDeadline",
        "signature",
      ]);
      for (const key of Object.keys(p)) {
        if (!ALLOWED_PERMIT_KEYS.has(key)) {
          return {
            ok: false,
            error: { status: "invalid", detail: "The signed permit is malformed." },
          };
        }
      }

      // token & spender addresses
      if (typeof p.token !== "string" || !isAddress(p.token) || typeof p.spender !== "string" || !isAddress(p.spender)) {
        return {
          ok: false,
          error: { status: "invalid", detail: "The signed permit is malformed." },
        };
      }

      // amount canonical decimal <= 2^160 - 1
      if (typeof p.amount !== "string" || !CANONICAL_UINT.test(p.amount)) {
        return {
          ok: false,
          error: { status: "invalid", detail: "The signed permit is malformed." },
        };
      }
      const pAmountBigInt = BigInt(p.amount);
      if (pAmountBigInt > MAX_UINT160) {
        return {
          ok: false,
          error: { status: "invalid", detail: "The signed permit is malformed." },
        };
      }

      // expiration safe integer in 0..2^48 - 1
      if (
        typeof p.expiration !== "number" ||
        !Number.isSafeInteger(p.expiration) ||
        p.expiration < 0 ||
        p.expiration > MAX_UINT48
      ) {
        return {
          ok: false,
          error: { status: "invalid", detail: "The signed permit is malformed." },
        };
      }

      // nonce safe integer in 0..2^48 - 1
      if (
        typeof p.nonce !== "number" ||
        !Number.isSafeInteger(p.nonce) ||
        p.nonce < 0 ||
        p.nonce > MAX_UINT48
      ) {
        return {
          ok: false,
          error: { status: "invalid", detail: "The signed permit is malformed." },
        };
      }

      // sigDeadline canonical decimal <= 2^256 - 1
      if (typeof p.sigDeadline !== "string" || !CANONICAL_UINT.test(p.sigDeadline)) {
        return {
          ok: false,
          error: { status: "invalid", detail: "The signed permit is malformed." },
        };
      }
      const deadlineBigInt = BigInt(p.sigDeadline);
      if (deadlineBigInt > MAX_UINT256) {
        return {
          ok: false,
          error: { status: "invalid", detail: "The signed permit is malformed." },
        };
      }

      // signature: bounded even-length nonempty hex (up to 4096 bytes for EIP-1271)
      if (
        typeof p.signature !== "string" ||
        !p.signature.startsWith("0x") ||
        p.signature.length < 4 || // at least 1 byte: "0x" + 2 chars
        p.signature.length % 2 !== 0 ||
        p.signature.length > 2 + MAX_SIGNATURE_BYTES * 2 || // 8194 chars max
        !HEX_PATTERN.test(p.signature)
      ) {
        return {
          ok: false,
          error: { status: "invalid", detail: "The signed permit is malformed." },
        };
      }

      validatedPermit = {
        token: p.token as Address,
        spender: p.spender as Address,
        amount: p.amount,
        expiration: p.expiration,
        nonce: p.nonce,
        sigDeadline: p.sigDeadline,
        signature: p.signature as Hex,
      };
    }

    const validatedReq: SwapRequest = {
      account: req.account as Address,
      tokenIn: req.tokenIn as Address,
      tokenOut: req.tokenOut as Address,
      amountIn: req.amountIn,
      slippageBps: req.slippageBps as number | "auto",
      ...(validatedPermit !== undefined ? { permit: validatedPermit } : {}),
      ...(poolHints.length ? { poolHints } : {}),
      ...(req.atomicBatch === true ? { atomicBatch: true } : {}),
      ...(typeof req.preferRoute === "string" ? { preferRoute: req.preferRoute } : {}),
    };

    return { ok: true, value: validatedReq };
  } catch {
    return {
      ok: false,
      error: { status: "invalid", detail: "The request body was not valid JSON." },
    };
  }
}
