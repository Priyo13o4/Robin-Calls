# The allocation city

`/tokenomics` section 01 is a fake-3D western town: one building per
allocation, each lifting off its plot on hover and highlighting its row in the
split table. The buildings are 2D sprites — full-frame transparent renders from
one Blender camera, stacked at 0,0 in the browser.

## You arrange it, the script extracts it

Open `robincalls-city.blend`, move things, save. The layout lives in the
`.blend`; no script needs editing.

The pack lives in `original-assets/city/` (gitignored, and excluded from the
Docker image). Textures are RELATIVE to the blend, so the folder moves as one.

```bash
scripts/city/publish.sh          # defaults to original-assets/city/robincalls-city.blend
```

That renders every layer, converts to webp, drops them in
`public/tokenomics/city/`, and regenerates `app/tokenomics/city-manifest.ts`.
Art and manifest are always written together — ship new art with stale boxes
and the buildings move while the click targets stay behind, with nothing
failing to say so.

Published filenames carry a content hash (`ground.f95d5afc02.webp`). Fixed
names meant a new render reused every URL, and Cloudflare rewrites this
origin's `max-age=0` into `max-age=14400` — so a returning browser kept the
previous town under the current hit boxes for four hours, art and manifest
disagreeing exactly as the paragraph above forbids. Never hand-write these
names anywhere; read them from the manifest.

## Framing

The camera's ANGLE is authored; its zoom and centre are fitted to the
allocation buildings by default. Pass `--camera` to `render_city.py` to hand
framing entirely to `CITY_CAM` — then Blender's camera view IS the published
frame. `CITY_CAM` as shipped points at bare ground ten units off the town, so
`--camera` on it refuses rather than publishing a picture of dirt; aim it first.

## What the renderer looks for

| Collection | Meaning |
| --- | --- |
| `ALLOCATIONS` | One object per allocation, named `alloc_<key>`. Each becomes its own interactive layer. |
| `SCENERY` | Dressing. Baked into the ground plate, never interactive. Add as much as you like. |
| `SET` | Ground, roads, `CITY_CAM`, `CITY_SUN`. |

`<key>` must match `city` on the row in `lib/sale/tokenomics.ts`:
`fair_launch`, `liquidity`, `dev`, `platform`, `airdrop`, `treasury`, `team`.
A test fails if a row has no building or a building has no row.

## Three things that will break it

1. **`CITY_CAM` must stay ORTHOGRAPHIC.** Perspective gives every layer its own
   vanishing point and the stack stops lining up. Orbit and zoom freely.
2. **Don't rename `alloc_*` objects.** The suffix is the join to the split.
3. **Turning a building past ~120° shows its back.** These low-poly models have
   no back wall, so the plate shows straight through the sprite. Yaw 0 and 90
   are the two good facings; anything near 180 or 270 is the back.

Sockets (the plot revealed on hover) and boardwalks are generated at render
time from each building's own transform, so they follow it when you move or
rotate it. Don't author them by hand.

Framing is computed from the `ALLOCATIONS` objects only — scenery may bleed off
the edge on purpose. A prop in a far corner deciding the zoom is what made the
buildings shrink.

## Rebuilding the .blend from the raw pack

Only needed if the source pack changes:

```bash
cd original-assets/city
blender -b "Westen building pack.blend" -P ../../scripts/city/build_city_blend.py -- --out robincalls-city.blend
blender -b robincalls-city.blend -P ../../scripts/city/relink_textures.py -- --save
```

That relinks all 101 textures by basename and rebuilds the materials: the
2.7x→5.x conversion left Principled BSDFs with **no image nodes at all** while
keeping the legacy Texture datablocks. Concatenating the two texture series in
numeric order gives 39 + 20 = exactly 59 textures for 59 materials, and at that
mapping every sign lands on its own building. The count matching exactly and
the signage being right are two independent confirmations — redo both if the
pack is ever re-exported, because a wrong mapping renders silently.

`relink_textures.py` repoints every image at the `Texture/` folder beside the
blend and makes the path relative. Run it after any move or re-export: a blend
whose textures have moved renders UNTEXTURED with a zero exit code — flat grey
buildings and a successful publish — so the script fails loudly on a missing
file instead.
