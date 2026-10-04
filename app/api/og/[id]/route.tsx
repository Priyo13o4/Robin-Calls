import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { ImageResponse } from "next/og";
import { NextRequest, NextResponse } from "next/server";
import { reportError } from "@/lib/observability/reporter";
// Pure arithmetic, no React and no "use client" — see that module's header for
// why the card's atlas layout lives there rather than in the 3D component.
import { shareBandTopFraction } from "@/app/components/site/lanyard-geometry";
import type { CheckResult } from "@/lib/types";

export const revalidate = 3600;

const short = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

/**
 * The courtroom plate behind the card — the same artwork the /scan pages use as
 * a page background, pre-cropped to 1200×630 so Satori never rescales it.
 *
 * It sits beside this route rather than in public/ because the bundler only
 * traces an asset into the serverless output if it can *see* the reference:
 * `new URL("./x", import.meta.url)` is statically analyzable and gets emitted
 * (Turbopack rewrites it to .next/…/assets/x.<hash>.jpg), whereas a
 * `process.cwd() + "/public/…"` path is an opaque string and may be missing at
 * runtime.
 *
 * Read it with fs, NOT the `fetch(new URL(…))` snippet from the next/og docs —
 * that snippet is written for remote URLs, and Node's fetch rejects `file:`
 * with a bare `TypeError: fetch failed` / `cause: not implemented... yet...`.
 * Keep the `new URL` for the tracing and hand the path to readFile.
 *
 * Cached per lambda: the plate is ~134 KB and its base64 is what Satori wants
 * (it has no loader for file paths), so neither should be redone per request.
 */
const BACKGROUND_FILE = fileURLToPath(
  new URL("./court-card-bg.jpg", import.meta.url)
);

let backgroundPromise: Promise<string | null> | null = null;
function courtBackground(): Promise<string | null> {
  backgroundPromise ??= readFile(BACKGROUND_FILE)
    .then((buf) => `data:image/jpeg;base64,${buf.toString("base64")}`)
    // The plate is decoration; the verdict is the payload. If the asset went
    // missing from the bundle, say so and still ship a readable card — but drop
    // the memo so the next request retries rather than serving a plateless card
    // for the life of the lambda.
    .catch(async (err: unknown) => {
      backgroundPromise = null;
      await reportError({
        code: "RC_OG_BACKGROUND_UNAVAILABLE",
        message: `court-card-bg.jpg could not be read: ${err instanceof Error ? err.message : String(err)}`,
        operation: "og.verdictCard.background",
        error: err,
        details: { path: BACKGROUND_FILE },
      });
      return null;
    });
  return backgroundPromise;
}

/**
 * Portrait dimensions, and where they come from.
 *
 * The lanyard card is a physical badge: `card.glb`'s face mesh measures
 * 0.7164 x 1.0 and its texture atlas is 1678x1677, so the region the artwork is
 * composited into is 0.445 x 0.700 of that atlas — **746.7 x 1173.9 px, an
 * aspect of 0.636**. Matching it exactly is what lets the art fill the badge
 * with no letterboxing and no crop.
 *
 * The landscape card was being stuffed into it before this existed, and `cover`
 * cropped ~45% off the sides — which is where the address, the check names and
 * the receipt hash live. Switching to `contain` stopped cutting the text off
 * and immediately showed why that was never the fix: a 1200x630 image contained
 * in a portrait face is a thin band with the model's own white paper stock
 * around it. Two layouts is the answer; one layout squeezed is not.
 */
const PORTRAIT_WIDTH = 764;
const PORTRAIT_HEIGHT = 1200;

/**
 * Blank space kept clear at the foot of the portrait card.
 *
 * The lanyard paints a SHARE button over the lower part of the composited face,
 * so anything this route draws down there is buried under it — the receipt hash
 * was, and read as a smear of text behind the button. `shareBandTopFraction()`
 * is where that button starts, derived from the same rects the compositor uses,
 * plus a little air so the type does not touch it.
 *
 * The type sizes below are then set against what is LEFT. They are large on
 * purpose: this image is ~764px wide and gets drawn onto a badge roughly 250px
 * across on a phone, a ~0.3x reduction, so anything under about 30px here is
 * illegible on the thing people actually look at.
 */
const PORTRAIT_SHARE_RESERVE =
  Math.round(PORTRAIT_HEIGHT * (1 - shareBandTopFraction())) + 16;

/**
 * `next/og`'s `ImageResponse` streams its render (no `Content-Length`, ever —
 * confirmed against this exact route: absent on both HTTP/2 and HTTP/1.1).
 * That's invisible to a browser but is exactly the shape some crawler/bot
 * HTTP clients are documented to be unreliable with for an image fetch — an
 * unknown-length body they can't pre-allocate or validate against. The
 * static default card (public/brand/og-default.jpg, served straight by
 * Next's static file handler) has always sent one; this made the per-verdict
 * card the one OG image on the site that didn't, for no reason tied to the
 * image itself. Buffering it here costs one render's worth of memory (these
 * are ~1200x630 and ~764x1200 renders, not large) to make every OG image
 * this site serves send the same header shape.
 */
async function bufferedImageResponse(
  element: React.ReactElement,
  opts: { width: number; height: number; headers: Record<string, string> }
): Promise<Response> {
  const rendered = new ImageResponse(element, { width: opts.width, height: opts.height });
  const buf = await rendered.arrayBuffer();
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(buf.byteLength),
      ...opts.headers,
    },
  });
}

/**
 * Verdict share card, 1200×630 (design prompt 11) — or 764×1200 with
 * `?layout=portrait`, for the lanyard. Lime budget: the score
 * numeral if CLEAR; otherwise a thin lime rule under the wordmark.
 *
 * SATORI CONSTRAINT — every <div> below carries an explicit `display`, even the
 * text-only ones. Satori (behind next/og) throws "Expected <div> to have
 * explicit display" and next/og turns that into a *failed-to-pipe 500 with an
 * empty body* — the browser just shows a broken image with no clue why. Keep
 * `display` on every div you add here; use a single template literal rather
 * than mixing text and {expressions} as siblings.
 */
import { verdictRowById } from "@/lib/data/ledger";
import { isOwnToken } from "@/lib/sale/token";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const portrait = req.nextUrl.searchParams.get("layout") === "portrait";
  const v = await verdictRowById(Number(id) || 0);

  if (!v) {
    return new Response("verdict not found", { status: 404 });
  }
  // Our own token is never scored in public, so its receipts share the brand card.
  if (isOwnToken(v.token_address)) {
    return Response.redirect(new URL("/brand/og-default.jpg", req.nextUrl.origin), 302);
  }


  const clear = v.tier === "CLEAR";
  const checks = (v.checks as CheckResult[]).filter((c) => c.status !== "SKIP");
  // worst flags first for non-clear, best for clear
  const order = { CRITICAL: 0, FAIL: 1, WARN: 2, PASS: 3, SKIP: 4 } as const;
  const flags = [...checks]
    .sort((a, b) =>
      clear
        ? order[b.status] - order[a.status]
        : order[a.status] - order[b.status]
    )
    .slice(0, 3);

  const background = await courtBackground();

  const receiptLine = `Verdict #${v.id} · hash ${short(v.entry_hash)}${v.anchor_tx ? ` · anchored ${short(v.anchor_tx)}` : " · anchor pending"}`;

  if (portrait) {
    // The plate is 1200x630 and this frame is 764x1200, so it is scaled to
    // COVER and centred by hand — Satori's `objectFit` support is not something
    // to rely on, and a plate letterboxed across the top of a badge would read
    // as a bug rather than as a backdrop.
    const plateScale = Math.max(PORTRAIT_WIDTH / 1200, PORTRAIT_HEIGHT / 630);
    const plateW = Math.round(1200 * plateScale);
    const plateH = Math.round(630 * plateScale);

    return await bufferedImageResponse(
      (
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            background: "#0a0a0a",
            color: "#ededea",
            fontFamily: "Georgia, serif",
            padding: 40,
            // Everything below this line is under the painted SHARE button.
            paddingBottom: PORTRAIT_SHARE_RESERVE,
          }}
        >
          {background && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={background}
              alt=""
              width={plateW}
              height={plateH}
              style={{
                position: "absolute",
                top: Math.round((PORTRAIT_HEIGHT - plateH) / 2),
                left: Math.round((PORTRAIT_WIDTH - plateW) / 2),
                opacity: 0.9,
              }}
            />
          )}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: PORTRAIT_WIDTH,
              height: PORTRAIT_HEIGHT,
              display: "flex",
              background:
                "linear-gradient(180deg, #0a0a0a 0%, rgba(10,10,10,0.66) 24%, rgba(10,10,10,0.66) 74%, #0a0a0a 100%)",
            }}
          />

          {/* the numeral, stacked rather than set beside the detail */}
          <div style={{ position: "relative", display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                fontSize: 200,
                fontWeight: 900,
                lineHeight: 1,
                color: clear ? "#ccff00" : "#ededea",
              }}
            >
              {v.score}
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 54,
                letterSpacing: 10,
                color: "#ededea",
                marginTop: 4,
              }}
            >
              {v.tier}
            </div>
          </div>

          <div
            style={{
              position: "relative",
              display: "flex",
              flexDirection: "column",
              flex: 1,
              marginTop: 30,
              fontFamily: "monospace",
            }}
          >
            <div style={{ display: "flex", fontSize: 68, color: "#ededea" }}>
              {v.token_symbol ?? "UNKNOWN"}
            </div>
            <div style={{ display: "flex", fontSize: 32, color: "#8a8a8a", marginTop: 10 }}>
              {short(v.token_address)}
            </div>
            <div
              style={{ display: "flex", flexDirection: "column", marginTop: 34, gap: 18 }}
            >
              {flags.map((f) => (
                <div key={f.id} style={{ display: "flex", fontSize: 38 }}>
                  <div style={{ display: "flex", color: "#ededea", width: 160 }}>
                    {f.status}
                  </div>
                  <div style={{ display: "flex", color: "#8a8a8a" }}>{f.name}</div>
                </div>
              ))}
            </div>
          </div>

          <div
            style={{
              position: "relative",
              display: "flex",
              flexDirection: "column",
              borderTop: "1px solid #2a2a2a",
              paddingTop: 18,
            }}
          >
            {/*
              Three short lines, not the single `receiptLine` the landscape card
              uses: at a size that survives the reduction onto the badge, that
              one-liner is ~70 monospace characters and runs off the card.
            */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                fontSize: 24,
                color: "#8a8a8a",
                fontFamily: "monospace",
                marginBottom: 16,
              }}
            >
              <div style={{ display: "flex" }}>{`VERDICT #${v.id}`}</div>
              <div style={{ display: "flex" }}>{`HASH ${short(v.entry_hash)}`}</div>
              <div style={{ display: "flex" }}>
                {v.anchor_tx ? `ANCHORED ${short(v.anchor_tx)}` : "ANCHOR PENDING"}
              </div>
            </div>
            <div style={{ display: "flex", fontSize: 36, letterSpacing: 8, color: "#ededea" }}>
              ROBINCALLS
            </div>
            {!clear && (
              <div style={{ width: 240, height: 3, background: "#ccff00", marginTop: 8 }} />
            )}
          </div>
        </div>
      ),
      {
        width: PORTRAIT_WIDTH,
        height: PORTRAIT_HEIGHT,
        headers: {
          "Cache-Control":
            "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
        },
      }
    );
  }

  return await bufferedImageResponse(
    (
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#0a0a0a",
          color: "#ededea",
          fontFamily: "Georgia, serif",
          padding: 56,
        }}
      >
        {/* The courtroom plate and its scrim. Both are absolutely positioned, so
            the two content blocks below must be positioned too — CSS paints
            positioned boxes above in-flow ones regardless of source order, and
            without `position` on the content the plate would bury the verdict. */}
        {background && (
          // This tree is rendered by Satori, not the DOM — next/image has no
          // loader here, so the raw <img> is the only option.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={background}
            alt=""
            width={1200}
            height={630}
            style={{ position: "absolute", top: 0, left: 0, opacity: 0.9 }}
          />
        )}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 1200,
            height: 630,
            display: "flex",
            background:
              "linear-gradient(180deg, #0a0a0a 0%, rgba(10,10,10,0.62) 22%, rgba(10,10,10,0.62) 78%, #0a0a0a 100%)",
          }}
        />

        <div style={{ position: "relative", display: "flex", flex: 1 }}>
          {/* left: the numeral */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              width: 420,
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: 260,
                fontWeight: 900,
                lineHeight: 1,
                color: clear ? "#ccff00" : "#ededea",
              }}
            >
              {v.score}
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 44,
                letterSpacing: 10,
                color: "#ededea",
                marginTop: 8,
              }}
            >
              {v.tier}
            </div>
          </div>

          {/* right: token + flags + receipt strip */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              flex: 1,
              paddingLeft: 48,
              fontFamily: "monospace",
            }}
          >
            <div style={{ display: "flex", fontSize: 40, color: "#ededea" }}>
              {v.token_symbol ?? "UNKNOWN"}
            </div>
            <div style={{ display: "flex", fontSize: 22, color: "#8a8a8a", marginTop: 6 }}>
              {short(v.token_address)}
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                marginTop: 36,
                gap: 12,
              }}
            >
              {flags.map((f) => (
                <div key={f.id} style={{ display: "flex", fontSize: 22 }}>
                  <div style={{ display: "flex", color: "#ededea", width: 120 }}>
                    {f.status}
                  </div>
                  <div style={{ display: "flex", color: "#8a8a8a" }}>{f.name}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", fontSize: 18, color: "#8a8a8a", marginTop: 40 }}>
              {receiptLine}
            </div>
          </div>
        </div>

        {/* bottom bar */}
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderTop: "1px solid #2a2a2a",
            paddingTop: 24,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 26, letterSpacing: 6, color: "#ededea" }}>
              ROBINCALLS
            </div>
            {!clear && (
              <div
                style={{
                  width: 220,
                  height: 3,
                  background: "#ccff00",
                  marginTop: 6,
                }}
              />
            )}
          </div>
          <div
            style={{ display: "flex", fontSize: 18, color: "#8a8a8a", fontFamily: "monospace" }}
          >
            On-chain. On record. On time. · robincalls.com
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
      },
    }
  );
}
