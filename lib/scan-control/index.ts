import { createHash } from "crypto";
import { clientIpFromHeaders } from "../security/client-ip";
import { redisClient } from "../redis/client";
import { RedisScanCoordinator } from "./redis-coordinator";
import { MemoryScanCoordinator } from "./memory-coordinator";
import { reportError } from "../observability/reporter";
import type { ScanCoordinator } from "./types";

export { scanControlConfig } from "./config";
export {
  CoordinationUnavailableError,
  type Admission,
  type CachedScanEntry,
  type CachedScanFailure,
  type CachedScanResult,
  type CapacityDenial,
  type CapacityGauge,
  type CapacityScope,
  type CapacitySnapshot,
  type ReceiptAction,
  type ScanCoordinator,
} from "./types";

/**
 * Coordination-mode resolution (PRD §10.4):
 *
 * - Valkey configured             → RedisScanCoordinator (all environments).
 * - Not configured, development   → MemoryScanCoordinator (single-process).
 * - Not configured, production    → fresh scans DISABLED. Serving cached and
 *   database receipts still works; launching unbounded upstream pipelines
 *   without cross-instance limits does not. Reported once as RC_CONFIG_INVALID.
 */

let coordinator: ScanCoordinator | null | undefined;
let misconfigurationReported = false;

export function scanCoordinator(): ScanCoordinator | null {
  if (coordinator !== undefined) return coordinator;

  const redis = redisClient();
  if (redis) {
    coordinator = new RedisScanCoordinator(redis);
  } else if (process.env.NODE_ENV === "production") {
    coordinator = null;
    if (!misconfigurationReported) {
      misconfigurationReported = true;
      void reportError({
        code: "RC_CONFIG_INVALID",
        message:
          "REDIS_URL missing in production — fresh scans disabled (PRD §10.4)",
        operation: "scanControl.resolveCoordinator",
      });
    }
  } else {
    coordinator = new MemoryScanCoordinator();
  }
  return coordinator;
}

/** Test hook: forget the resolved coordinator so env changes take effect. */
export function resetScanCoordinatorForTests(): void {
  coordinator = undefined;
  misconfigurationReported = false;
}

/**
 * One-way hash of the client IP (§10.2): rate keys must not store raw IPs.
 * Salted with a constant app tag; 24 hex chars keeps keys short while leaving
 * collisions irrelevant at rate-limit scale.
 */
export function hashClientIp(ip: string): string {
  return createHash("sha256").update(`rc-scan-ip:${ip.trim().toLowerCase()}`).digest("hex").slice(0, 24);
}

/** Client IP as seen through the nginx proxy headers; "unknown" groups the rest. */
export function clientIpFrom(headers: Headers): string {
  return clientIpFromHeaders(headers) ?? "unknown";
}
