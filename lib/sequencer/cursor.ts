// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



export interface SequencerCursorState {
  /** The latest sequence number processed */
  sequenceNumber: number;
  lastSequenceNumber?: number;
  /** The latest block number received */
  blockNumber: number;
  lastProcessedBlock?: number;
  /** The latest block timestamp (unix epoch seconds) */
  timestamp: number;
  /** The next expected sequence number */
  expectedSeq: number;
  /** Total sequence gaps detected during feed execution */
  gapsDetected: number;
  /** Initial starting sequence number if configured */
  initialSeq?: number;
  /** Callback fired when a sequence gap is detected */
  onGap?: (gap: GapDetectionResult) => void;
  /** Optional metadata about the most recently observed gap */
  lastGap?: {
    expected: number;
    received: number;
    gapSize: number;
    detectedAt: number;
  } | null;
}

export interface SequenceUpdateResult {
  /** Sequence number processed in this update */
  sequenceNumber: number;
  /** Block number associated with this update */
  blockNumber: number;
  /** Block timestamp associated with this update */
  timestamp: number;
  /** True if a gap was detected (incomingSeq > expectedSeq && expectedSeq > 0) */
  isGap: boolean;
  /** Expected sequence number prior to this update */
  expectedSeq: number;
  /** Number of missing sequence numbers in the gap (0 if no gap) */
  gapSize: number;
}

export interface GapDetectionResult {
  /** True if a gap was detected */
  hasGap: boolean;
  /** Alias for hasGap */
  isGap: boolean;
  /** Expected sequence number */
  expectedSeq: number;
  expected?: number;
  /** Incoming sequence number */
  receivedSeq: number;
  received?: number;
  /** Number of missing sequence numbers in the gap (0 if no gap) */
  gapSize: number;
}

export type SequencerCursorOptions = Partial<SequencerCursorState> & {
  onGap?: (gap: GapDetectionResult) => void;
  initialSeq?: number;
  initialSequenceNumber?: number;
  initialBlock?: number;
};

export class SequencerCursor {

  constructor(..._args: any[]) {
    throw new NotImplementedInPublicBuild("lib/sequencer/cursor.ts#SequencerCursor");
  }

  checkGap(incomingSeq: number): GapDetectionResult {
    throw new NotImplementedInPublicBuild("lib/sequencer/cursor.ts#SequencerCursor.checkGap");
  }

  getCursor(): SequencerCursorState {
    throw new NotImplementedInPublicBuild("lib/sequencer/cursor.ts#SequencerCursor.getCursor");
  }

  update(msg: {
    sequenceNumber: number;
    blockNumber?: number;
    timestamp?: number;
  }): SequenceUpdateResult {
    throw new NotImplementedInPublicBuild("lib/sequencer/cursor.ts#SequencerCursor.update");
  }

  async updateCursor(sequenceNumber: number, blockNumber?: number): Promise<void> {
    throw new NotImplementedInPublicBuild("lib/sequencer/cursor.ts#SequencerCursor.updateCursor");
  }

  getState(): SequencerCursorState {
    throw new NotImplementedInPublicBuild("lib/sequencer/cursor.ts#SequencerCursor.getState");
  }

  reset(initialState?: Partial<SequencerCursorState>): void {
    throw new NotImplementedInPublicBuild("lib/sequencer/cursor.ts#SequencerCursor.reset");
  }

}

export const defaultCursor = new SequencerCursor();