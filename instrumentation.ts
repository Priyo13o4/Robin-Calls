/**
 * Next.js Instrumentation Hook (PRD §2, §6).
 *
 * Runs once when the Next.js server instance starts up.
 * Bootstraps the Arbitrum Nitro sequencer WebSocket ingestion stream in nodejs runtime
 * when enabled by feature flags and not in a build phase.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NEXT_PHASE === "phase-production-build") {
      return;
    }

    // Local smoke only: mirror prod's registry instead of re-deriving it over RPC (lib/sync/pull.ts).
    const { syncPullConfig, startSyncPull } = await import("@/lib/sync/pull");
    const sync = syncPullConfig();
    if (sync) startSyncPull(sync);

    const { flags } = await import("@/lib/config/flags");
    if (!flags.sequencerIngest) {
      return;
    }

    const { startSequencerService } = await import("@/lib/sequencer/service");
    startSequencerService();
  }
}
