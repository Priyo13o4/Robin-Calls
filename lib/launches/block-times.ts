/**
 * Block number to time by linear interpolation between exact header anchors.
 * Measured 2026-09-13: anchors 570 blocks apart err by 0.3s mean, 0.7s max; the
 * loop writes one anchor a minute, so a header per trade block is never needed.
 */

export interface BlockAnchor {
  block: number;
  /** Unix milliseconds. */
  ms: number;
}

/**
 * Time for `block` from anchors sorted ascending. Interpolates between the
 * bracketing pair; outside the range, extrapolates from the nearest pair but
 * never further than `maxExtrapolateBlocks`, beyond which it answers null.
 */
export function interpolateBlockTime(
  anchors: readonly BlockAnchor[],
  block: number,
  maxExtrapolateBlocks = 20_000,
): number | null {
  if (anchors.length === 0) return null;
  const exact = anchors.find((a) => a.block === block);
  if (exact) return exact.ms;
  if (anchors.length === 1) return null;

  let lo = anchors[0]!;
  let hi = anchors[1]!;
  if (block > anchors[anchors.length - 1]!.block) {
    lo = anchors[anchors.length - 2]!;
    hi = anchors[anchors.length - 1]!;
    if (block - hi.block > maxExtrapolateBlocks) return null;
  } else if (block < anchors[0]!.block) {
    if (anchors[0]!.block - block > maxExtrapolateBlocks) return null;
  } else {
    for (let i = 1; i < anchors.length; i++) {
      if (anchors[i]!.block >= block) {
        lo = anchors[i - 1]!;
        hi = anchors[i]!;
        break;
      }
    }
  }
  if (hi.block === lo.block) return null;
  return Math.round(lo.ms + ((block - lo.block) * (hi.ms - lo.ms)) / (hi.block - lo.block));
}
