// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { decodeSequencerEnvelope } from "./decoder";

import { SequencerPipeline } from "./pipeline";

import type { DecodedSequencerBatch } from "./types";

export const DEFAULT_RELAY_URL = "ws://127.0.0.1:9642";

export const DEFAULT_FALLBACK_URL = "wss://feed.mainnet.chain.robinhood.com";

export type SequencerClientStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

export interface SequencerClientOptions {
  url?: string;
  fallbackUrl?: string;
  pipeline?: SequencerPipeline;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  recoverSenders?: boolean;
  onBatch?: (batch: DecodedSequencerBatch) => Promise<void> | void;
  onError?: (err: Error) => void;
  onStatusChange?: (status: SequencerClientStatus) => void;
  /** Injectable WebSocket constructor for tests and custom runtimes */
  WebSocketClass?: unknown;
}

export function resolveWebSocketClass(injected?: unknown): typeof WebSocket {
  throw new NotImplementedInPublicBuild("lib/sequencer/client.ts#resolveWebSocketClass");
}

export function computeExponentialBackoff(attempt: number, initialMs: any = undefined as any, maxMs: any = undefined as any): number {
  throw new NotImplementedInPublicBuild("lib/sequencer/client.ts#computeExponentialBackoff");
}

export class SequencerClient {

  constructor(..._args: any[]) {
    throw new NotImplementedInPublicBuild("lib/sequencer/client.ts#SequencerClient");
  }

  getStatus(): SequencerClientStatus {
    throw new NotImplementedInPublicBuild("lib/sequencer/client.ts#SequencerClient.getStatus");
  }

  getPipeline(): SequencerPipeline {
    throw new NotImplementedInPublicBuild("lib/sequencer/client.ts#SequencerClient.getPipeline");
  }

  getReconnectAttempt(): number {
    throw new NotImplementedInPublicBuild("lib/sequencer/client.ts#SequencerClient.getReconnectAttempt");
  }

  isConnected(): boolean {
    throw new NotImplementedInPublicBuild("lib/sequencer/client.ts#SequencerClient.isConnected");
  }

  start(): void {
    throw new NotImplementedInPublicBuild("lib/sequencer/client.ts#SequencerClient.start");
  }

  stop(): void {
    throw new NotImplementedInPublicBuild("lib/sequencer/client.ts#SequencerClient.stop");
  }

  setStatus(status: SequencerClientStatus): void {
    throw new NotImplementedInPublicBuild("lib/sequencer/client.ts#SequencerClient.setStatus");
  }

  connect(): void {
    throw new NotImplementedInPublicBuild("lib/sequencer/client.ts#SequencerClient.connect");
  }

  scheduleReconnect(): void {
    throw new NotImplementedInPublicBuild("lib/sequencer/client.ts#SequencerClient.scheduleReconnect");
  }

  startHeartbeat(): void {
    throw new NotImplementedInPublicBuild("lib/sequencer/client.ts#SequencerClient.startHeartbeat");
  }

  stopHeartbeat(): void {
    throw new NotImplementedInPublicBuild("lib/sequencer/client.ts#SequencerClient.stopHeartbeat");
  }

  clearTimers(): void {
    throw new NotImplementedInPublicBuild("lib/sequencer/client.ts#SequencerClient.clearTimers");
  }

}

export function createSequencerClient(options?: SequencerClientOptions): SequencerClient {
  throw new NotImplementedInPublicBuild("lib/sequencer/client.ts#createSequencerClient");
}