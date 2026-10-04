// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { normalizePonsEvent, type PonsEvent } from "./pons-events";

export const DEFAULT_PONS_WS_URL = "wss://rhc.pumpdev.io/ws";

export const DEFAULT_INITIAL_BACKOFF_MS = 1000;

export const DEFAULT_MAX_BACKOFF_MS = 30000;

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 15000;

export const DEFAULT_STALE_TIMEOUT_MS = 60000;

export const DEFAULT_MAX_QUEUE_SIZE = 500;

export const DEFAULT_MAX_PAYLOAD_BYTES = 256 * 1024;

export type PonsClientStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

export interface PonsClientOptions {
  url?: string;
  WebSocketClass?: unknown;
  onEvent: (event: PonsEvent) => Promise<void> | void;
  onStatus?: (status: string) => void;
  onError?: (reason: string) => void;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  heartbeatIntervalMs?: number;
  staleTimeoutMs?: number;
  maxQueueSize?: number;
  maxPayloadBytes?: number;
}

export function resolveWebSocketClass(injected?: unknown): typeof WebSocket {
  throw new NotImplementedInPublicBuild("lib/sequencer/pons-client.ts#resolveWebSocketClass");
}

export function computeExponentialBackoff(attempt: number, initialMs: any = undefined as any, maxMs: any = undefined as any, randomFn: () => number = undefined as any): number {
  throw new NotImplementedInPublicBuild("lib/sequencer/pons-client.ts#computeExponentialBackoff");
}

export class PonsClient {

  constructor(..._args: any[]) {
    throw new NotImplementedInPublicBuild("lib/sequencer/pons-client.ts#PonsClient");
  }

  getStatus(): string {
    throw new NotImplementedInPublicBuild("lib/sequencer/pons-client.ts#PonsClient.getStatus");
  }

  isConnected(): boolean {
    throw new NotImplementedInPublicBuild("lib/sequencer/pons-client.ts#PonsClient.isConnected");
  }

  start(): void {
    throw new NotImplementedInPublicBuild("lib/sequencer/pons-client.ts#PonsClient.start");
  }

  stop(): void {
    throw new NotImplementedInPublicBuild("lib/sequencer/pons-client.ts#PonsClient.stop");
  }

  setStatus(status: PonsClientStatus): void {
    throw new NotImplementedInPublicBuild("lib/sequencer/pons-client.ts#PonsClient.setStatus");
  }

  emitError(reason: string): void {
    throw new NotImplementedInPublicBuild("lib/sequencer/pons-client.ts#PonsClient.emitError");
  }

  connect(): void {
    throw new NotImplementedInPublicBuild("lib/sequencer/pons-client.ts#PonsClient.connect");
  }

  enqueue(event: PonsEvent): void {
    throw new NotImplementedInPublicBuild("lib/sequencer/pons-client.ts#PonsClient.enqueue");
  }

  async processQueue(): Promise<void> {
    throw new NotImplementedInPublicBuild("lib/sequencer/pons-client.ts#PonsClient.processQueue");
  }

  scheduleReconnect(): void {
    throw new NotImplementedInPublicBuild("lib/sequencer/pons-client.ts#PonsClient.scheduleReconnect");
  }

  startHeartbeat(): void {
    throw new NotImplementedInPublicBuild("lib/sequencer/pons-client.ts#PonsClient.startHeartbeat");
  }

  stopHeartbeat(): void {
    throw new NotImplementedInPublicBuild("lib/sequencer/pons-client.ts#PonsClient.stopHeartbeat");
  }

  clearTimers(): void {
    throw new NotImplementedInPublicBuild("lib/sequencer/pons-client.ts#PonsClient.clearTimers");
  }

}