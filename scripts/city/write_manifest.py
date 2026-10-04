"""city.json -> app/tokenomics/city-manifest.ts. Called by publish.sh.

argv: <city.json> <dest.ts> <version>

`version` is the content hash publish.sh computed over the whole render, and it
goes into every filename. See the CITY.ver comment in the emitted file.
"""
import json, sys

src, dest = sys.argv[1], sys.argv[2]
ver = sys.argv[3] if len(sys.argv) > 3 else ""
sfx = f".{ver}" if ver else ""
m = json.load(open(src))
rows = sorted(m["buildings"], key=lambda b: -b["depth"])
body = "\n".join(
    '    { key: "%s", file: "%s", box: [%d, %d, %d, %d], depth: %s },'
    % (b["key"], b["file"].replace(".webp", sfx + ".webp"), *b["box"], b["depth"])
    for b in rows)

open(dest, "w").write('''/**
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
  w: %d,
  h: %d,
  dir: "/tokenomics/city",
  /** Content hash of this render — already baked into every filename below. */
  ver: "%s",
  ground: "ground%s.webp",
  buildings: [
%s
  ] satisfies CityBuilding[] as CityBuilding[],
} as const;

/** Furthest first — the paint order the layers must stack in. */
export const CITY_PAINT_ORDER = [...CITY.buildings].sort((a, b) => b.depth - a.depth);
''' % (m["w"], m["h"], ver, sfx, body))
print(f"[manifest] {len(rows)} buildings, {m['w']}x{m['h']} -> {dest}")
