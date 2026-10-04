import Link from "next/link";
import type { ReactNode } from "react";
import { cdnUrl } from "@/lib/config/cdn";
import { SmartImage } from "../SmartImage";

/**
 * The landing page's one type scale, in one file.
 *
 * Every section below the hero repeats the same three-part head (eyebrow /
 * display line / one-line standfirst) and the reference comps hold those at a
 * fixed size across the whole page. Nine hand-tuned copies drifted last pass —
 * four different heading sizes and three eyebrow trackings — which is what
 * read as "the layout does not match".
 *
 * Headings carry no colour. Accents live on the eyebrow, the product tiles and
 * the row chrome (palette.ts); a coloured word in every heading is what
 * flattened the page's emphasis last pass, because when everything is accented
 * nothing is.
 */

export function Eyebrow({
  children,
  dot = false,
  accent,
}: {
  children: ReactNode;
  dot?: boolean;
  /** Section identity (palette.ts). Tints the eyebrow and its dot only. */
  accent?: string;
}) {
  return (
    <p
      style={accent ? { color: accent } : undefined}
      className="mb-2.5 flex items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[0.26em] text-[#8a8a8a]"
    >
      {dot && (
        <span
          style={{ background: accent ?? "#ccff00" }}
          className="h-1.5 w-1.5 shrink-0 rounded-full"
        />
      )}
      {children}
    </p>
  );
}

export function Display({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <h2
      className={`font-cinzel text-[24px] font-bold uppercase leading-[1.08] tracking-[0.01em] text-[#ededea] sm:text-[30px] xl:text-[34px] ${className}`}
    >
      {children}
    </h2>
  );
}

export function Standfirst({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={`mt-2.5 font-inter text-[13px] leading-relaxed text-[#8a8a8a] xl:text-[14px] ${className}`}
    >
      {children}
    </p>
  );
}

/** Outlined action. The comps use this for every secondary CTA (VIEW ALL, BROWSE RWAs, SEE FULL METHODOLOGY). */
export function GhostButton({
  href,
  children,
  className = "",
  accent,
}: {
  href: string;
  children: ReactNode;
  className?: string;
  /** A PRODUCT_ACCENT hex, when the button belongs to one product. Border and
   *  text only: the shadow stays neutral so it reads as depth, not a second
   *  accent. Omit it for paper, which is still the default. */
  accent?: string;
}) {
  return (
    <Link
      href={href}
      style={accent ? { borderColor: accent, color: accent } : undefined}
      className={`brutalist-box brutalist-shadow-dark brutalist-pressable halftone-dark inline-block whitespace-nowrap border-[#ededea] px-4 py-2.5 font-inter text-[10px] font-bold uppercase tracking-[0.16em] text-[#ededea] xl:text-[11px] ${className}`}
    >
      {children}
    </Link>
  );
}

/** Filled lime action — one per section, at most. */
export function LimeButton({
  href,
  children,
  className = "",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`brutalist-box brutalist-shadow-dark brutalist-pressable halftone-light inline-block whitespace-nowrap border-[#ccff00] bg-[#ccff00] px-5 py-3 font-inter text-[10px] font-bold uppercase tracking-[0.16em] text-[#0a0a0a] xl:text-[11px] ${className}`}
    >
      {children}
    </Link>
  );
}

/**
 * One backdrop spanning several consecutive sections.
 *
 * A per-section backdrop restarts the gradient at every seam, so a run of
 * bands reads as separate panels. This paints the art ONCE across the whole
 * run: the children keep their own borders and padding but must not paint
 * their own background, which is what the `bg-transparent` override does.
 *
 * Same non-negotiable as `Section`: an absolutely positioned img, never
 * `backdrop-filter` and never `fixed`. Both paint empty inside Lenis's
 * transformed wrapper.
 */
export function SectionBand({
  backdrop,
  children,
}: {
  /** Path under /public, e.g. "/backgrounds/rwa-bg.webp". */
  backdrop: string;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <SmartImage
          src={cdnUrl(backdrop)}
          alt=""
          aria-hidden
          className="absolute left-0 top-0 h-full w-full object-cover object-center opacity-70"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, #0A0A0A 0%, rgba(10,10,10,0.76) 18%, rgba(10,10,10,0.76) 82%, #0A0A0A 100%)",
          }}
        />
      </div>
      <div className="relative z-10 [&>section]:bg-transparent">{children}</div>
    </div>
  );
}

/**
 * Section shell. `py` is deliberately tight — the comps run roughly 56px of
 * air above a section head at desktop, not the 96px a default rhythm gives,
 * and that density is most of what makes them read as one page rather than a
 * stack of landing sections.
 */
export function Section({
  id,
  children,
  className = "",
  backdrop,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
  /**
   * Art behind the band, e.g. "/backgrounds/rwa-bg.webp" — the same image that
   * section's own page uses, so the landing reads as a preview of it.
   *
   * Opacity and gradient below are copied from /rwa (RwaPageClient) on purpose.
   * At the previous 0.38 the composite landed near 10% over near-black art and
   * the band read as flat black: the image loaded and laid out correctly, so
   * nothing looked broken.
   *
   * Deliberately NOT `backdrop-blur` or a fixed layer: both are the trap from
   * the RWA card, where `backdrop-filter` inside Lenis's transformed wrapper
   * painted empty. This is an absolutely positioned img under a gradient that
   * reaches near-solid before the content starts.
   */
  backdrop?: string;
}) {
  return (
    <section
      id={id}
      className={`relative border-t border-[#2a2a2a] bg-[#0a0a0a] px-4 py-11 sm:px-8 sm:py-16 ${className}`}
    >
      {backdrop && (
        <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
          <SmartImage
            src={cdnUrl(backdrop)}
            alt=""
            aria-hidden
            className="absolute left-0 top-0 h-full w-full object-cover object-center opacity-70"
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, #0A0A0A 0%, rgba(10,10,10,0.80) 25%, rgba(10,10,10,0.80) 75%, #0A0A0A 100%)",
            }}
          />
        </div>
      )}
      <div className="relative z-10 mx-auto max-w-[1320px]">{children}</div>
    </section>
  );
}
