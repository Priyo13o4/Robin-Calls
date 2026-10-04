/**
 * Night Market filter vocabulary — ONE definition, read by the picker and by
 * the SQL that answers it.
 *
 * The buckets used to live only in the client component, which filtered the
 * rows it had already downloaded. That made every filter a filter over page 1:
 * picking "$100K+" searched ~60 of ~956 rows and reported the result as though
 * it had searched the chain. Moving the predicate to the database means the
 * ranges have two consumers, and two copies would drift silently — so they live
 * here and neither side owns them.
 *
 * `max` is EXCLUSIVE, `min` inclusive. An open-ended top bucket uses Infinity,
 * which the SQL side reads as "no upper bound" rather than emitting a
 * comparison against it.
 */
export interface FilterBucket {
  key: string;
  label: string;
  min: number;
  max: number;
}

/** Card age since creation, in minutes. */
export const TIME_BUCKETS: readonly FilterBucket[] = [
  { key: "1h", label: "< 1H", min: 0, max: 60 },
  { key: "6h", label: "1H – 6H", min: 60, max: 6 * 60 },
  { key: "24h", label: "6H – 24H", min: 6 * 60, max: 24 * 60 },
  { key: "3d", label: "1D – 3D", min: 24 * 60, max: 3 * 24 * 60 },
  { key: "3d+", label: "3D+", min: 3 * 24 * 60, max: Number.POSITIVE_INFINITY },
];

/** Traction thresholds mirror the plan's $5k/$10k gate as the natural first cut. */
export const LIQUIDITY_BUCKETS: readonly FilterBucket[] = [
  { key: "lt5k", label: "< $5K", min: 0, max: 5_000 },
  { key: "5-25k", label: "$5K – $25K", min: 5_000, max: 25_000 },
  { key: "25-100k", label: "$25K – $100K", min: 25_000, max: 100_000 },
  { key: "100k+", label: "$100K+", min: 100_000, max: Number.POSITIVE_INFINITY },
];

export const VOLUME_BUCKETS: readonly FilterBucket[] = [
  { key: "lt10k", label: "< $10K", min: 0, max: 10_000 },
  { key: "10-50k", label: "$10K – $50K", min: 10_000, max: 50_000 },
  { key: "50-250k", label: "$50K – $250K", min: 50_000, max: 250_000 },
  { key: "250k+", label: "$250K+", min: 250_000, max: Number.POSITIVE_INFINITY },
];

/**
 * Bonding-only "size" dimension, in PERCENT filled. Not a market-cap filter —
 * a pre-DEX bonding curve has no market price to derive one from.
 */
export const PROGRESS_BUCKETS: readonly FilterBucket[] = [
  { key: "lt25", label: "< 25%", min: 0, max: 25 },
  { key: "25-50", label: "25% – 50%", min: 25, max: 50 },
  { key: "50-75", label: "50% – 75%", min: 50, max: 75 },
  { key: "75+", label: "75%+", min: 75, max: Number.POSITIVE_INFINITY },
];

/** DIRECT_DEX rows have no launchpad row to pick — a stable synthetic key. */
export const DIRECT_DEX_KEY = "__direct_dex__";

export interface LaunchFilters {
  time: string[];
  liquidity: string[];
  volume: string[];
  progress: string[];
  launchpads: string[];
}

export const EMPTY_LAUNCH_FILTERS: LaunchFilters = {
  time: [],
  liquidity: [],
  volume: [],
  progress: [],
  launchpads: [],
};

export function hasAnyFilter(f: LaunchFilters): boolean {
  return (
    f.time.length + f.liquidity.length + f.volume.length + f.progress.length + f.launchpads.length >
    0
  );
}

/** Keys that survive validation against a bucket set, deduped and capped. */
function validKeys(raw: string | null, buckets: readonly FilterBucket[]): string[] {
  if (!raw) return [];
  const allowed = new Set(buckets.map((b) => b.key));
  return [...new Set(raw.split(",").map((s) => s.trim()))].filter((k) => allowed.has(k));
}

/**
 * Parse filters off a public query string.
 *
 * Unknown keys are DROPPED, never passed through: this is an unauthenticated
 * endpoint and a bucket key reaches a SQL comparison (§6). Launchpad slugs are
 * shape-checked and capped rather than matched against the registry — the query
 * joins the pad table anyway, so an unknown slug returns nothing rather than
 * anything unsafe.
 */
export function parseLaunchFilters(params: URLSearchParams): LaunchFilters {
  const pads = (params.get("pads") ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s === DIRECT_DEX_KEY || /^[a-z0-9][a-z0-9-]{0,38}$/.test(s));

  return {
    time: validKeys(params.get("time"), TIME_BUCKETS),
    liquidity: validKeys(params.get("liq"), LIQUIDITY_BUCKETS),
    volume: validKeys(params.get("vol"), VOLUME_BUCKETS),
    progress: validKeys(params.get("prog"), PROGRESS_BUCKETS),
    launchpads: [...new Set(pads)].slice(0, 20),
  };
}

/**
 * Serialise for the client's fetch. Mirror of parseLaunchFilters.
 *
 * **Every key is percent-encoded.** Four bucket keys end in `+` (`100k+`,
 * `250k+`, `75+`, `3d+`) and `URLSearchParams` decodes a raw `+` as a SPACE, so
 * an unencoded `liq=100k+` arrives as `100k` — a key no bucket owns, silently
 * dropped by the validator. The filter would have looked wired and selected
 * nothing. Commas stay literal; they are legal in a query value and are the
 * separator.
 */
export function launchFiltersToQuery(f: LaunchFilters): string {
  const enc = (keys: string[]) => keys.map(encodeURIComponent).join(",");
  const parts: string[] = [];
  if (f.time.length) parts.push(`time=${enc(f.time)}`);
  if (f.liquidity.length) parts.push(`liq=${enc(f.liquidity)}`);
  if (f.volume.length) parts.push(`vol=${enc(f.volume)}`);
  if (f.progress.length) parts.push(`prog=${enc(f.progress)}`);
  if (f.launchpads.length) parts.push(`pads=${enc(f.launchpads)}`);
  return parts.join("&");
}

/** The [min, max) ranges a set of selected keys resolves to. */
export function rangesFor(
  keys: readonly string[],
  buckets: readonly { key: string; min: number; max: number }[]
): { min: number; max: number }[] {
  return buckets.filter((b) => keys.includes(b.key)).map((b) => ({ min: b.min, max: b.max }));
}
