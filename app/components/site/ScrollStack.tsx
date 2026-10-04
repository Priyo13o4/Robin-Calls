'use client';

import React, { useCallback, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';

/**
 * A scroll-pinned card stack: each card pins in place and the next one slides
 * over it, scaling/blurring the ones underneath. Deliberately does NOT spin
 * up its own Lenis instance — the page already runs one (see app/page.tsx)
 * driving GSAP ScrollTrigger, and Lenis keeps `window.scrollY` in sync with
 * the smoothed scroll position. A second Lenis bound to `window` would fight
 * the first for control of wheel/touch input. Reading `window.scrollY` on a
 * rAF loop rides the same smoothed value for free.
 */

export interface ScrollStackItemProps {
  itemClassName?: string;
  children: ReactNode;
}

export const ScrollStackItem: React.FC<ScrollStackItemProps> = ({ children, itemClassName = '' }) => (
  <div
    className={`scroll-stack-card relative w-full box-border origin-top will-change-transform ${itemClassName}`.trim()}
    style={{ backfaceVisibility: 'hidden', transformStyle: 'preserve-3d' }}
  >
    {children}
  </div>
);

interface Transform {
  translateY: number;
  scale: number;
  rotation: number;
  blur: number;
}

interface ScrollStackProps {
  className?: string;
  children: ReactNode;
  itemDistance?: number;
  itemScale?: number;
  itemStackDistance?: number;
  stackPosition?: string;
  scaleEndPosition?: string;
  baseScale?: number;
  rotationAmount?: number;
  blurAmount?: number;
  onStackComplete?: () => void;
}

const ScrollStack: React.FC<ScrollStackProps> = ({
  children,
  className = '',
  itemDistance = 90,
  itemScale = 0.02,
  itemStackDistance = 26,
  stackPosition = '18%',
  scaleEndPosition = '8%',
  baseScale = 0.86,
  rotationAmount = 0,
  blurAmount = 0,
  onStackComplete,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const stackCompletedRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const cardsRef = useRef<HTMLElement[]>([]);
  const lastTransformsRef = useRef(new Map<number, Transform>());

  const calculateProgress = useCallback((scrollTop: number, start: number, end: number) => {
    if (end === start) return scrollTop >= end ? 1 : 0;
    if (scrollTop < start) return 0;
    if (scrollTop > end) return 1;
    return (scrollTop - start) / (end - start);
  }, []);

  const parsePercentage = useCallback((value: string | number, containerHeight: number) => {
    if (typeof value === 'string' && value.includes('%')) {
      return (parseFloat(value) / 100) * containerHeight;
    }
    return parseFloat(value as string);
  }, []);

  // getBoundingClientRect reflects the CURRENT rendered (already-transformed)
  // position, so on every frame after the first we must subtract out
  // whatever translateY we applied last frame to recover the card's true,
  // untransformed document offset. Skipping this makes the pinned-card math
  // self-referential (this frame's transform depends on last frame's
  // transform) and the card visibly oscillates between two positions.
  const dynamicOffset = useCallback((card: HTMLElement) => {
    const idx = cardsRef.current.indexOf(card);
    return lastTransformsRef.current.get(idx)?.translateY ?? 0;
  }, []);

  const updateCardTransforms = useCallback(() => {
    const cards = cardsRef.current;
    if (!cards.length) return;

    const scrollTop = window.scrollY;
    const containerHeight = window.innerHeight;
    const stackPositionPx = parsePercentage(stackPosition, containerHeight);
    const scaleEndPositionPx = parsePercentage(scaleEndPosition, containerHeight);

    const endEl = containerRef.current?.querySelector('.scroll-stack-end') as HTMLElement | null;
    const endElementTop = endEl ? endEl.getBoundingClientRect().top + window.scrollY : 0;

    cards.forEach((card, i) => {
      const cardTop = card.getBoundingClientRect().top + window.scrollY - dynamicOffset(card);
      const triggerStart = cardTop - stackPositionPx - itemStackDistance * i;
      const triggerEnd = cardTop - scaleEndPositionPx;
      const pinStart = triggerStart;
      const pinEnd = endElementTop - containerHeight / 2;

      const scaleProgress = calculateProgress(scrollTop, triggerStart, triggerEnd);
      const targetScale = baseScale + i * itemScale;
      const scale = 1 - scaleProgress * (1 - targetScale);
      const rotation = rotationAmount ? i * rotationAmount * scaleProgress : 0;

      let blur = 0;
      if (blurAmount) {
        let topCardIndex = 0;
        for (let j = 0; j < cards.length; j++) {
          const jCardTop = cards[j].getBoundingClientRect().top + window.scrollY - dynamicOffset(cards[j]);
          const jTriggerStart = jCardTop - stackPositionPx - itemStackDistance * j;
          if (scrollTop >= jTriggerStart) topCardIndex = j;
        }
        if (i < topCardIndex) blur = Math.max(0, (topCardIndex - i) * blurAmount);
      }

      let translateY = 0;
      const isPinned = scrollTop >= pinStart && scrollTop <= pinEnd;
      if (isPinned) {
        translateY = scrollTop - cardTop + stackPositionPx + itemStackDistance * i;
      } else if (scrollTop > pinEnd) {
        translateY = pinEnd - cardTop + stackPositionPx + itemStackDistance * i;
      }

      const next: Transform = {
        translateY: Math.round(translateY * 100) / 100,
        scale: Math.round(scale * 1000) / 1000,
        rotation: Math.round(rotation * 100) / 100,
        blur: Math.round(blur * 100) / 100,
      };
      const prev = lastTransformsRef.current.get(i);
      const changed =
        !prev ||
        Math.abs(prev.translateY - next.translateY) > 0.1 ||
        Math.abs(prev.scale - next.scale) > 0.001 ||
        Math.abs(prev.rotation - next.rotation) > 0.1 ||
        Math.abs(prev.blur - next.blur) > 0.1;

      if (changed) {
        card.style.transform = `translate3d(0, ${next.translateY}px, 0) scale(${next.scale}) rotate(${next.rotation}deg)`;
        card.style.filter = next.blur > 0 ? `blur(${next.blur}px)` : '';
        lastTransformsRef.current.set(i, next);
      }

      if (i === cards.length - 1) {
        const inView = scrollTop >= pinStart && scrollTop <= pinEnd;
        if (inView && !stackCompletedRef.current) {
          stackCompletedRef.current = true;
          onStackComplete?.();
        } else if (!inView && stackCompletedRef.current) {
          stackCompletedRef.current = false;
        }
      }
    });
  }, [
    itemScale,
    itemStackDistance,
    stackPosition,
    scaleEndPosition,
    baseScale,
    rotationAmount,
    blurAmount,
    onStackComplete,
    calculateProgress,
    parsePercentage,
    dynamicOffset,
  ]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const cards = Array.from(container.querySelectorAll<HTMLElement>('.scroll-stack-card'));
    cardsRef.current = cards;
    const transformsCache = lastTransformsRef.current;

    cards.forEach((card, i) => {
      if (i < cards.length - 1) card.style.marginBottom = `${itemDistance}px`;
      card.style.willChange = 'transform, filter';
      card.style.transformOrigin = 'top center';
    });

    /*
      The loop idles unless the stack is actually near the viewport.

      `updateCardTransforms` calls `getBoundingClientRect()` on every card — and
      again on every card inside the blur pass, so it is O(n²) reads — then
      writes `transform` back. Reading geometry after writing style forces a
      synchronous layout, and this ran unconditionally on every frame from the
      moment the page mounted, for a section most of a 16,000px document below
      the fold.

      That cost lands on the one thread the intro's animation also needs. It is
      why the loading screen stuttered near its end on a phone and desktop was
      fine: same work, hardware that could hide it. Off-screen there is nothing
      to compute, so compute nothing — this is a pure removal of wasted work,
      not a behaviour change.

      Margin is a full viewport, so the stack is already settled before it can
      be seen. If IntersectionObserver is missing, stay active — the old
      behaviour, which is correct but wasteful, beats a stack that never moves.
    */
    let active = typeof IntersectionObserver === 'undefined';
    const io =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(
            (entries) => {
              active = entries.some((e) => e.isIntersecting);
            },
            { rootMargin: '100% 0px' }
          );
    io?.observe(container);

    const loop = () => {
      if (active) updateCardTransforms();
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      io?.disconnect();
      cards.forEach((card) => {
        card.style.transform = '';
        card.style.filter = '';
      });
      cardsRef.current = [];
      transformsCache.clear();
      stackCompletedRef.current = false;
    };
  }, [itemDistance, updateCardTransforms]);

  return (
    <div ref={containerRef} className={`relative w-full ${className}`.trim()}>
      {children}
      {/* Marks where the last card's pin releases — needs real height below it
          (pb- on the parent section) so the release has scroll distance to play out. */}
      <div className="scroll-stack-end h-px w-full" />
    </div>
  );
};

export default ScrollStack;
