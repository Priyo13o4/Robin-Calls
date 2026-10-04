/**
 * The city layout, emitted by scripts/city/render_city.py alongside the webp
 * layers in public/tokenomics/city/.
 *
 * GENERATED — do not hand-edit. Run scripts/city/publish.sh, which rewrites
 * this file and the art together. They must ship as one: new art with stale
 * boxes moves the buildings and leaves the click targets behind, and nothing
 * would fail — the picture would simply stop agreeing with what it responds to.
 *
 * Checked in as TypeScript rather than fetched at runtime because the hit
 * targets have to exist on the first paint, not a network round-trip later.
 *
 * FILENAMES CARRY A CONTENT HASH, and that is load-bearing rather than tidy.
 * The layers used to publish at fixed names, so a new render reused every URL
 * and every cache in the path was free to keep the old picture: Cloudflare
 * rewrites the origin's `max-age=0` to `max-age=14400`, so a browser that had
 * seen the page held the previous town for four hours with the CURRENT hit
 * boxes over it — the art and the manifest disagreeing, silently, which is the
 * exact failure the paragraph above says must not happen. A hash in the name
 * makes a new render a new URL, so no cache can serve the old one.
 */
export interface CityBuilding {
  /** Matches `city` on the allocation row in lib/sale/tokenomics.ts. */
  key: string;
  file: string;
  /** [x0, y0, x1, y1] in render pixels — the sprite's bounding box. */
  box: [number, number, number, number];
  /** Painter's order: larger is further from the camera, so it paints first. */
  depth: number;
}

export const CITY = {
  /** Render dimensions. Every box is in this coordinate space. */
  w: 1400,
  h: 1400,
  dir: "/tokenomics/city",
  /** Content hash of this render — already baked into every filename below. */
  ver: "bf39015f82",
  ground: "ground.bf39015f82.webp",
  buildings: [
    { key: "airdrop", file: "b_airdrop.bf39015f82.webp", box: [556, 20, 699, 340], depth: 45.5307 },
    { key: "treasury", file: "b_treasury.bf39015f82.webp", box: [638, 259, 912, 577], depth: 44.5662 },
    { key: "fair_launch", file: "b_fair_launch.bf39015f82.webp", box: [327, 340, 706, 750], depth: 43.828 },
    { key: "platform", file: "b_platform.bf39015f82.webp", box: [869, 590, 1125, 904], depth: 42.4952 },
    { key: "liquidity", file: "b_liquidity.bf39015f82.webp", box: [746, 731, 954, 969], depth: 42.341 },
    { key: "team", file: "b_team.bf39015f82.webp", box: [514, 934, 727, 1151], depth: 40.9222 },
    { key: "dev", file: "b_dev.bf39015f82.webp", box: [435, 1033, 593, 1201], depth: 40.6133 },
  ] satisfies CityBuilding[] as CityBuilding[],
} as const;

/** Furthest first — the paint order the layers must stack in. */
export const CITY_PAINT_ORDER = [...CITY.buildings].sort((a, b) => b.depth - a.depth);
