// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import {
  parseTransaction,
  serializeTransaction,
  keccak256,
  getAddress,
  recoverTransactionAddress,
  type TransactionSerialized,
} from "viem";

import { secp256k1 } from "@noble/curves/secp256k1";

import {
  ARB_CONTAINER_KIND_BATCH,
  ARB_SUBMSG_KIND_SIGNED_TX,
  type DecodeOptions,
  type DecodedSequencerBatch,
  type RawSubMessage,
  type SequencerEnvelope,
  type SequencerMessageWrapper,
  type SequencerTransaction,
} from "./types";

export function recoverSenderSync(tx: ReturnType<typeof parseTransaction>): `0x${string}` | null {
  throw new NotImplementedInPublicBuild("lib/sequencer/decoder.ts#recoverSenderSync");
}

export function unpackL2Batch(l2Msg: string | Buffer | Uint8Array): RawSubMessage[] {
  throw new NotImplementedInPublicBuild("lib/sequencer/decoder.ts#unpackL2Batch");
}

export function packL2Batch(subMessages: Array<{ kind: number; data: Buffer | Uint8Array | string }>): Buffer {
  throw new NotImplementedInPublicBuild("lib/sequencer/decoder.ts#packL2Batch");
}

export function parseSequencerTransactionSync(rawTx: `0x${string}` | Buffer | Uint8Array, options?: DecodeOptions): SequencerTransaction | null {
  throw new NotImplementedInPublicBuild("lib/sequencer/decoder.ts#parseSequencerTransactionSync");
}

export async function parseSequencerTransaction(rawTx: `0x${string}` | Buffer | Uint8Array, options?: DecodeOptions): Promise<SequencerTransaction | null> {
  throw new NotImplementedInPublicBuild("lib/sequencer/decoder.ts#parseSequencerTransaction");
}

export function decodeL2Batch(l2Msg: string | Buffer | Uint8Array, options?: DecodeOptions): SequencerTransaction[] {
  throw new NotImplementedInPublicBuild("lib/sequencer/decoder.ts#decodeL2Batch");
}

export function decodeSequencerMessage(raw: string | SequencerEnvelope | unknown, options?: DecodeOptions): DecodedSequencerBatch[] {
  throw new NotImplementedInPublicBuild("lib/sequencer/decoder.ts#decodeSequencerMessage");
}

export async function decodeSequencerMessageAsync(raw: string | SequencerEnvelope | unknown, options?: DecodeOptions): Promise<DecodedSequencerBatch[]> {
  throw new NotImplementedInPublicBuild("lib/sequencer/decoder.ts#decodeSequencerMessageAsync");
}

export const decodeSequencerEnvelope = decodeSequencerMessage;

export const decodeSequencerEnvelopeAsync = decodeSequencerMessageAsync;