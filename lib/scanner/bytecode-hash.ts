import { keccak256 } from "viem";

/**
 * Runtime-bytecode fingerprinting, with nothing behind it.
 *
 * This lived in `./clone.ts` and is still re-exported from there for every
 * existing caller. It was split out because `clone.ts` imports `lib/data/clone`
 * — so a module that wanted only this pure hash pulled Drizzle and a database
 * connection in with it. `lib/audit/artifact-cache.ts` is that module, and the
 * contract audit has to be able to run somewhere with no database at all.
 *
 * The Solidity compiler appends CBOR metadata (a swarm/ipfs hash of the source)
 * to the end of runtime bytecode. Two identical-source contracts differ only in
 * that trailer, so it is stripped before hashing — recompiles still collide.
 */

/** Strip the trailing CBOR metadata, then keccak the remaining runtime code. */
export function computeBytecodeHash(code: string): string {
  const hex = code.replace(/^0x/, "").toLowerCase();
  if (hex.length < 4) return keccak256(`0x${hex}`);
  const cborLen = parseInt(hex.slice(-4), 16); // last 2 bytes = metadata length
  const stripChars = (cborLen + 2) * 2;
  const trailer = Number.isFinite(cborLen) && stripChars < hex.length
    ? hex.slice(hex.length - stripChars, -4)
    : "";
  const looksLikeSolidityMetadata =
    /^a[1-9a-f]/.test(trailer) &&
    /(69706673|627a7a72|736f6c63|6578706572696d656e74616c)/.test(trailer);
  const runtime =
    cborLen > 0 && looksLikeSolidityMetadata ? hex.slice(0, hex.length - stripChars) : hex;
  return keccak256(`0x${runtime}`);
}
