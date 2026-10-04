// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



export const OPCODE = {
  /** `tx.gasprice` — 0 in an `eth_call` that omits the field (KNOWN-PROBLEMS L14). */
  GASPRICE: 0x3a,
  /** `tx.origin` — the sim's sender, never a router the way a real trade routes. */
  ORIGIN: 0x32,
  /** `block.coinbase`. */
  COINBASE: 0x41,
  DELEGATECALL: 0xf4,
} as const;

export function scanForOpcode(codeHex: string | null | undefined, opcode: number): boolean | null {
  throw new NotImplementedInPublicBuild("lib/audit/opcode-scan.ts#scanForOpcode");
}

export function readsGasPrice(runtimeCode: string | null | undefined): boolean | null {
  throw new NotImplementedInPublicBuild("lib/audit/opcode-scan.ts#readsGasPrice");
}

export function readsTxOrigin(runtimeCode: string | null | undefined): boolean | null {
  throw new NotImplementedInPublicBuild("lib/audit/opcode-scan.ts#readsTxOrigin");
}