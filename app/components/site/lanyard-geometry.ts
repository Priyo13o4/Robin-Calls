/**
 * The lanyard's measurements — where its anchor lands on screen, and where the
 * printed regions of its card face are.
 *
 * The scene and the layout that frames it were computing the first of those
 * independently: `Lanyard` set the camera, and `VerdictLanyard` carried a
 * hand-derived "the anchor is ~12% down" in a comment. That is §8 #11 in
 * miniature — a literal standing in for a measurement. Changing `fov` would have
 * moved the anchor and left the lift untouched, putting the strap's origin back
 * on screen, which is the one failure the layout exists to prevent and the one
 * nothing would catch: it typechecks, it renders, it is just wrong.
 *
 * The face rects at the bottom are here for the same reason, one module further
 * out: `app/api/og/[id]/route.tsx` draws the artwork that gets composited onto
 * the card, and it has to know where the painted SHARE button will land or it
 * lays the receipt line underneath it. This file is pure arithmetic precisely so
 * a server route can import it.
 *
 * If you change the camera or the atlas layout, change it here.
 */

/** Camera distance from the card plane (z = 0). */
export const CAMERA_DISTANCE = 30;

/** Vertical field of view, degrees. three's `PerspectiveCamera.fov` is vertical. */
export const CAMERA_FOV_DEG = 20;

/** World-space height of the rope's fixed anchor — the point the band hangs from. */
export const ANCHOR_WORLD_Y = 4;

/** Rope segments between the anchor and the card. One `useRopeJoint` each. */
export const ROPE_SEGMENTS = 3;

/**
 * Max length of one rope segment. **This is the ribbon dial** — total visible
 * strap is `ROPE_SEGMENTS * ROPE_SEGMENT_LENGTH`, and the card hangs that far
 * below the anchor. Upstream ships 1; longer reads better here because the
 * anchor is off screen, so the strap is the only part of the rig that says the
 * card is hanging from something rather than floating.
 *
 * Bounded above by `cardRestBottomWorldY` — too long and the card falls out of
 * the bottom of the canvas, which no amount of layout can fix.
 */
export const ROPE_SEGMENT_LENGTH = 1.7;

/** Where the rope's last link attaches, in the card body's own frame. */
export const CARD_JOINT_OFFSET_Y = 1.45;

/** The visual group's offset inside the card body (re-centres the glTF mesh). */
export const CARD_VISUAL_OFFSET_Y = -1.2;

/**
 * Half the card's height in world units.
 *
 * Measured, not read off the model: the card mesh lives inside `card.glb` and
 * its bounds are not available without loading it. At scale 1 the card renders
 * ~158px tall in a 760px canvas, and that canvas spans `2 * halfViewHeight()`
 * world units — so 158/760 * 10.579 / 2. Re-measure if the model is replaced.
 */
export const CARD_HALF_HEIGHT_WORLD = 1.1;

/** Half the world height the camera sees at the card plane (z = 0). */
export function halfViewHeight(): number {
  return CAMERA_DISTANCE * Math.tan((CAMERA_FOV_DEG * Math.PI) / 360);
}

/**
 * World y of the card's bottom edge when the rope is hanging straight down.
 *
 * The check that matters is `cardRestBottomWorldY() > -halfViewHeight()`: below
 * that the card is clipped by the canvas at rest, and lengthening the ribbon is
 * exactly the edit that walks into it.
 */
export function cardRestBottomWorldY(): number {
  return (
    ANCHOR_WORLD_Y -
    ROPE_SEGMENTS * ROPE_SEGMENT_LENGTH -
    CARD_JOINT_OFFSET_Y +
    CARD_VISUAL_OFFSET_Y -
    CARD_HALF_HEIGHT_WORLD
  );
}

/**
 * How far down the canvas the anchor is drawn, as a fraction of canvas height.
 *
 * Independent of canvas height: a vertical fov fixes the world extent, so
 * resizing the element only changes pixels-per-unit. That is precisely why a
 * canvas sized to its container can never hide the anchor, and why the host has
 * to lift the whole layer instead.
 */
export function anchorFractionFromTop(): number {
  return (1 - ANCHOR_WORLD_Y / halfViewHeight()) / 2;
}

/** The anchor's offset in pixels from the top of a canvas `sceneHeight` tall. */
export function anchorOffsetPx(sceneHeight: number): number {
  return anchorFractionFromTop() * sceneHeight;
}

/* ------------------------------------------------------------------ *
 * The card's texture atlas
 * ------------------------------------------------------------------ */

/**
 * The card model's front face is UV-mapped to the LEFT half of the texture
 * atlas and the back face to the RIGHT half (measured from `card.glb`). Each
 * custom image is composited into its own half so the two faces render
 * independently and aspect-preserving.
 */
export const FRONT_UV_RECT = { x: 0, y: 0, w: 0.5, h: 0.755 };
export const BACK_UV_RECT = { x: 0.5, y: 0, w: 0.5, h: 0.757 };

export type UvRect = typeof FRONT_UV_RECT;

/**
 * The share button, expressed as a fraction OF A FACE RECT rather than of the
 * whole atlas — so the front and back copies are placed by the same numbers and
 * cannot drift apart.
 */
export const SHARE_RECT = { x: 0.18, y: 0.8, w: 0.64, h: 0.085 };

/**
 * How far inside the face rect the border is drawn, as a fraction of the face's
 * short side.
 *
 * The card's corners are ROUNDED — that is `card.glb` geometry — but the atlas
 * face is a plain rectangle mapped across it, so a sharp border drawn at the
 * rect's edge has its four corners fall outside the silhouette and get cut off.
 * For a square corner to clear a radius `R` it must be inset by at least
 * `R(1 - 1/√2)` ≈ 0.29R. This is that, with room to spare.
 */
export const BORDER_INSET_FRAC = 0.055;

/**
 * The face rect the ARTWORK is drawn into — the full face, pulled in by the
 * same amount as the border.
 *
 * Without this the border is inset but the image is not, so a sliver of art
 * survives outside the frame in the margin between the border and the card's
 * edge. A frame has to contain what it frames.
 */
export function contentRectFor(face: UvRect, inset: number): UvRect {
  const dx = Math.min(face.w, face.h) * inset;
  return { x: face.x + dx, y: face.y + dx, w: face.w - 2 * dx, h: face.h - 2 * dx };
}

/** The share button's rect in atlas space, for a given face. */
export function shareRectFor(face: UvRect): UvRect {
  return {
    x: face.x + SHARE_RECT.x * face.w,
    y: face.y + SHARE_RECT.y * face.h,
    w: SHARE_RECT.w * face.w,
    h: SHARE_RECT.h * face.h,
  };
}

/**
 * How far down the ARTWORK the painted share button starts, as a fraction of
 * the artwork's own height.
 *
 * The button is painted over the composited face, so whatever the artwork puts
 * below this line is buried. That is not hypothetical: the portrait card's
 * receipt hash was drawn straight underneath it and read as a smear of text
 * behind the button. The artwork is generated in a different module — an API
 * route, in another process — so this is the number that has to travel, and it
 * has to be derived rather than eyeballed. Both terms are y-fractions of the
 * same atlas, so no pixel conversion is involved.
 */
export function shareBandTopFraction(): number {
  const content = contentRectFor(FRONT_UV_RECT, BORDER_INSET_FRAC);
  return (shareRectFor(FRONT_UV_RECT).y - content.y) / content.h;
}
