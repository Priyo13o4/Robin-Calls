#!/usr/bin/env bash
# Render the authored city and publish it to the site in one step.
#
#   scripts/city/publish.sh [path/to/robincalls-city.blend]
#
# Renders every layer, converts to webp, and REGENERATES app/tokenomics/
# city-manifest.ts from the same render. The manifest and the art must always
# be produced together: ship new art with stale boxes and the buildings move
# while the click targets stay behind, with nothing failing to say so.
#
# Filenames carry a content hash of the whole render. Fixed names meant a new
# render reused every URL, and Cloudflare rewrites this origin's `max-age=0`
# into `max-age=14400` — so a returning browser kept the previous town under
# the current hit boxes for four hours. A hash makes a new render a new URL,
# which no cache can answer from the old one.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BLEND="${1:-$ROOT/original-assets/city/robincalls-city.blend}"
TMP="$(mktemp -d)"
DEST="$ROOT/public/tokenomics/city"

# 1:1 — the town's own footprint is square from this camera, so any wider
# shape pays for it in empty ground on the left and right, and the panel then
# ends far short of the table beside it. Change this and re-check both columns.
blender -b "$BLEND" -P "$ROOT/scripts/city/render_city.py" -- \
  --out "$TMP" --size "${SIZE:-1400}" --aspect "${ASPECT:-1:1}"

# One token for the whole set, not one per file: the layers are a single
# projection and must never be mixed across renders. `sort` pins the order so
# the same render always hashes the same.
VER="$(find "$TMP" -name '*.png' -print0 | sort -z | xargs -0 cat | shasum -a 256 | cut -c1-10)"

mkdir -p "$DEST"; rm -f "$DEST"/*.webp
for f in "$TMP"/*.png; do
  ffmpeg -y -hide_banner -loglevel error -i "$f" -c:v libwebp -q:v 86 -compression_level 6 \
    "$DEST/$(basename "${f%.png}").$VER.webp"
done

python3 "$ROOT/scripts/city/write_manifest.py" "$TMP/city.json" "$ROOT/app/tokenomics/city-manifest.ts" "$VER"
echo "published $(du -sh "$DEST" | cut -f1) to public/tokenomics/city @ $VER"
rm -rf "$TMP"
