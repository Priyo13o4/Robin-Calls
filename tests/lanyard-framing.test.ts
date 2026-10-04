import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ANCHOR_WORLD_Y,
  BORDER_INSET_FRAC,
  CAMERA_DISTANCE,
  CAMERA_FOV_DEG,
  FRONT_UV_RECT,
  ROPE_SEGMENTS,
  ROPE_SEGMENT_LENGTH,
  anchorFractionFromTop,
  anchorOffsetPx,
  cardRestBottomWorldY,
  contentRectFor,
  halfViewHeight,
  shareBandTopFraction,
} from "../app/components/site/lanyard-geometry";

/**
 * The lanyard hangs over the verdict page from above it. The single thing that
 * makes that read as a lanyard rather than as a floating string is that the
 * rope's anchor is OFF SCREEN — and nothing in this repo can see whether it is.
 * The preview pane fires zero animation frames, so WebGL never paints there;
 * a screenshot comes back black whether the framing is right or wrong.
 *
 * So the geometry is arithmetic, and the arithmetic is tested. What this
 * catches is the realistic edit: someone changes the camera to make the card
 * bigger, the anchor moves down the canvas, the lift does not follow, and the
 * strap's origin reappears in the middle of the page. It typechecks. It
 * renders. It is just wrong, and only an eye would ever have noticed.
 */

const ROOT = join(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

test("lanyard geometry: the anchor fraction follows from the camera", () => {
  // Recomputed here from first principles rather than pinned to a literal, so
  // this fails on a wrong FORMULA and not merely on an intended camera change.
  const halfHeight = CAMERA_DISTANCE * Math.tan((CAMERA_FOV_DEG * Math.PI) / 360);
  const expected = (1 - ANCHOR_WORLD_Y / halfHeight) / 2;

  assert.ok(Math.abs(anchorFractionFromTop() - expected) < 1e-12);
  // Sanity on the direction: the anchor is above centre, so in the top half.
  assert.ok(anchorFractionFromTop() > 0, "anchor is above the top of the canvas");
  assert.ok(anchorFractionFromTop() < 0.5, "anchor should sit in the upper half");
});

test("lanyard geometry: the offset scales with canvas height, not world extent", () => {
  // A vertical fov fixes the world extent, so doubling the element's height
  // doubles the pixel offset. This is exactly why a canvas sized to its own
  // container can never hide the anchor — the property the layout depends on.
  assert.equal(anchorOffsetPx(1000), anchorOffsetPx(500) * 2);
  assert.equal(anchorOffsetPx(0), 0);
});

/** The constants the layout is built from, read out of the component's source. */
function framingConstants() {
  const src = read("app/components/site/VerdictLanyard.tsx");
  const num = (re: RegExp, name: string) => {
    const v = Number(re.exec(src)?.[1]);
    assert.ok(Number.isFinite(v), `${name} not found in VerdictLanyard.tsx`);
    return v;
  };
  return {
    src,
    baseHeight: num(/const BASE_SCENE_HEIGHT = ([\d.]+)/, "BASE_SCENE_HEIGHT"),
    baseClearance: num(/const BASE_ANCHOR_ABOVE_SECTION = ([\d.]+)/, "BASE_ANCHOR_ABOVE_SECTION"),
    scaleSm: num(/const SCALE_BELOW_LG = ([\d.]+)/, "SCALE_BELOW_LG"),
    scaleLg: num(/const SCALE_LG = ([\d.]+)/, "SCALE_LG"),
    leftSm: num(/const LAYER_LEFT_PCT_SM = ([\d.]+)/, "LAYER_LEFT_PCT_SM"),
    leftLg: num(/const LAYER_LEFT_PCT_LG = ([\d.]+)/, "LAYER_LEFT_PCT_LG"),
  };
}

/**
 * Measured live at 1440x900: the card renders ~259px across at scale 1, in a
 * layer 760px tall. Card width scales with canvas height (fixed world extent,
 * more pixels), so this is a ratio and not a pixel count.
 */
const CARD_WIDTH_PER_SCENE_HEIGHT = 259 / 760;

/** The strap hangs at the middle of the layer, which starts at `left`. */
const strapCenterPct = (left: number) => (100 + left) / 2;

/** The frame the component computes, reproduced here from the same inputs. */
function frameFor(baseHeight: number, baseClearance: number, scale: number) {
  const height = baseHeight * scale;
  return { height, lift: anchorOffsetPx(height) + baseClearance * scale };
}

test("lanyard framing: the lift clears the anchor at every scale", () => {
  const { src, baseHeight, baseClearance, scaleSm, scaleLg } = framingConstants();

  // The lift must be DERIVED from the anchor offset. A hardcoded pixel value
  // here is the whole failure mode: it would not move when the camera does.
  assert.match(
    src,
    /lift: anchorOffsetPx\(height\) \+ BASE_ANCHOR_ABOVE_SECTION \* scale/,
    "the lift must be derived from anchorOffsetPx, not written as a literal"
  );

  // The verdict section starts ~284px down the page at desktop and ~315px on a
  // phone (both measured live). An anchor below that line is painted on screen,
  // which is the bug this layout exists to fix.
  for (const [scale, sectionTop, label] of [
    [scaleSm, 315, "below lg"],
    [scaleLg, 284, "lg"],
  ] as const) {
    const { height, lift } = frameFor(baseHeight, baseClearance, scale);
    const anchorViewportY = sectionTop - lift + anchorOffsetPx(height);
    assert.ok(
      anchorViewportY < 0,
      `at ${label} the anchor sits ${Math.round(anchorViewportY)}px INTO the viewport`
    );
  }
});

test("lanyard framing: scaling is uniform, so the composition survives it", () => {
  const { baseHeight, baseClearance } = framingConstants();

  // Height and lift must scale together. Scaling only the height would make the
  // rope longer on screen and push the card that much further down the page —
  // "bigger" would quietly also mean "lower", which is not what anyone asks for.
  const one = frameFor(baseHeight, baseClearance, 1);
  const two = frameFor(baseHeight, baseClearance, 2);
  assert.equal(two.height, one.height * 2);
  assert.ok(Math.abs(two.lift - one.lift * 2) < 1e-9, "lift must scale with height");
});

test("lanyard framing: the card has room to swing at both breakpoints", () => {
  const { baseHeight, baseClearance, scaleSm, scaleLg, leftSm, leftLg } =
    framingConstants();

  // Two different requirements, because the two breakpoints are constrained
  // differently. At `lg` the layer is an inset I chose inside a 1152px section,
  // so swing room is a real dial: "fits at rest" would be the wrong test for a
  // pendulum. Below `lg` the layer's right edge IS the screen edge and there is
  // no wider option — a hard fling clips there no matter what — so the only
  // thing worth asserting is that it is whole when it is hanging still.
  const SWING_ROOM = 1.3;
  const REST_MARGIN = 1.05;

  const NARROWEST_VIEWPORT = 375; // iPhone SE / mini, and the `sm` design target
  const SECTION_WIDTH = 1152; // max-w-6xl

  // The card is CENTRED ON THE STRAP, not on the screen, and below `lg` the
  // strap is deliberately off-centre — it sat straight down the middle of the
  // score otherwise. So a width test alone is not enough any more: the failure
  // it has to catch is "shifted right until the right-hand edge hangs off the
  // phone", which a card narrower than the viewport passes happily.
  const sm = frameFor(baseHeight, baseClearance, scaleSm);
  const smHalf = (sm.height * CARD_WIDTH_PER_SCENE_HEIGHT * REST_MARGIN) / 2;
  const smCenter = (strapCenterPct(leftSm) / 100) * NARROWEST_VIEWPORT;
  assert.ok(
    smCenter + smHalf <= NARROWEST_VIEWPORT,
    `below lg the card's right edge is ${Math.round(smCenter + smHalf)}px into a ${NARROWEST_VIEWPORT}px viewport — clipped at rest`
  );
  assert.ok(
    smCenter - smHalf >= 0,
    `below lg the card's left edge is at ${Math.round(smCenter - smHalf)}px — clipped at rest`
  );
  // And it has to actually be off centre, or the fix is only in the comments.
  assert.ok(
    leftSm > 0,
    "below lg the layer must be inset, or the card hangs down the middle of the score"
  );

  const lg = frameFor(baseHeight, baseClearance, scaleLg);
  const layerWidth = SECTION_WIDTH * (1 - leftLg / 100);
  assert.ok(
    lg.height * CARD_WIDTH_PER_SCENE_HEIGHT * SWING_ROOM < layerWidth,
    `at lg the card is ${Math.round(lg.height * CARD_WIDTH_PER_SCENE_HEIGHT)}px wide in a ${Math.round(layerWidth)}px layer — no room to swing`
  );
});

test("lanyard framing: the handle rides with the lanyard, on the strap", () => {
  const { src, leftSm, leftLg } = framingConstants();

  // The layer's own inset comes from the constants, through CSS variables —
  // Tailwind cannot interpolate a value into a class name, so a literal in the
  // className is the failure mode here (§8 #11).
  assert.match(src, /"--ly-left": `\$\{LAYER_LEFT_PCT_SM\}%`/);
  assert.match(src, /"--ly-left-lg": `\$\{LAYER_LEFT_PCT_LG\}%`/);
  assert.match(src, /left-\[var\(--ly-left\)\]/, "the layer must use --ly-left");
  assert.match(src, /lg:left-\[var\(--ly-left-lg\)\]/);

  // The handle belongs to the LANYARD, so it scrolls away with it — `absolute`,
  // in the section's flow, never `fixed`. Pinned to the viewport it followed the
  // reader down the page and hovered over unrelated content, which is the one
  // thing the card itself deliberately does not do.
  const button = /<button[\s\S]*?<\/button>/.exec(src)?.[0];
  assert.ok(button, "the dismiss control is gone");
  assert.match(button, /\babsolute\b/, "the handle must ride with the page, like the card");
  assert.doesNotMatch(button, /\bfixed\b/, "a fixed handle follows the reader down the page");
  assert.match(button, /-translate-x-1\/2/, "centred on the strap, not starting at it");

  // It hugs the top of the SCREEN, not the top of its containing block. The
  // section starts hundreds of pixels down the page, so `top-0` lands the handle
  // level with the market panel — a stray control dropped on the chart. Both
  // breakpoints subtract the section's measured document offset; a bare `top-0`
  // here is the regression.
  assert.match(
    button,
    /top-\[calc\(78px-var\(--ly-section-top\)\)\]/,
    "below lg the handle must sit at the page top, clear of the sticky nav"
  );
  assert.match(button, /lg:top-\[calc\(16px-var\(--ly-section-top\)\)\]/);
  assert.match(
    button,
    /"--ly-section-top": `\$\{sectionTop\}px`/,
    "the offset must reach the button, or the calc resolves against nothing"
  );
  assert.match(
    src,
    /setSectionTop\(r\.top \+ window\.scrollY\)/,
    "the section's DOCUMENT offset is the number — a viewport-relative one changes on scroll"
  );
  // Measured once on mount it would freeze at the pre-hydration header height.
  // What moves it is content ABOVE the section changing size, which never
  // resizes the window — so the observer is on <body>, not on the layer.
  assert.match(src, /ro\?\.observe\(document\.body\)/, "the handle must track the header growing");
  assert.match(src, /\{sectionTop !== null && \(/, "unmeasured, the handle would flash at the section's top");

  // Its x is DERIVED from the layer's inset, not written down a second time:
  // both are `absolute` inside the same section, so the percentages agree, and
  // a literal here is a control that drifts off the thing it controls.
  assert.match(
    src,
    /"--ly-strap": `\$\{strapCenterPct\(LAYER_LEFT_PCT_SM\)\}%`/,
    "the strap position must be derived from the inset"
  );
  assert.match(src, /"--ly-strap-lg": `\$\{strapCenterPct\(LAYER_LEFT_PCT_LG\)\}%`/);
  assert.match(button, /left-\[var\(--ly-strap\)\]/, "the handle must sit on the strap");
  assert.match(button, /lg:left-\[var\(--ly-strap-lg\)\]/);
  assert.match(button, /\.\.\.LAYER_VARS/, "the button needs the layer's vars in scope to read --ly-strap");

  // Sanity on the arithmetic, independent of the source strings.
  assert.equal(strapCenterPct(leftSm), (100 + leftSm) / 2);
  assert.ok(strapCenterPct(leftLg) > strapCenterPct(leftSm), "lg hangs further right");
});

test("lanyard card art: the browser cannot serve a stale card face", () => {
  // `/api/og/[id]` is cached an hour by the browser AND the CDN, keyed on URL.
  // Correct for a link preview; during a redesign it means the type can be
  // doubled, the container rebuilt, and the page still shows the old art with
  // nothing to distinguish a cache from a failed deploy. This is the only thing
  // that makes the URL differ, so it has to be IN the URL, on both faces.
  const frame = read("app/components/site/VerdictLanyard.tsx");
  assert.match(frame, /const CARD_ART_VERSION = \d+;/, "no art version to bump");
  assert.equal(
    frame.match(/\?layout=portrait&art=\$\{CARD_ART_VERSION\}/g)?.length,
    2,
    "both faces must carry the art version, or one of them keeps serving the old card"
  );
});

test("lanyard rig: the card starts hanging, not swinging", () => {
  // Upstream spawns the rope along +x and lets gravity swing it down — a
  // pendulum released from 90°, which for the first second throws the card
  // across most of the layer. It flew straight over the dismiss handle at the
  // top of the screen. Hanging from the start it is already at equilibrium.
  const scene = read("app/components/site/Lanyard.tsx");
  const spawns = scene.match(/position=\{\[LAUNCH_SWAY[^\]]*\]\}/g) ?? [];
  assert.equal(spawns.length, 4, "every rope link and the card must spawn on the rope, not beside it");
  for (const s of spawns) {
    assert.match(s, /-ROPE_SEGMENT_LENGTH/, `${s} does not hang below the anchor`);
  }
  // A perfectly straight chain is degenerate for the solver, so the sway must
  // be non-zero — but small, or this reintroduces the swing it exists to avoid.
  const sway = Number(/const LAUNCH_SWAY = ([\d.]+);/.exec(scene)?.[1]);
  assert.ok(sway > 0 && sway < ROPE_SEGMENT_LENGTH / 10, `LAUNCH_SWAY is ${sway}`);
});

test("lanyard ribbon: a longer rope cannot drop the card out of the canvas", () => {
  // `ROPE_SEGMENT_LENGTH` is the ribbon dial, and it is the one knob with a
  // hard ceiling: the canvas shows a fixed world extent, so past some length
  // the card hangs below the bottom edge and is cut in half at rest. Nothing
  // in the layout can recover that — the lift only moves the whole rig.
  assert.ok(
    cardRestBottomWorldY() > -halfViewHeight(),
    `card bottom rests at y=${cardRestBottomWorldY().toFixed(2)}, below the canvas edge at y=${(-halfViewHeight()).toFixed(2)}`
  );

  // And it must actually hang: a rope shorter than the card is a clasp.
  assert.ok(
    ROPE_SEGMENTS * ROPE_SEGMENT_LENGTH > 1,
    "the rope has to be long enough to read as a strap"
  );
});

test("lanyard ribbon: the rope constants match the joints that build it", () => {
  // §8 #10. `cardRestBottomWorldY` computes the drop from `ROPE_SEGMENTS`, so
  // if the component adds or drops a `useRopeJoint` the ceiling above silently
  // starts guarding a rope that does not exist — and the card is clipped with
  // every test still green.
  const scene = read("app/components/site/Lanyard.tsx");
  const joints = scene.match(/useRopeJoint\(/g)?.length ?? 0;
  assert.equal(
    joints,
    ROPE_SEGMENTS,
    `ROPE_SEGMENTS says ${ROPE_SEGMENTS} but Lanyard.tsx builds ${joints}`
  );
  assert.equal(
    scene.match(/\[\[0, 0, 0\], \[0, 0, 0\], ROPE_SEGMENT_LENGTH\]/g)?.length ?? 0,
    ROPE_SEGMENTS,
    "every rope joint must take its length from the shared constant"
  );
});

/** The card model's texture atlas dimensions, read out of `card.glb` itself. */
function atlasSize(): { width: number; height: number } {
  const buf = readFileSync(join(ROOT, "public/lanyard/card.glb"));
  let off = 12; // past the GLB header
  let json: { images?: { bufferView: number }[]; bufferViews?: { byteOffset?: number; byteLength: number }[] } | null = null;
  let bin: Buffer | null = null;
  while (off < buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString("utf8"));
    if (type === 0x004e4942) bin = data;
    off += 8 + len + (len % 4 ? 4 - (len % 4) : 0);
  }
  const view = json?.bufferViews?.[json?.images?.[0]?.bufferView ?? -1];
  assert.ok(json && bin && view, "could not read the atlas out of card.glb");
  const png = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  assert.equal(png.readUInt32BE(0), 0x89504e47, "atlas is not a PNG");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

test("lanyard face: the portrait OG matches the badge's own face rect", () => {
  // Two independent representations of one fact, reconciled — the model's
  // geometry, and a width/height pair typed into an API route. They drifted
  // once already: the 1200x630 link-preview card was being stuffed into a
  // portrait badge, and `cover` cropped 45% off the sides (the address, the
  // check names, the receipt hash). Nothing failed; it just looked wrong.
  const atlas = atlasSize();

  // The rect the art is actually drawn into — face, pulled in by the inset.
  const content = contentRectFor(FRONT_UV_RECT, BORDER_INSET_FRAC);
  const contentAspect = (content.w * atlas.width) / (content.h * atlas.height);

  const route = read("app/api/og/[id]/route.tsx");
  const w = Number(/const PORTRAIT_WIDTH = (\d+)/.exec(route)?.[1]);
  const h = Number(/const PORTRAIT_HEIGHT = (\d+)/.exec(route)?.[1]);
  assert.ok(Number.isFinite(w) && Number.isFinite(h), "portrait dimensions not found");

  // 1% — tighter than any letterboxing an eye would catch, loose enough that
  // the dimensions can stay round numbers.
  const drift = Math.abs(w / h - contentAspect) / contentAspect;
  assert.ok(
    drift < 0.01,
    `portrait OG is ${w}x${h} (aspect ${(w / h).toFixed(4)}) but the badge's face is ${contentAspect.toFixed(4)} — ${(drift * 100).toFixed(1)}% off, so the art will letterbox or crop`
  );

  const frame = read("app/components/site/VerdictLanyard.tsx");
  // BOTH faces, counted — not merely "portrait appears somewhere". Matching a
  // single occurrence passes while one face still fetches the landscape card,
  // and you would only find that by flipping the badge over.
  assert.equal(
    frame.match(/\/api\/og\/\$\{receiptId\}\?layout=portrait/g)?.length,
    2,
    "both card faces must request the portrait layout, not the link-preview one"
  );
  assert.match(route, /searchParams\.get\("layout"\) === "portrait"/, "the route must honour it");
});

test("lanyard face: the border is painted into the atlas, on both faces", () => {
  // The card's edges are `card.glb` geometry and cannot be restyled without the
  // model. The face is a canvas we composite, so a border is a paint — and it
  // has to be drawn on BOTH faces or flipping the card loses it.
  const scene = read("app/components/site/Lanyard.tsx");
  assert.match(scene, /drawBorder\(FRONT_UV_RECT\)/, "front face has no border");
  assert.match(scene, /drawBorder\(BACK_UV_RECT\)/, "back face has no border — flipping would lose it");
  // A border-only composite must still build: without this the early-out
  // returns the untouched atlas and the border silently never appears.
  // The early-out returns the untouched atlas when there is nothing to draw.
  // Every optional paint has to be listed in it, or that paint silently never
  // happens — a border or a background alone would be dropped on the floor.
  assert.match(
    scene,
    /if \(!frontImage && !backImage && !showShare && !faceBorder && !faceBackground\)/,
    "the composite early-out must account for a border AND a background"
  );
  assert.match(scene, /faceBorder,\n  \]\);/, "faceBorder must be a memo dependency or it will not repaint");
  // The card's corners are rounded geometry; a sharp border drawn flush to the
  // face rect has its corners fall outside the silhouette and get cut, which
  // reads as a curved border rather than a clipped one.
  assert.match(
    scene,
    /const rect = contentRectFor\(face, BORDER_INSET_FRAC\);/,
    "the border must be inset clear of the model's rounded corners"
  );
  assert.match(scene, /ctx\.strokeRect\(rx \+ d, ry \+ d, rw - 2 \* d, rh - 2 \* d\)/);

  // The art and the frame must be inset by the SAME rect. Inset the border
  // alone and a sliver of the source image survives in the margin outside it —
  // on the verdict card that was the tail of the "On-chain. On record."
  // tagline, reading as a stray word floating in the border. A frame that does
  // not contain what it frames is worse than no frame.
  assert.match(
    scene,
    /drawFitted\(frontTex\.image as LoadedImage, contentRectFor\(FRONT_UV_RECT, artInset\)\)/,
    "front art must be drawn into the content rect, not the full face"
  );
  assert.match(
    scene,
    /drawFitted\(backTex\.image as LoadedImage, contentRectFor\(BACK_UV_RECT, artInset\)\)/,
    "back art must be drawn into the content rect, not the full face"
  );
  // No border, nothing to escape from — the full face is right in that case.
  assert.match(scene, /const artInset = faceBorder \? BORDER_INSET_FRAC : 0;/);

  const frame = read("app/components/site/VerdictLanyard.tsx");
  assert.match(frame, /faceBorder="#ccff00"/, "the verdict card must actually ask for one");

  // `cover` on a 1200x630 OG image in a PORTRAIT face crops ~45% off the
  // sides, and what lives there is text — the token address, the check names,
  // the receipt hash all ran off the card. Aspect mismatch, not a fit bug:
  // `contain` is the only setting that shows the whole thing.
  assert.match(
    frame,
    /imageFit="contain"/,
    "cover crops a landscape OG card to a portrait face and cuts the text off"
  );

  // `contain` and `faceBackground` are a PAIR. A contained image does not cover
  // its face, so without a fill the model's own baked texture — white paper
  // stock with the React Bits atom on it — shows through everywhere the art
  // does not reach, and the noir verdict card renders as a white badge with
  // someone else's logo on it. Fixing the crop is what exposed this.
  assert.match(
    frame,
    /faceBackground="#0a0a0a"/,
    "contain without a face background leaves the stock card texture showing"
  );
  assert.match(
    scene,
    /for \(const face of \[FRONT_UV_RECT, BACK_UV_RECT\]\) \{\n\s+ctx\.fillRect/,
    "both faces must be filled, or flipping the card reveals the stock texture"
  );
});

test("lanyard framing: the scene and the frame read the same camera", () => {
  // §8 #10 — assert the WIRING, not just the logic. Two modules agreeing by
  // coincidence is what this whole module exists to prevent, and a test that
  // only exercised the helper could never fail on a component that stopped
  // importing it.
  const scene = read("app/components/site/Lanyard.tsx");
  assert.match(scene, /from "\.\/lanyard-geometry"/, "Lanyard must read the shared camera");
  assert.match(scene, /position = \[0, 0, CAMERA_DISTANCE\]/, "camera distance must not be a literal");
  assert.match(scene, /fov = CAMERA_FOV_DEG/, "fov must not be a literal");
  assert.match(scene, /position=\{\[0, ANCHOR_WORLD_Y, 0\]\}/, "anchor height must not be a literal");

  const frame = read("app/components/site/VerdictLanyard.tsx");
  assert.match(frame, /anchorOffsetPx/, "VerdictLanyard must read the anchor offset");
});

test("lanyard framing: the scene is actually paused when it scrolls away", () => {
  // §8 #10 again — `paused` existed for a dismiss button that no longer does,
  // which made it a prop with no caller: the canvas would have run physics at
  // 60fps for the whole read of a page thousands of pixels long, entirely off
  // screen. A test on `Lanyard` alone could never fail on that; only the host's
  // wiring can.
  const frame = read("app/components/site/VerdictLanyard.tsx");
  assert.match(frame, /new IntersectionObserver/, "nothing observes whether the card is on screen");
  assert.match(frame, /paused=\{!onScreen \|\| dismissed\}/, "the observation — and the dismiss — must reach the scene");

  const scene = read("app/components/site/Lanyard.tsx");
  assert.match(
    scene,
    /frameloop=\{paused \? "never" : "always"\}/,
    "`paused` must stop the frame loop — that is what also stops the physics step"
  );
});

test("lanyard framing: the overlay cannot swallow clicks on the page", () => {
  // It lies across live content — highlight cards, addresses, the Robin Knight.
  // `Lanyard` handles its own input at the window, so the layer and the canvas
  // must both stay transparent to the pointer. Dropping either class turns the
  // whole upper page unclickable, and nothing else in the suite would notice.
  const frame = read("app/components/site/VerdictLanyard.tsx");
  assert.match(frame, /pointer-events-none absolute/, "the layer must not take pointer events");

  const scene = read("app/components/site/Lanyard.tsx");
  assert.match(scene, /pointerEvents: "none"/, "the canvas must not take pointer events");
  assert.match(
    scene,
    /window\.addEventListener\("pointerdown", onDown, true\)/,
    "input must be read at the window, or the card becomes undraggable"
  );
});

test("lanyard input: the card stays reachable over an iframe", () => {
  // Deviation 5 (window listeners) is not enough on this page. An iframe is a
  // separate browsing context: pointer events over it never reach this window,
  // and 92% of the card sits over the embedded GeckoTerminal chart — measured
  // live, not assumed. So the card was dead to the pointer across nearly its
  // whole face while every other check here passed.
  //
  // The shield is a div in OUR document tracking the card's projected box; the
  // iframe cannot receive events where it is. All three parts are load-bearing.
  const scene = read("app/components/site/Lanyard.tsx");
  assert.match(scene, /className="pointer-events-auto absolute left-0 top-0/, "shield must take pointer events");
  assert.match(scene, /onCardBounds\(minX, minY, maxX - minX, maxY - minY\)/, "shield must be measured from the card");
  assert.match(scene, /for \(let i = 0; i < 8; i\+\+\)/, "all eight corners — a turning card is widest at them");
  assert.match(
    scene,
    /display: paused \? "none" : undefined/,
    "a paused scene stops updating, so a visible shield would be stale and swallow clicks"
  );
});

/** The portrait branch of the OG route, on its own — the landscape card below
 *  it is a different layout with different constraints and must not be read. */
function portraitLayout(): string {
  const route = read("app/api/og/[id]/route.tsx");
  const body = /if \(portrait\) \{([\s\S]*?)\n {2}\}\n\n {2}return await bufferedImageResponse\(/.exec(route)?.[1];
  assert.ok(body, "the portrait branch of the OG route was not found");
  return body;
}

test("portrait card: the type survives the reduction onto the badge", () => {
  // The card is drawn at 764px wide and then composited onto a badge about
  // 270px across on a phone — a ~0.32x reduction that no preview of the OG
  // image itself ever shows you. The check names came out at ~8px, which is
  // what "the text is barely visible" was: nothing was wrong with the image.
  const { baseHeight, scaleSm } = framingConstants();

  const cardWidthPx = baseHeight * scaleSm * CARD_WIDTH_PER_SCENE_HEIGHT;
  // The art fills the CONTENT rect, not the whole face.
  const artWidthPx =
    cardWidthPx * (contentRectFor(FRONT_UV_RECT, BORDER_INSET_FRAC).w / FRONT_UV_RECT.w);

  const route = read("app/api/og/[id]/route.tsx");
  const portraitWidth = Number(/const PORTRAIT_WIDTH = (\d+)/.exec(route)?.[1]);
  assert.ok(Number.isFinite(portraitWidth));
  const onScreen = (fontSize: number) => (fontSize * artWidthPx) / portraitWidth;

  const body = portraitLayout();
  // The flag rows are the card's payload — the score is unmissable at any size,
  // but "FAIL · LP custody" is the part that has to be readable to mean
  // anything. Anchored on the row the flags are mapped into, so a change to
  // some other block cannot satisfy it by accident.
  const flagSize = Number(
    /flags\.map\(\(f\) => \([\s\S]*?fontSize: (\d+)/.exec(body)?.[1]
  );
  assert.ok(Number.isFinite(flagSize), "could not find the flag row's font size");
  assert.ok(
    onScreen(flagSize) >= 9,
    `the check rows render at ${onScreen(flagSize).toFixed(1)}px on a phone — set them larger in the portrait layout, the card cannot get any wider`
  );
});

test("portrait card: nothing is drawn under the painted share button", () => {
  // The lanyard paints SHARE over the lower part of the face AFTER the artwork,
  // so anything down there is buried — the receipt hash was, and read as a
  // smear behind the button. The reserve has to be DERIVED from the same rects
  // the compositor paints from; a round number typed in here is §8 #11 and
  // would silently stop covering the button the day the rect moved.
  const route = read("app/api/og/[id]/route.tsx");
  assert.match(
    route,
    /Math\.round\(PORTRAIT_HEIGHT \* \(1 - shareBandTopFraction\(\)\)\)/,
    "the reserved band must come from shareBandTopFraction(), not from a literal"
  );
  assert.match(
    portraitLayout(),
    /paddingBottom: PORTRAIT_SHARE_RESERVE/,
    "the reserve is computed but never applied — the layout still runs under the button"
  );

  // And the fraction itself has to be in the lower part of the card: a bug that
  // returned ~0 would "reserve" the whole face and pass the wiring checks above.
  const top = shareBandTopFraction();
  assert.ok(top > 0.6 && top < 0.95, `share band starts at ${top.toFixed(3)} of the card`);
});

test("lanyard band: the strap carries our wordmark, not React Bits'", () => {
  // `card.glb` ships with the React Bits atom baked into it, which is why the
  // face is repainted — but the STRAP is a separate texture and the port never
  // touched it, so their logo stayed on the ribbon long after the card was ours.
  // The replacement is the DEFAULT rather than a prop the host passes: an asset
  // that only appears when a caller remembers it is one forgotten prop away
  // from shipping the atom again (§8 #10 — a file with no callers).
  const scene = read("app/components/site/Lanyard.tsx");
  const band = /export const LANYARD_BAND_URL = "([^"]+)"/.exec(scene)?.[1];
  assert.equal(band, "/lanyard/band-robincalls.png");
  assert.ok(
    readFileSync(join(ROOT, "public", band!)).length > 0,
    "the band texture is referenced but not in public/ — the scene suspends forever, with no error"
  );

  // A negative repeat samples the texture backwards. On an abstract strap that
  // is invisible; on one with a WORDMARK on it, it is a mirror image.
  assert.match(scene, /repeat=\{\[4, 1\]\}/, "the band must not be sampled in reverse");
});

test("lanyard share: the second share button is hidden, not deleted", () => {
  // Two share buttons on one page — the painted one on the card and a real one
  // under the Robin Knight — was the redundancy. But the painted one is a hit
  // test on a texture inside an `aria-hidden` layer: it cannot be tabbed to and
  // is not announced. Deleting the real one would have removed the ONLY
  // keyboard and screen-reader route to sharing, and nothing would have said so.
  const frame = read("app/components/site/VerdictLanyard.tsx");
  const link = /<a\n\s+href=\{shareHref\}[\s\S]*?<\/a>/.exec(frame)?.[0];
  assert.ok(link, "the share link is gone entirely");
  assert.match(link, /SHARE ON X/);
  assert.match(
    link,
    /lanyardRuns\n\s+\? "sr-only focus-visible:not-sr-only/,
    "when the card is hanging the flat button must be visually hidden but still focusable"
  );
  // The other branch is the no-lanyard case, where it is the only control there
  // is and must be plainly visible.
  assert.match(link, /: "flex items-center gap-2 bg-\[#ededea\]/);
});

test("lanyard input: a gesture on the card cannot reach the page under it", () => {
  const scene = read("app/components/site/Lanyard.tsx");

  // Three separate leaks, and stopping one does nothing about the others:
  //  - `pointerdown` propagating to the page's own pointer handlers;
  //  - the COMPATIBILITY mouse events, a different event type entirely, which
  //    only `preventDefault` on pointerdown suppresses;
  //  - `click`, fired on whatever sits under the release point as that
  //    element's activation behaviour — so a drag let go over a link follows it.
  // Read out of `onDown`'s own body, not matched loosely against the file. The
  // first version of this assertion anchored on the COMMENT beside the
  // `preventDefault` call, so deleting the call left it green — a test that
  // pins prose instead of behaviour is worse than no test (CLAUDE.md §7).
  const onDown = /const onDown = \(e: PointerEvent\) => \{([\s\S]*?)\n {4}\};/.exec(scene)?.[1];
  assert.ok(onDown, "onDown handler not found");
  assert.match(onDown, /e\.stopPropagation\(\)/, "pointerdown must not reach the page");
  assert.match(onDown, /e\.preventDefault\(\)/, "compatibility mouse events must be suppressed");
  assert.match(onDown, /swallowClick\.current = true/, "the closing click must be armed to be eaten");
  assert.match(
    scene,
    /window\.addEventListener\("click", onClick, true\)/,
    "nothing is listening for the click that ends the gesture"
  );
  // Armed on hit, disarmed by the first click after it. Left standing, it would
  // eat the next genuine click on the page instead.
  assert.match(scene, /if \(!swallowClick\.current\) return;\n\s+swallowClick\.current = false;/);
});

/**
 * The lanyard is desktop-only. A capability-only gate could not do this job:
 * Safari exposes neither `deviceMemory` nor `saveData`, and `hardwareConcurrency`
 * does not separate an iPhone 8 from an iPhone 15 (both report 6). Measured
 * against real device signatures, the capability checks alone let every old iOS
 * device through — the exact population the gate exists for.
 */
test("the lanyard never mounts below lg, and the gate re-runs on resize", () => {
  const src = read("app/components/site/VerdictLanyard.tsx");
  assert.match(
    src,
    /const LANYARD_MIN_WIDTH_PX = 1024/,
    "the width gate must be a named constant at Tailwind's lg, matching LAYER_VARS",
  );
  assert.match(
    src,
    /function deviceCanAffordLanyard\(\): boolean \{\s*\n\s*if \(!window\.matchMedia/,
    "the width check must be FIRST — the capability checks below it cannot cover iOS",
  );
  // §8 #10: a gate nobody calls is decoration.
  assert.match(src, /!reduced && affordable/, "useLanyardRuns must consume the gate");
  assert.match(
    src,
    /mq\.addEventListener\("change", sync\)/,
    "a one-shot mount check strands the wrong answer when a tablet rotates",
  );
});
