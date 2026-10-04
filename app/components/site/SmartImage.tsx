import type { ImgHTMLAttributes, Ref } from "react";

/**
 * The shared `<img>` for this app. Use it instead of a bare tag anywhere an
 * image is rendered in a list, a card, or below the fold.
 *
 * Why it exists: `/ecosystem` shipped 180 images with zero of them deferred and
 * `/rwa` shipped 196, because every call site wrote its own tag and none of them
 * carried `loading`. A default in one module is the only version of this that
 * cannot drift back.
 *
 * `next/image` is deliberately NOT the answer here: this deploy has no `sharp`,
 * the optimizer would stream and re-encode third-party banner bytes through the
 * VPS, and most of these sources are remote hosts we do not control.
 *
 * Two rules for callers:
 *  - Pass `priority` ONLY for an image that is above the fold on first paint.
 *    A lazy LCP image is slower than no change at all.
 *  - Pass `width`/`height` (or `aspect-*` on the box) whenever the layout does
 *    not already reserve the space. A deferred image with no reserved box moves
 *    the page when it lands.
 */
export type SmartImageProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "loading" | "decoding" | "fetchPriority"
> & {
  /** Above the fold on first paint: load eagerly at high priority. */
  priority?: boolean;
  /** React 19 passes `ref` as a plain prop; declared so callers can observe the tag. */
  ref?: Ref<HTMLImageElement>;
};

export function SmartImage({ priority = false, alt = "", ...rest }: SmartImageProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...rest}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      // Off the main thread either way; the browser only honours it for images
      // it has not already blocked on, which a lazy one never is.
      decoding="async"
    />
  );
}
