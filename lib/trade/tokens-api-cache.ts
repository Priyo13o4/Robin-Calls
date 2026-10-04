import type { SelectableToken } from "./types";
import { factCache } from "../swap/fact-cache";

const tokens = factCache<SelectableToken[]>(30_000, 256);

/** Bound completed searches and share pending refills; failures remain retryable. */
export function readCachedTokens(query: string, load: () => Promise<SelectableToken[]>): Promise<SelectableToken[]> {
  return tokens.get(query.trim().toLowerCase(), load);
}

/** Clears the process-local API cache between isolated tests. */
export function resetTokenApiCache(): void {
  tokens.clear();
}
