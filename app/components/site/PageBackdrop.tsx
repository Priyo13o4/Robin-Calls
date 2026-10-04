import { cdnUrl } from "@/lib/config/cdn";

/**
 * A full-bleed page backdrop: art, vignette and grain, fixed behind the shell.
 *
 * The gradient is weighted to the TOP, where the page header sits over open
 * space, and reaches near-solid before the content cards start. These pages
 * carry tables and a payment form over art with a lit centre, so the middle of
 * the frame has to go dark or the cards lose their edges.
 *
 * Decorative, so `alt` is empty: the art states nothing the page does not.
 */
export function PageBackdrop({
  src,
  opacity = 0.55,
}: {
  /** Path under /public, e.g. "/backgrounds/token-sale-bg.webp". */
  src: string;
  opacity?: number;
}) {
  return (
    <>
      <div className="pointer-events-none fixed inset-0 z-0 bg-[#0a0a0a]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={cdnUrl(src)}
          alt=""
          aria-hidden
          className="absolute left-0 top-0 h-full w-full object-cover object-center"
          style={{ opacity }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(10,10,10,0.42) 0%, rgba(10,10,10,0.78) 32%, rgba(10,10,10,0.94) 58%, #0A0A0A 100%)",
          }}
        />
      </div>
      <div className="halftone-dark pointer-events-none fixed inset-0 z-[1] opacity-[0.22]" />
    </>
  );
}
