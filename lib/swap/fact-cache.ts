// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



export function factCache<V>(ttlMs: number, maxEntries: number, start: (load: () => Promise<V>) => Promise<V> = undefined as any): { get(key: string, load: () => Promise<V>, keep?: (value: V) => boolean): Promise<V>; peek(key: string): V | undefined; clear(): void; delete(key: string): void; } {
  throw new NotImplementedInPublicBuild("lib/swap/fact-cache.ts#factCache");
}