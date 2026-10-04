// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import fs from "node:fs";

import { enqueueSequencerBatch, startIngestionRuntime, stopIngestionRuntime, scheduleRecovery } from "./runtime";

import { recordSequencerMetric, writeSequencerCheckpoint, sanitizeSequencerError } from "@/lib/data/sequencer";

import {
  SequencerClient,
  type SequencerClientStatus,
  type SequencerClientOptions,
  DEFAULT_RELAY_URL,
} from "./client";

import { SequencerPipeline, type SequencerPipelineOptions } from "./pipeline";

export const DOCKER_RELAY_URL = "ws://relay:9642";

export interface SequencerServiceStatus {
  running: boolean;
  status: SequencerClientStatus;
  url: string | null;
}

export interface SequencerServiceOptions {
  url?: string;
  client?: SequencerClient;
  pipeline?: SequencerPipeline;
  pipelineOptions?: SequencerPipelineOptions;
  clientOptions?: Partial<SequencerClientOptions>;
  WebSocketClass?: unknown;
}

export function isRunningInDocker(): boolean {
  throw new NotImplementedInPublicBuild("lib/sequencer/service.ts#isRunningInDocker");
}

export function resolveWsFeedUrl(): string {
  throw new NotImplementedInPublicBuild("lib/sequencer/service.ts#resolveWsFeedUrl");
}

export function startSequencerService(options?: SequencerServiceOptions): SequencerClient {
  throw new NotImplementedInPublicBuild("lib/sequencer/service.ts#startSequencerService");
}

export function stopSequencerService(): void {
  throw new NotImplementedInPublicBuild("lib/sequencer/service.ts#stopSequencerService");
}

export function getSequencerServiceStatus(): SequencerServiceStatus {
  throw new NotImplementedInPublicBuild("lib/sequencer/service.ts#getSequencerServiceStatus");
}

export function getActiveSequencerClient(): SequencerClient | null {
  throw new NotImplementedInPublicBuild("lib/sequencer/service.ts#getActiveSequencerClient");
}