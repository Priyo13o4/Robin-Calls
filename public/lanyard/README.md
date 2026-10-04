# Lanyard assets

`app/components/site/Lanyard.tsx` needs two binaries, both present here. If
either goes missing the component mounts, suspends, and never resolves — there
is no error, just a canvas that stays empty.

| File | What it is |
| --- | --- |
| `card.glb` | The card model. Carries three meshes — `card`, `clip`, `clamp` — and a `base` material whose map is the texture atlas the component composites onto. Upstream's, React Bits atom logo and all — which is why `faceBackground` exists. |
| `band-robincalls.png` | **The strap texture, tiled along the band.** Ours. What `LANYARD_BAND_URL` points at. |
| `band-robincalls.svg` | The source the PNG is rasterised from. Not loaded at runtime. |

`card.glb` comes from the React Bits repo, `src/assets/lanyard/`. Their strap
(`lanyard.png`, Atom logo down the band) was deleted once ours was wired; it was
never committed, so re-fetch it from that repo if a future port needs to diff.

## The band

**Edit the SVG, then regenerate the PNG** — the SVG is not loaded at runtime.
Rasterising rather than loading it directly removes a whole class of doubt
(intrinsic sizing, `texImage2D` support, and the fact that no webfont loads
inside an `<img>`-rendered SVG anyway, so what a rasteriser produces is exactly
what a browser would):

```bash
node -e "require('sharp')('public/lanyard/band-robincalls.svg',{density:200}).resize(1025,250,{fit:'fill'}).png({compressionLevel:9}).toFile('public/lanyard/band-robincalls.png').then(i=>console.log(i))"
```

Two things about the artwork that are easy to get backwards, both of which were:

- **The texture's X axis runs ALONG the strap, Y across it.** The material maps
  U along the line and V across it, so type set normally in the SVG reads down
  the hanging band. Rotating it 90° puts the wordmark on the 250px axis, where it
  does not fit — the first version ran clean off the strap and only its middle
  three letters were ever visible. Size type against 250, not 1025.
- **`repeat` must stay positive.** Upstream uses `[-4, 1]`; a negative repeat
  samples the texture backwards, which is invisible on an abstract strap and a
  mirror image on one with a wordmark.

## Why they are paths and not imports

Upstream does `import cardGLB from './card.glb'`, which needs Vite's
`assetsInclude: ['**/*.glb']` plus an ambient `declare module '*.glb'`. We are on
Next 16 / Turbopack, so they are served from here as plain URLs
(`/lanyard/card.glb`, `/lanyard/band-robincalls.png`) and the component takes them as
constants it can override per instance. **Do not convert these to bundler
imports** — the override is what lets a verdict swap the card's faces at runtime
without a rebuild.

## Editing them

- `card.glb` — <https://modelviewer.dev/editor/> will retexture it in the browser.
  For the RobinCalls verdict card you should not need to: pass `frontImage` /
  `backImage` instead and the component composites them into the atlas
  (front = left half, back = right half), aspect-preserving.
- The band — see above. `lanyardWidth` widens it if a replacement needs more room.

Note that the card's **face artwork** is not here at all: it is generated per
verdict by `app/api/og/[id]/route.tsx` (`?layout=portrait`, 764×1200, sized to
this model's own face rect) and composited at runtime.
