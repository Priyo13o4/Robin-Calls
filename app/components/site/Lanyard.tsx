"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Canvas,
  extend,
  useFrame,
  useThree,
  type ThreeElement,
} from "@react-three/fiber";
import { useGLTF, useTexture, Environment, Lightformer } from "@react-three/drei";
import {
  BallCollider,
  CuboidCollider,
  Physics,
  RigidBody,
  useRopeJoint,
  useSphericalJoint,
  type RapierRigidBody,
  type RigidBodyProps,
} from "@react-three/rapier";
import {
  MeshLineGeometry,
  MeshLineMaterial,
  type MeshLineMaterialParameters,
} from "meshline";
import * as THREE from "three";
import {
  ANCHOR_WORLD_Y,
  BACK_UV_RECT,
  BORDER_INSET_FRAC,
  CAMERA_DISTANCE,
  CAMERA_FOV_DEG,
  CARD_JOINT_OFFSET_Y,
  CARD_VISUAL_OFFSET_Y,
  FRONT_UV_RECT,
  ROPE_SEGMENT_LENGTH,
  contentRectFor,
  shareRectFor,
  type UvRect,
} from "./lanyard-geometry";

/**
 * A physics lanyard with a hanging, draggable ID card.
 *
 * Ported from React Bits (`Lanyard-TS-TW`). Kept deliberately close to upstream
 * so a future version diffs cleanly — every deviation is listed here rather
 * than scattered through the file:
 *
 *  1. **Assets are URLs, not bundler imports.** Upstream does
 *     `import cardGLB from './card.glb'`, which needs Vite's
 *     `assetsInclude: ['**\/*.glb']` and an ambient `declare module '*.glb'`.
 *     We are on Next 16 / Turbopack, so the two files live in `public/lanyard/`
 *     and arrive as plain paths. That also makes them swappable per instance
 *     without a rebuild, which is what the verdict card needs.
 *  2. **`<Suspense>` inside the Canvas.** `useGLTF` and `useTexture` suspend.
 *     Upstream gets away without a boundary because Vite's dev server resolves
 *     the imports eagerly; over HTTP the first frame throws without one.
 *  3. **Height is a prop, not `h-screen`.** This mounts inside a verdict
 *     column, not as a page takeover.
 *  4. `meshline@3` ships its own types, so upstream's `declare module 'meshline'`
 *     shim is unnecessary and omitted.
 *  5. **Pointer input is read off the window, not off the canvas.** Upstream is
 *     a page takeover, so a canvas that eats every pointer event costs it
 *     nothing. Here the canvas is an overlay lying across live page content, and
 *     a canvas element is a rectangle: taking events would make everything
 *     behind it unclickable, and `pointer-events: none` alone would make the
 *     card undraggable. So the canvas takes no events at all and this component
 *     raycasts window events itself, consuming them (capture-phase
 *     `stopPropagation`) only on the frames they actually land on the card.
 *     Everything else reaches the page untouched.
 *  6. **A DOM shield tracking the card.** Deviation 5 alone is not enough when
 *     the page underneath contains an **iframe** — a separate browsing context,
 *     whose pointer events never reach this window at all. On the verdict page
 *     92% of the card sits over an embedded chart, so the card was dead to the
 *     pointer across almost its whole face. The shield is a transparent div
 *     sized to the card's projected bounding box each frame; being in *our*
 *     document, it stops the iframe receiving events there and hands them to
 *     the window listeners instead. Nothing else about it is interactive.
 *  7. **A `paused` prop.** Upstream is a page takeover and always runs. Here the
 *     card hangs at the top of a page thousands of pixels long, so it spends
 *     most of a visit off screen — and a canvas nobody can see still costs a
 *     full frame budget. `frameloop="never"` stops the render AND the physics
 *     step (Rapier advances from `useFrame`), so the scene resumes exactly where
 *     it was left rather than snapping. `VerdictLanyard` drives it from an
 *     `IntersectionObserver`.
 *
 * **This component does not decide when to appear.** It renders a card on a
 * string and nothing else — no drop-in, no dismiss, no reduced-motion policy.
 * Those belong to whatever mounts it, because they depend on the host page
 * (see the scan-page work in
 * `docs/ways-of-work/plan/ui-redesign/PLAN.md` §5).
 *
 * It must be mounted through `next/dynamic` with `ssr: false`. WebGL, Rapier's
 * wasm, and `document.createElement("canvas")` in the compositor below all
 * assume a browser.
 */

extend({ MeshLineGeometry, MeshLineMaterial });

declare module "@react-three/fiber" {
  interface ThreeElements {
    meshLineGeometry: ThreeElement<typeof MeshLineGeometry>;
    meshLineMaterial: ThreeElement<typeof MeshLineMaterial>;
  }
}

/** Where the two required assets live. Both must exist or nothing renders. */
export const CARD_MODEL_URL = "/lanyard/card.glb";
/**
 * The strap texture — **ours, not upstream's**. React Bits ships
 * `lanyard.png`, which has its Atom logo printed down the band; that is another
 * project's mark on our verdict card and it stayed visible on the ribbon long
 * after the card face had been replaced, because nothing in the port ever
 * touched the band. It is the DEFAULT rather than something the host passes in
 * for the same reason: a branded asset that only appears when a caller
 * remembers to ask for it is one forgotten prop away from shipping the atom
 * again. `lanyardImage` still overrides it per instance.
 */
export const LANYARD_BAND_URL = "/lanyard/band-robincalls.png";

/**
 * 1×1 transparent pixel. `useTexture` is a hook and cannot be called
 * conditionally, so an unsupplied face still needs *something* to load; the
 * compositor below then skips drawing it.
 */
const BLANK_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/**
 * The atlas layout — face rects, the share button's rect, the border inset —
 * lives in `lanyard-geometry` and is imported above.
 *
 * It is not here because the OG route that DRAWS the card face needs it too: it
 * has to know where the button will be painted so it does not lay text under
 * it. A copy in each module is the shape of §8 #11, one module out.
 *
 * The button is painted into the texture rather than floated as its own mesh in
 * front of the card. A separate mesh would need the card's visual half-thickness
 * to sit proud of the surface without z-fighting, and that number is inside
 * `card.glb`, not anywhere we can read it — the collider's `0.01` is a physics
 * approximation, not the render geometry. Painting into the atlas puts the
 * button exactly on the surface by construction, and the hit test below runs in
 * the same UV space, so the picture and the click target cannot disagree.
 */

/**
 * Does a UV coordinate from the raycaster land on a share button?
 *
 * The rects above are in CANVAS space (y down from the top, which is how they
 * were measured and how `drawImage` consumes them). UV space is y-up unless the
 * texture is flipped, and `flipY` is the loader's business: three's image loader
 * defaults it to `true`, but glTF pins it to `false` because glTF's UV origin is
 * already top-left — and this atlas comes out of `card.glb`. Reading the flag off
 * the texture instead of assuming keeps the hit test aligned with the paint even
 * if the model is ever re-exported.
 */
function uvHitsShare(uv: THREE.Vector2, flipY: boolean): boolean {
  for (const face of [FRONT_UV_RECT, BACK_UV_RECT]) {
    const r = shareRectFor(face);
    const top = flipY ? 1 - (r.y + r.h) : r.y;
    if (uv.x >= r.x && uv.x <= r.x + r.w && uv.y >= top && uv.y <= top + r.h) {
      return true;
    }
  }
  return false;
}

export interface LanyardProps {
  position?: [number, number, number];
  gravity?: [number, number, number];
  fov?: number;
  transparent?: boolean;
  /** Image for the card's front face. Composited into the atlas, not stretched. */
  frontImage?: string | null;
  /** Image for the card's back face. */
  backImage?: string | null;
  imageFit?: "cover" | "contain";
  /** Texture for the band itself. Defaults to the shipped strap artwork. */
  lanyardImage?: string | null;
  /** Widen the band so a custom band image has more room. */
  lanyardWidth?: number;
  /**
   * How hard the card settles onto whichever face is currently selected.
   *
   * Upstream hardcodes `0.25` against a fixed front-facing target, which is why
   * the card felt glued: no matter which way you turned it, the restoring torque
   * pulled it back to the front, and it grew the further you got. Here the
   * target follows the flip (see `Band`), so the same strength now *helps* you
   * turn the card over and then holds it there. `0` frees it to spin.
   */
  selfRighting?: number;
  /**
   * Angular damping on the card body only (the rope segments keep upstream's 4).
   * Lower lets a flick carry through the turn instead of dying in ~a third of it.
   */
  cardAngularDamping?: number;
  /**
   * Called when the share button painted on either face is tapped.
   *
   * The button is only drawn when this is supplied — a card with no share
   * action must not show a control that does nothing.
   */
  onShare?: () => void;
  /** Label on the share button. Uppercased; keep it short, it is ~7 chars wide. */
  shareLabel?: string;
  /**
   * CSS colour painted over each face before the artwork, or null to leave the
   * model's own texture showing.
   *
   * Needed whenever `imageFit` is `contain`: a contained image does not cover
   * its face, so `card.glb`'s baked texture — white paper stock with the React
   * Bits atom on it — shows through everywhere the art does not reach. Filling
   * first makes the card the caller's colour and the art the only thing on it.
   */
  faceBackground?: string | null;
  /**
   * CSS colour for a border drawn around each printed face, or null for none.
   *
   * Painted into the texture atlas, like the share button — the card's edges
   * are `card.glb` geometry and cannot be restyled without the model, but the
   * face is ours. So this frames the artwork rather than rimming the physical
   * card; a glowing edge would need a second mesh and the model's real
   * half-thickness, which is not a number we have.
   */
  faceBorder?: string | null;
  /**
   * Freeze the scene without unmounting it. Deviation 7 above — the host uses
   * this when the card is dismissed but kept in the tree.
   */
  paused?: boolean;
  /** Wrapper classes. Give it a height — the canvas fills its container. */
  className?: string;
}

export default function Lanyard({
  // From `lanyard-geometry`, not literals: the host frames this scene by
  // computing where the anchor lands, and that calculation needs the same
  // numbers the camera actually uses.
  position = [0, 0, CAMERA_DISTANCE],
  gravity = [0, -40, 0],
  fov = CAMERA_FOV_DEG,
  transparent = true,
  frontImage = null,
  backImage = null,
  imageFit = "cover",
  lanyardImage = null,
  lanyardWidth = 1,
  selfRighting = 0.15,
  cardAngularDamping = 1.6,
  onShare,
  shareLabel = "SHARE",
  faceBackground = null,
  faceBorder = null,
  paused = false,
  className = "relative z-0 flex h-full w-full items-center justify-center",
}: LanyardProps) {
  const [isMobile, setIsMobile] = useState<boolean>(
    () => typeof window !== "undefined" && window.innerWidth < 768
  );

  useEffect(() => {
    const handleResize = (): void => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const shield = useRef<HTMLDivElement>(null);
  const placeShield = useCallback(
    (x: number, y: number, width: number, height: number) => {
      const el = shield.current;
      if (!el) return;
      el.style.transform = `translate(${x}px, ${y}px)`;
      el.style.width = `${width}px`;
      el.style.height = `${height}px`;
    },
    []
  );

  return (
    <div className={`relative ${className}`}>
      {/*
        Deviation 6. Positioned from the card's projected bounds every frame by
        `Band`; `pointer-events: auto` is the entire point — it is what an
        iframe underneath cannot see through. Hidden while paused so a frozen
        scene does not leave a stale rectangle swallowing clicks.
      */}
      <div
        ref={shield}
        aria-hidden
        className="pointer-events-auto absolute left-0 top-0 origin-top-left"
        style={{ display: paused ? "none" : undefined }}
      />
      <Canvas
        camera={{ position, fov }}
        frameloop={paused ? "never" : "always"}
        dpr={[1, isMobile ? 1.5 : 2]}
        gl={{ alpha: transparent }}
        // Deviation 5. This also disarms R3F's own event system for free — its
        // listeners sit on this element, so nothing can reach them. That is why
        // the meshes below carry no `onPointer*` props: they would be dead code.
        style={{ pointerEvents: "none" }}
        onCreated={({ gl }) =>
          gl.setClearColor(new THREE.Color(0x000000), transparent ? 0 : 1)
        }
      >
        <ambientLight intensity={Math.PI} />
        {/* Deviation 2: the band's model and textures suspend. Without this the
            first frame throws instead of waiting for the fetch. */}
        <Suspense fallback={null}>
          <Physics gravity={gravity} timeStep={isMobile ? 1 / 30 : 1 / 60}>
            <Band
              isMobile={isMobile}
              frontImage={frontImage}
              backImage={backImage}
              imageFit={imageFit}
              lanyardImage={lanyardImage}
              lanyardWidth={lanyardWidth}
              selfRighting={selfRighting}
              cardAngularDamping={cardAngularDamping}
              onShare={onShare}
              shareLabel={shareLabel}
              faceBackground={faceBackground}
              faceBorder={faceBorder}
              onCardBounds={placeShield}
            />
          </Physics>
          <Environment blur={0.75}>
            <Lightformer
              intensity={2}
              color="white"
              position={[0, -1, 5]}
              rotation={[0, 0, Math.PI / 3]}
              scale={[100, 0.1, 1]}
            />
            <Lightformer
              intensity={3}
              color="white"
              position={[-1, -1, 1]}
              rotation={[0, 0, Math.PI / 3]}
              scale={[100, 0.1, 1]}
            />
            <Lightformer
              intensity={3}
              color="white"
              position={[1, 1, 1]}
              rotation={[0, 0, Math.PI / 3]}
              scale={[100, 0.1, 1]}
            />
            <Lightformer
              intensity={10}
              color="white"
              position={[-10, 0, 14]}
              rotation={[0, Math.PI / 2, Math.PI / 3]}
              scale={[100, 10, 1]}
            />
          </Environment>
        </Suspense>
      </Canvas>
    </div>
  );
}

interface BandProps {
  maxSpeed?: number;
  minSpeed?: number;
  isMobile?: boolean;
  frontImage?: string | null;
  backImage?: string | null;
  imageFit?: "cover" | "contain";
  lanyardImage?: string | null;
  lanyardWidth?: number;
  selfRighting?: number;
  cardAngularDamping?: number;
  onShare?: () => void;
  shareLabel?: string;
  faceBackground?: string | null;
  faceBorder?: string | null;
  /**
   * Called each frame with the card's projected screen box, for the shield.
   *
   * A callback rather than the ref itself: React Compiler forbids mutating
   * anything reached through a prop, and it is right to — the shield is
   * `Lanyard`'s DOM, so `Lanyard` writes to it and this only measures.
   */
  onCardBounds?: (x: number, y: number, width: number, height: number) => void;
}

type LanyardRigidBody = RapierRigidBody & {
  lerped?: THREE.Vector3;
};

/**
 * A pointer that moved less than this many CSS pixels, and was down for less
 * than this many milliseconds, is a tap rather than a drag.
 *
 * The card is a `kinematicPosition` body while held, so a drag only ever
 * translates it — no amount of dragging imparts spin. Turning the card over was
 * therefore a matter of flinging it and hoping the throw survived the damping,
 * which is why it stayed hard to flip even after the restoring torque was
 * loosened. A tap is the deterministic way to do it, and it is also what makes a
 * button on the card face possible: both need the same "was that a click?" test.
 */
const TAP_SLOP_PX = 6;
const TAP_MS = 350;

/**
 * Lateral offset per rope link at spawn. See the rig below: enough to keep the
 * solver off a perfectly straight chain, small enough that the card settles
 * rather than swings.
 */
const LAUNCH_SWAY = 0.06;

/** Angular kick applied on tap, to get the turn started before the controller
 *  below takes over. Always the same direction, so each tap is another half
 *  turn and the two faces alternate. */
const FLIP_IMPULSE = 7;

function Band({
  maxSpeed = 50,
  minSpeed = 0,
  isMobile = false,
  frontImage = null,
  backImage = null,
  imageFit = "cover",
  lanyardImage = null,
  lanyardWidth = 1,
  selfRighting = 0.15,
  cardAngularDamping = 1.6,
  onShare,
  shareLabel = "SHARE",
  faceBackground = null,
  faceBorder = null,
  onCardBounds,
}: BandProps) {
  const band = useRef<
    THREE.Mesh<
      InstanceType<typeof MeshLineGeometry>,
      InstanceType<typeof MeshLineMaterial>
    >
  >(null!);
  const fixed = useRef<RapierRigidBody>(null!);
  const j1 = useRef<LanyardRigidBody>(null!);
  const j2 = useRef<LanyardRigidBody>(null!);
  const j3 = useRef<RapierRigidBody>(null!);
  const card = useRef<RapierRigidBody>(null!);

  const vec = new THREE.Vector3();
  const ang = new THREE.Vector3();
  const dir = new THREE.Vector3();

  const segmentProps: RigidBodyProps = {
    type: "dynamic",
    canSleep: true,
    colliders: false,
    angularDamping: 4,
    linearDamping: 4,
  };

  const getLerped = (body: LanyardRigidBody): THREE.Vector3 => {
    if (!body.lerped) {
      body.lerped = new THREE.Vector3().copy(body.translation());
    }
    return body.lerped;
  };

  const { nodes, materials } = useGLTF(CARD_MODEL_URL) as unknown as {
    nodes: Record<string, THREE.Mesh>;
    materials: Record<string, THREE.MeshStandardMaterial>;
  };
  /**
   * Wrap modes are set declaratively on the material below (`map-wrapS` /
   * `map-wrapT`), not by assigning to this texture.
   *
   * Upstream does `texture.wrapS = texture.wrapT = RepeatWrapping` after the
   * hook returns, which `react-hooks/immutability` rejects. Cloning to dodge
   * that is worse than it looks and was tried first: a clone shares the
   * original's `source`, so three sees a second texture against an
   * already-uploaded GPU source, and forcing `needsUpdate` on it produced
   * `WebGL: INVALID_VALUE: texSubImage2D: bad image data` and then a lost
   * context. R3F's dashed-prop form sets the same fields through the
   * reconciler — the idiom this file already uses for `map-anisotropy`.
   */
  const texture = useTexture(lanyardImage || LANYARD_BAND_URL);
  const frontTex = useTexture(frontImage || BLANK_PIXEL);
  const backTex = useTexture(backImage || BLANK_PIXEL);

  /**
   * Composite the supplied faces into the card's texture atlas.
   *
   * Drawing the baked atlas first and then clipping each image into its own
   * half keeps the card's edges and any face the caller did NOT supply — so
   * passing only `frontImage` leaves the original back intact rather than
   * blanking it.
   */
  const showShare = Boolean(onShare);
  /** See `uvHitsShare` — read off the texture, never assumed. */
  const atlasFlipY = materials.base?.map?.flipY ?? false;

  const cardMap = useMemo(() => {
    const baseMap = materials.base?.map as THREE.Texture | undefined;
    if (!baseMap) return null;
    if (!frontImage && !backImage && !showShare && !faceBorder && !faceBackground)
      return baseMap;

    const baseImg = baseMap.image as CanvasImageSource & {
      width: number;
      height: number;
    };
    const W = baseImg.width;
    const H = baseImg.height;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return baseMap;
    ctx.drawImage(baseImg, 0, 0, W, H);

    const drawFitted = (
      img: CanvasImageSource & { width: number; height: number },
      rect: UvRect
    ) => {
      const rx = rect.x * W;
      const ry = rect.y * H;
      const rw = rect.w * W;
      const rh = rect.h * H;
      const pick = imageFit === "contain" ? Math.min : Math.max;
      const scale = pick(rw / img.width, rh / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      const dx = rx + (rw - dw) / 2;
      const dy = ry + (rh - dh) / 2;
      ctx.save();
      ctx.beginPath();
      ctx.rect(rx, ry, rw, rh);
      ctx.clip();
      ctx.drawImage(img, dx, dy, dw, dh);
      ctx.restore();
    };

    // `Texture.image` is `any`-shaped in three's types ({}), but at runtime it
    // is whatever the loader produced — an HTMLImageElement for both of these.
    type LoadedImage = CanvasImageSource & { width: number; height: number };
    // The FULL face, not the content rect: the margin outside the border has to
    // be covered too, or the model's white stock survives as a ring around the
    // frame. The face rect's own corners fall outside the card's rounded
    // silhouette and are simply never seen.
    if (faceBackground) {
      ctx.fillStyle = faceBackground;
      for (const face of [FRONT_UV_RECT, BACK_UV_RECT]) {
        ctx.fillRect(face.x * W, face.y * H, face.w * W, face.h * H);
      }
    }

    // Into the CONTENT rect, not the face rect — see `contentRectFor`. The
    // inset is only applied when a border is actually drawn; without a frame
    // there is nothing for the art to escape from and the full face is right.
    const artInset = faceBorder ? BORDER_INSET_FRAC : 0;
    if (frontImage && frontTex.image)
      drawFitted(frontTex.image as LoadedImage, contentRectFor(FRONT_UV_RECT, artInset));
    if (backImage && backTex.image)
      drawFitted(backTex.image as LoadedImage, contentRectFor(BACK_UV_RECT, artInset));

    /**
     * A border around each printed face.
     *
     * A plain rect, so unlike the share button it needs no `flipY` branch —
     * a rectangle inset equally on all four sides is its own mirror image.
     * Drawn after the face art and before the button, which paints over it.
     */
    const drawBorder = (face: UvRect) => {
      if (!faceBorder) return;
      // The same rect the art was just drawn into, so the frame lands exactly
      // on the artwork's edge rather than somewhere near it.
      const rect = contentRectFor(face, BORDER_INSET_FRAC);
      const rx = rect.x * W;
      const ry = rect.y * H;
      const rw = rect.w * W;
      const rh = rect.h * H;
      // Proportional to the face, not the atlas: the two faces are the same
      // size today, but a re-export that changed one would otherwise put a
      // visibly heavier border on it.
      const lw = Math.max(2, Math.round(Math.min(rw, rh) * 0.016));
      ctx.save();
      ctx.strokeStyle = faceBorder;
      ctx.lineWidth = lw;
      // Half the line width in: `strokeRect` centres the stroke on the path, so
      // stroking the content rect itself would put half the line over the art.
      const d = lw / 2;
      ctx.strokeRect(rx + d, ry + d, rw - 2 * d, rh - 2 * d);
      ctx.restore();
    };

    drawBorder(FRONT_UV_RECT);
    drawBorder(BACK_UV_RECT);

    /**
     * The share button, painted last so it sits over whatever face image was
     * just composited underneath it.
     *
     * The `flipY` branch is insurance, not decoration. This atlas comes from
     * glTF, so `flipY` is false and the canvas maps straight onto UV space —
     * but the face images above are drawn the same way and a photo would not
     * obviously reveal a vertical flip, whereas the word SHARE would render
     * upside down. Deriving it from the texture costs one branch and removes
     * the assumption.
     */
    const drawShare = (rect: UvRect) => {
      const r = shareRectFor(rect);
      const rx = r.x * W;
      const ry = r.y * H;
      const rw = r.w * W;
      const rh = r.h * H;

      ctx.save();
      if (baseMap.flipY) {
        ctx.translate(rx, ry + rh);
        ctx.scale(1, -1);
      } else {
        ctx.translate(rx, ry);
      }

      // The offset shadow the brutalist buttons carry everywhere else, scaled
      // to the plate. Drawn first so the face sits on top of it.
      ctx.fillStyle = "rgba(10,10,10,0.6)";
      ctx.fillRect(rw * 0.014, rh * 0.1, rw, rh);
      ctx.fillStyle = "#ccff00";
      ctx.fillRect(0, 0, rw, rh);

      ctx.fillStyle = "#0a0a0a";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      // `letterSpacing` is recent enough that the DOM typings may not carry it,
      // and an engine without it just renders the label untracked — which is
      // legible, only less like the rest of the type. Not worth a polyfill.
      const spaced = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
      if ("letterSpacing" in spaced) {
        spaced.letterSpacing = `${Math.round(rh * 0.13)}px`;
      }
      ctx.font = `700 ${Math.round(rh * 0.46)}px Helvetica, Arial, sans-serif`;
      ctx.fillText(shareLabel.toUpperCase(), rw / 2, rh / 2);
      ctx.restore();
    };

    if (showShare) {
      drawShare(FRONT_UV_RECT);
      drawShare(BACK_UV_RECT);
    }

    const composite = new THREE.CanvasTexture(canvas);
    composite.colorSpace = THREE.SRGBColorSpace;
    composite.flipY = baseMap.flipY;
    composite.anisotropy = 16;
    composite.needsUpdate = true;
    return composite;
  }, [
    frontImage,
    backImage,
    imageFit,
    frontTex,
    backTex,
    materials.base?.map,
    showShare,
    shareLabel,
    faceBackground,
    faceBorder,
  ]);

  // `curveType` is set in the initializer, not assigned after the fact as
  // upstream does — `react-hooks/immutability` rejects mutating a value a hook
  // returned, and configuring it at construction is where it belonged anyway.
  const [curve] = useState(() => {
    const c = new THREE.CatmullRomCurve3([
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3(),
      new THREE.Vector3(),
    ]);
    c.curveType = "chordal";
    return c;
  });
  const [dragged, drag] = useState<false | THREE.Vector3>(false);
  const [hovered, hover] = useState(false);
  /** Which face the card is being held against — see the controller in useFrame. */
  const [flipped, setFlipped] = useState(false);
  /** True while the pointer is over the painted share button. */
  const [overShare, setOverShare] = useState(false);
  /** Where and when the pointer went down, for the tap test on pointer-up. */
  const pressed = useRef<{ x: number; y: number; t: number } | null>(null);
  /** Armed when a gesture starts on the card; eats that gesture's `click`. */
  const swallowClick = useRef(false);

  // Scratch for the shield's projection — allocated once, not per frame.
  const shieldBox = useMemo(() => new THREE.Box3(), []);
  const shieldCorner = useMemo(() => new THREE.Vector3(), []);

  const cardQuat = useMemo(() => new THREE.Quaternion(), []);
  const cardFacing = useMemo(() => new THREE.Vector3(), []);

  /** The badge's visual group — the only thing window picks are tested against. */
  const cardVisual = useRef<THREE.Group>(null);
  /**
   * Pointer position in NDC, maintained by the window listeners below.
   *
   * Upstream's drag reads `state.pointer`, which R3F fills from listeners on
   * the canvas element — and deviation 5 makes that element transparent to the
   * pointer, so `state.pointer` is frozen at whatever it was on mount. Anything
   * that reads it here would silently drag toward the origin.
   */
  const pointerNdc = useRef(new THREE.Vector2());

  const { camera, gl, raycaster } = useThree();

  /**
   * All pointer input, at the window, in the capture phase.
   *
   * Re-subscribed when `dragged` flips rather than read through a ref: it
   * happens twice per interaction, and a stale-closure bug in an input handler
   * is far more expensive than two `addEventListener` calls.
   */
  useEffect(() => {
    const el = gl.domElement;

    /** Writes the pointer into `pointerNdc`. False if the canvas has no box yet. */
    const toNdc = (clientX: number, clientY: number): boolean => {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return false;
      pointerNdc.current.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
      );
      return true;
    };

    const pick = (): THREE.Intersection[] => {
      const group = cardVisual.current;
      if (!group) return [];
      raycaster.setFromCamera(pointerNdc.current, camera);
      return raycaster.intersectObject(group, true);
    };

    /**
     * The first hit on the printed face specifically. `pick()[0]` may be the
     * metal clip or clamp — separate meshes with their own unrelated UVs, so
     * reading a uv off one could land inside the share rect by coincidence.
     * Grabbing the badge anywhere is a drag; only the face carries the button.
     */
    const faceHit = (hits: THREE.Intersection[]) =>
      hits.find((h) => (h.object as THREE.Mesh).geometry === nodes.card.geometry);

    const onDown = (e: PointerEvent) => {
      if (!toNdc(e.clientX, e.clientY)) return;
      const hits = pick();
      if (!hits.length) return;
      // Consumed only on a real hit — every other pointerdown on the page is
      // left completely alone, which is the whole point of deviation 5.
      e.stopPropagation();
      // `preventDefault` is the other half: pointerdown's default action is to
      // fire the compatibility mouse events, and `mousedown` is a different
      // event type that stopping THIS one does not touch. It also stops the
      // text selection a drag across the page would otherwise paint.
      e.preventDefault();
      swallowClick.current = true;
      pressed.current = { x: e.clientX, y: e.clientY, t: performance.now() };
      drag(
        new THREE.Vector3()
          .copy(hits[0].point)
          .sub(new THREE.Vector3().copy(card.current.translation()))
      );
    };

    const onMove = (e: PointerEvent) => {
      if (!toNdc(e.clientX, e.clientY)) return;
      // While dragging the frame loop steers off `pointerNdc`, already updated.
      if (dragged) {
        e.stopPropagation();
        return;
      }
      const hits = pick();
      hover(hits.length > 0);
      const face = faceHit(hits);
      setOverShare(Boolean(showShare && face?.uv && uvHitsShare(face.uv, atlasFlipY)));
    };

    const onUp = (e: PointerEvent) => {
      const down = pressed.current;
      pressed.current = null;
      if (dragged) drag(false);
      if (!down) return;
      e.stopPropagation();

      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (moved > TAP_SLOP_PX || performance.now() - down.t > TAP_MS) {
        return; // that was a drag; leave the card where it was let go
      }
      if (!toNdc(e.clientX, e.clientY)) return;
      const hits = pick();
      if (!hits.length) return;

      const face = faceHit(hits);
      if (showShare && face?.uv && uvHitsShare(face.uv, atlasFlipY)) {
        onShare?.();
        return;
      }

      // Tap anywhere else on the badge: turn it over. Always the same
      // direction, so repeated taps alternate the two faces.
      setFlipped((f) => !f);
      const av = card.current.angvel();
      card.current.setAngvel({ x: av.x, y: av.y + FLIP_IMPULSE, z: av.z }, true);
    };

    const onCancel = () => {
      pressed.current = null;
      swallowClick.current = false;
      drag(false);
    };

    /**
     * Eat the `click` that closes a gesture which started on the card.
     *
     * `click` is not a pointer event and is not suppressed by anything above:
     * it fires on whatever element sits under the release point as part of that
     * element's activation behaviour. So grabbing the card, dragging it across
     * the page and letting go over a link would follow the link. This is armed
     * on a hit and disarmed by the first click after it — never left standing,
     * or the next genuine click on the page would go missing.
     */
    const onClick = (e: MouseEvent) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      e.stopPropagation();
      e.preventDefault();
    };

    /**
     * Touch scrolling is decided at `touchstart`, and only `preventDefault`
     * there stops it. Without this, dragging the card on a phone scrolls the
     * page underneath at the same time — the canvas is transparent to touch, so
     * `touch-action` on it governs nothing.
     */
    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t || !toNdc(t.clientX, t.clientY)) return;
      if (pick().length) e.preventDefault();
    };

    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onCancel, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("touchstart", onTouchStart, { capture: true, passive: false });
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onCancel, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("touchstart", onTouchStart, true);
    };
  }, [
    dragged,
    showShare,
    atlasFlipY,
    onShare,
    camera,
    gl,
    raycaster,
    nodes.card.geometry,
  ]);

  // Memoized so R3F's shallow args comparison doesn't rebuild the material on
  // every render — a fresh Vector2 each pass would never compare equal.
  const bandMaterialArgs = useMemo(
    () =>
      [
        { resolution: new THREE.Vector2(1000, isMobile ? 2000 : 1000) },
      ] as [MeshLineMaterialParameters],
    [isMobile]
  );

  // Three segments — `ROPE_SEGMENTS` counts these, and the two must agree or
  // `cardRestBottomWorldY` is computing the drop of a rope that isn't there.
  useRopeJoint(fixed, j1, [[0, 0, 0], [0, 0, 0], ROPE_SEGMENT_LENGTH]);
  useRopeJoint(j1, j2, [[0, 0, 0], [0, 0, 0], ROPE_SEGMENT_LENGTH]);
  useRopeJoint(j2, j3, [[0, 0, 0], [0, 0, 0], ROPE_SEGMENT_LENGTH]);
  useSphericalJoint(j3, card, [
    [0, 0, 0],
    [0, CARD_JOINT_OFFSET_Y, 0],
  ]);

  useEffect(() => {
    if (hovered) {
      document.body.style.cursor = overShare
        ? "pointer"
        : dragged
          ? "grabbing"
          : "grab";
      return () => {
        document.body.style.cursor = "auto";
      };
    }
  }, [hovered, dragged, overShare]);

  useFrame((state, delta) => {
    if (dragged && typeof dragged !== "boolean") {
      // `pointerNdc`, not `state.pointer` — see the ref's own note.
      vec.set(pointerNdc.current.x, pointerNdc.current.y, 0.5).unproject(state.camera);
      dir.copy(vec).sub(state.camera.position).normalize();
      vec.add(dir.multiplyScalar(state.camera.position.length()));
      [card, j1, j2, j3, fixed].forEach((ref) => ref.current?.wakeUp());
      card.current?.setNextKinematicTranslation({
        x: vec.x - dragged.x,
        y: vec.y - dragged.y,
        z: vec.z - dragged.z,
      });
    }
    if (fixed.current) {
      [j1, j2].forEach((ref) => {
        const lerped = getLerped(ref.current);
        const clampedDistance = Math.max(
          0.1,
          Math.min(1, lerped.distanceTo(ref.current.translation()))
        );
        lerped.lerp(
          ref.current.translation(),
          delta * (minSpeed + clampedDistance * (maxSpeed - minSpeed))
        );
      });
      curve.points[0].copy(j3.current.translation());
      curve.points[1].copy(getLerped(j2.current));
      curve.points[2].copy(getLerped(j1.current));
      curve.points[3].copy(fixed.current.translation());
      band.current.geometry.setPoints(curve.getPoints(isMobile ? 16 : 32));
      ang.copy(card.current.angvel());

      /**
       * Hold the card against the face the reader last asked for.
       *
       * Upstream drives this off `rotation().y` — the quaternion's y component,
       * i.e. sin(θ/2) — pulled toward a hardcoded zero. Two things follow from
       * that, and both were the flip complaint: the target is always the front,
       * so turning the card over is fought the whole way and then undone; and
       * the term keeps growing right through a half turn, so it fights hardest
       * exactly where you were trying to get to.
       *
       * This measures the card's actual heading instead — where its own +Z axis
       * points once the body's rotation is applied — and steers the SHORTEST way
       * to whichever face is selected. Away from the target it restores just as
       * firmly as upstream; at the target it is zero from either side, so the
       * back is as stable a resting place as the front.
       */
      const r = card.current.rotation();
      cardQuat.set(r.x, r.y, r.z, r.w);
      cardFacing.set(0, 0, 1).applyQuaternion(cardQuat);
      const heading = Math.atan2(cardFacing.x, cardFacing.z);
      const target = flipped ? Math.PI : 0;
      // Wrapped to (-π, π] so the correction always takes the short way round
      // and never spins the long way to reach a target it is nearly at.
      const err = Math.atan2(
        Math.sin(heading - target),
        Math.cos(heading - target)
      );
      card.current.setAngvel(
        { x: ang.x, y: ang.y - err * selfRighting, z: ang.z },
        true
      );
    }

    /**
     * Park the shield over the card's projected bounds (deviation 6).
     *
     * The card turns, so its screen-space box changes every frame and a static
     * rectangle would be wrong the moment anything moved. All eight corners are
     * projected rather than just the centre because a card mid-flip is widest
     * at its corners, and a box that tracked only the centre would leave the
     * edges of a turning card over the iframe again — which is the bug.
     */
    if (onCardBounds && cardVisual.current) {
      shieldBox.setFromObject(cardVisual.current);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < 8; i++) {
        shieldCorner.set(
          i & 1 ? shieldBox.max.x : shieldBox.min.x,
          i & 2 ? shieldBox.max.y : shieldBox.min.y,
          i & 4 ? shieldBox.max.z : shieldBox.min.z
        );
        shieldCorner.project(state.camera);
        const x = (shieldCorner.x * 0.5 + 0.5) * state.size.width;
        const y = (-shieldCorner.y * 0.5 + 0.5) * state.size.height;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      onCardBounds(minX, minY, maxX - minX, maxY - minY);
    }
  });

  return (
    <>
      {/* The rope's fixed end. Its height is what the host frames against. */}
      <group position={[0, ANCHOR_WORLD_Y, 0]}>
        <RigidBody ref={fixed} {...segmentProps} type="fixed" />
        {/*
          Laid out DOWN the rope, not along +x as upstream does.

          Upstream starts the rig horizontal and lets gravity swing it into
          place — a nice entrance for a page takeover, and wrong here: it is a
          pendulum released from 90°, so for the first second or so the card
          travels through most of the upper half of the layer. It flew straight
          over the dismiss handle pinned at the top of the screen, and the first
          impression of the page was a badge thrashing across the verdict.

          Hanging from the start, it is already at equilibrium and simply sits
          there. `LAUNCH_SWAY` breaks the exact vertical: a perfectly aligned
          chain of rope joints is a degenerate configuration for the solver, and
          the tiny offset also leaves a hint of settle rather than a dead stop.
        */}
        <RigidBody position={[LAUNCH_SWAY, -ROPE_SEGMENT_LENGTH, 0]} ref={j1} {...segmentProps} type="dynamic">
          <BallCollider args={[0.1]} />
        </RigidBody>
        <RigidBody position={[LAUNCH_SWAY * 2, -ROPE_SEGMENT_LENGTH * 2, 0]} ref={j2} {...segmentProps} type="dynamic">
          <BallCollider args={[0.1]} />
        </RigidBody>
        <RigidBody position={[LAUNCH_SWAY * 3, -ROPE_SEGMENT_LENGTH * 3, 0]} ref={j3} {...segmentProps} type="dynamic">
          <BallCollider args={[0.1]} />
        </RigidBody>
        <RigidBody
          position={[LAUNCH_SWAY * 4, -ROPE_SEGMENT_LENGTH * 3 - CARD_JOINT_OFFSET_Y, 0]}
          ref={card}
          {...segmentProps}
          // Overrides the shared segment damping: the rope links still want 4
          // (they should not oscillate), but the card is the thing you handle.
          angularDamping={cardAngularDamping}
          type={dragged ? "kinematicPosition" : "dynamic"}
        >
          <CuboidCollider args={[0.8, 1.125, 0.01]} />
          {/* No `onPointer*` here — deviation 5 routes all input through the
              window listeners above, and handlers on this group could never
              fire. `ref` is what those listeners raycast against. */}
          <group ref={cardVisual} scale={2.25} position={[0, CARD_VISUAL_OFFSET_Y, -0.05]}>
            <mesh geometry={nodes.card.geometry}>
              <meshPhysicalMaterial
                map={cardMap}
                map-anisotropy={16}
                clearcoat={isMobile ? 0 : 1}
                clearcoatRoughness={0.15}
                roughness={0.9}
                metalness={0.8}
              />
            </mesh>
            <mesh
              geometry={nodes.clip.geometry}
              material={materials.metal}
              material-roughness={0.3}
            />
            <mesh geometry={nodes.clamp.geometry} material={materials.metal} />
          </group>
        </RigidBody>
      </group>
      <mesh ref={band}>
        <meshLineGeometry />
        {/* `args` is required by meshline@3's own types — `resolution` is the
            one non-optional constructor parameter, and upstream never passes it
            because its shim typed both elements as `any`. It carries the
            resolution rather than the prop below so there is a single source
            for it; changing `isMobile` rebuilds the material, which is correct. */}
        <meshLineMaterial
          args={bandMaterialArgs}
          color="white"
          depthTest={false}
          // Upstream writes a bare `useMap` (boolean true). meshline@3 declares
          // this a float uniform, so the boolean is a type error here — 1 is
          // what upstream's `true` coerced to anyway.
          useMap={1}
          map={texture}
          map-wrapS={THREE.RepeatWrapping}
          map-wrapT={THREE.RepeatWrapping}
          // Upstream's is `[-4, 1]`. The sign flips the sampling direction, and
          // on an abstract strap that is invisible — on one with a WORDMARK on
          // it, it is a mirror image. Four repeats either way.
          repeat={[4, 1]}
          lineWidth={lanyardWidth}
        />
      </mesh>
    </>
  );
}

useGLTF.preload(CARD_MODEL_URL);
