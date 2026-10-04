/**
 * Arbitrum Nitro Sequencer Feed Wire Protocol Types.
 *
 * Defines the schemas for:
 * 1. Sequencer WebSocket broadcast envelopes
 * 2. Arbitrum Nitro container & sub-message wire framing
 * 3. Decoded EVM transactions and message batches
 */

/** Container kind for a batch of sub-messages (0x03) */
export const ARB_CONTAINER_KIND_BATCH = 0x03;

/** Sub-message kind for signed EVM transactions (0x04) */
export const ARB_SUBMSG_KIND_SIGNED_TX = 0x04;

/** Sub-message kind for advance timestamp (0x01) */
export const ARB_SUBMSG_KIND_ADVANCE_TIMESTAMP = 0x01;

/** Sub-message kind for heartbeat (0x02) */
export const ARB_SUBMSG_KIND_HEARTBEAT = 0x02;

/** Sub-message kind for gas config updates (0x03) */
export const ARB_SUBMSG_KIND_GAS_CONFIG = 0x03;

/** Header metadata included in the sequencer feed message */
export interface SequencerHeader {
  kind?: number;
  sender?: string;
  blockNumber?: number;
  timestamp?: number;
  requestId?: string | null;
  baseFeeL1?: number;
}

/** Inner payload containing header and base64 L2 batch */
export interface SequencerInnerMessage {
  header?: SequencerHeader;
  l2Msg: string;
}

/** Message wrapper with sequence number */
export interface SequencerMessageWrapper {
  sequenceNumber: number;
  message?: {
    message?: SequencerInnerMessage;
    delayedMessagesRead?: number;
  };
}

/** Top-level JSON envelope received from the Nitro sequencer WebSocket */
export interface SequencerEnvelope {
  version: number;
  messages: SequencerMessageWrapper[];
}

/**
 * Parsed signed EVM transaction extracted from an L2MessageKind_SignedTx sub-message.
 */
export interface SequencerTransaction {
  /** Keccak-256 hash of the raw signed transaction bytes */
  hash: `0x${string}`;
  /** Destination address, or null for contract creation transactions */
  to: `0x${string}` | null;
  /** Recovered sender address (EIP-55 checksummed), or null if unrecoverable */
  from: `0x${string}` | null;
  /** Wei value transferred */
  value: bigint;
  /** Transaction calldata hex string (starts with 0x) */
  data: `0x${string}`;
  /** Gas limit */
  gas: bigint;
  /** Maximum total fee per gas (EIP-1559), or null for legacy / EIP-2930 */
  maxFeePerGas: bigint | null;
  /** Maximum priority fee / miner tip per gas (EIP-1559), or null */
  maxPriorityFeePerGas: bigint | null;
  /** Legacy gas price, or null if type 2 (EIP-1559) */
  gasPrice?: bigint | null;
  /** Account transaction sequence nonce */
  nonce?: number;
  /** Transaction envelope type (e.g. 'legacy', 'eip2930', 'eip1559', 'eip4844') */
  type?: string;
  /** EIP-155 chain ID */
  chainId?: number;
  /** Raw signed transaction hex */
  raw?: `0x${string}`;
}

/**
 * Raw binary sub-message unpacked from an Arbitrum Nitro 0x03 batch container.
 */
export interface RawSubMessage {
  /** Sub-message kind (e.g. 0x04 for SignedTx, 0x01 for AdvanceTimestamp) */
  kind: number;
  /** Raw binary payload of the sub-message */
  data: Buffer;
}

/**
 * Decoded sequencer feed batch containing sequence number, metadata, and transactions.
 */
export interface DecodedSequencerBatch {
  /** Nitro sequencer sequence number */
  sequenceNumber: number;
  /** Block timestamp from header or current unix epoch seconds */
  timestamp: number;
  /** L2 block number, when independently known. Nitro header blockNumber is not L2 evidence. */
  blockNumber?: number;
  /** L1 reference block number carried by the Nitro header */
  l1BlockNumber?: number;
  /** Parsed signed EVM transactions */
  transactions: SequencerTransaction[];
  /** Raw header if present */
  header?: SequencerHeader;
}

/** Alias for backward compatibility with PRD and ARCHITECTURE specs */
export type DecodedFeedMessage = DecodedSequencerBatch;

/** Options for sequencer message decoding */
export interface DecodeOptions {
  /** If true, returns batches even if they contain 0 valid transactions */
  includeEmptyBatches?: boolean;
  /** Recover transaction senders with ECDSA. Defaults to true. */
  recoverSender?: boolean;
  /** Ignore feed messages at or below this already-processed sequence. */
  afterSequence?: number;
}
