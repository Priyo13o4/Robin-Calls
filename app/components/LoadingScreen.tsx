'use client';

import React, { useEffect, useRef } from 'react';
import { cdnUrl } from '@/lib/config/cdn';
import { currentLivePhase } from '@/lib/config/phases';

/**
 * The intro.
 *
 * ## Why there is no animation library in this file
 *
 * This was a GSAP timeline plus ~75 framer-motion nodes for the letter stagger.
 * Both are main-thread engines: they recompute every frame in JS and depend on
 * `requestAnimationFrame` continuing to be called. The one moment this screen is
 * on display is also the busiest the main thread ever gets on this page —
 * hydration, image decode, and the landing page's own setup all land here — so
 * that is the worst possible place to be spending it.
 *
 * Worse than slow, it was fragile. When the ticker stalled, the timeline stopped
 * where it was, and because dismissal hung off the timeline's `onComplete`, a
 * stalled ticker meant the screen never left. Every guard added to catch that
 * was itself a tween, so it could not run either.
 *
 * These animations are CSS. They run on the compositor, cost no JS per frame,
 * and complete whether or not the main thread is free.
 *
 * ## Dismissal is a timer, and only a timer
 *
 * `INTRO_MS` owns the handoff. Not `animationend`, not an animation callback —
 * one `setTimeout`, which keeps running when rAF does not. The animations are
 * decoration; if every one of them failed to render, this screen would still
 * hand over on schedule. That is the property the old one lacked.
 *
 * ## Timing (owner's instruction: text visible at load, images still animate,
 * tail cut)
 *
 * The heading and the three lines are legible from the first frame rather than
 * waiting 1.8s, the character and skyline keep their entrances, and the long
 * 1.5s exit is now 0.6s. Total 4.5s → 2.8s.
 */
const SKYLINE_START_MS = 1000;
const FADE_START_MS = 2200;
const FADE_MS = 600;
const INTRO_MS = FADE_START_MS + FADE_MS;

/** GSAP's power2.out / power4.out, so the motion reads the same as before. */
const EASE_OUT_2 = 'cubic-bezier(0.215, 0.61, 0.355, 1)';
const EASE_OUT_4 = 'cubic-bezier(0.165, 0.84, 0.44, 1)';

interface LoadingScreenProps {
  onComplete: () => void;
}

/**
 * One line of the strapline, one span per character.
 *
 * Plain spans with an inline `animation-delay`. framer-motion did this with a
 * component and a motion value per character; the rendered result is the same
 * and this one has no runtime.
 */
function StaggerLine({ text, start = 0 }: { text: string; start?: number }) {
  return (
    <span className="flex flex-wrap justify-start">
      {text.split('').map((char, i) => (
        <span
          key={i}
          style={{ animation: `rc-intro-letter 400ms ease-out ${start + i * 20}ms both` }}
        >
          {char === ' ' ? ' ' : char}
        </span>
      ))}
    </span>
  );
}

export default function LoadingScreen({ onComplete }: LoadingScreenProps) {
  // The parent passes an inline arrow, so it is a new reference every render.
  // Held in a ref and written from an effect — mutating a ref during render
  // breaks under concurrent rendering, where a render can be discarded.
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  });

  useEffect(() => {
    const timer = setTimeout(() => onCompleteRef.current(), INTRO_MS);
    return () => clearTimeout(timer);
  }, []);

  const phase = currentLivePhase();

  return (
    <div
      data-intro
      /* Swallows input rather than `pointer-events-none`.
         A full-screen overlay that takes no input is not inert — it is
         invisible to the finger, and taps aimed at it landed on SiteNav
         underneath, whose wordmark and SCAN action span the top of the screen.
         A tap during the intro could therefore navigate the router. */
      className="fixed inset-0 z-50 overflow-hidden bg-[#0A0A0A]"
      style={{ animation: `rc-intro-out ${FADE_MS}ms ease-in-out ${FADE_START_MS}ms both` }}
    >
      {/* Skyline (back) */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={cdnUrl('/scene/city-skyline.webp')}
        alt=""
        className="absolute left-0 top-0 h-[100%] w-full object-cover object-[65%_10%] md:h-[115%] md:object-[78%_15%]"
        style={{ animation: `rc-intro-skyline 1200ms ${EASE_OUT_4} ${SKYLINE_START_MS}ms both` }}
      />

      {/* Character (front) */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={cdnUrl('/scene/char-platform.webp')}
        alt=""
        className="absolute left-0 top-0 h-[100%] w-full object-cover object-[65%_10%] md:h-[115%] md:object-[78%_15%]"
        style={{ animation: `rc-intro-character 1500ms ${EASE_OUT_2} both` }}
      />

      {/* Scrims, matching the hero's gradients exactly so the handoff is seamless */}
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{ background: 'linear-gradient(90deg, #0A0A0A 0%, rgba(10,10,10,0.94) 24%, rgba(10,10,10,0.55) 44%, rgba(10,10,10,0) 62%)' }}
      />
      <div
        className="pointer-events-none absolute inset-0 z-10"
        style={{ background: 'linear-gradient(180deg, rgba(10,10,10,0.55) 0%, rgba(10,10,10,0) 26%, rgba(10,10,10,0) 74%, rgba(10,10,10,0.4) 100%)' }}
      />

      <section
        className="absolute inset-0 z-20 box-border flex items-start"
        style={{ padding: 'clamp(120px, 15vh, 200px) clamp(24px, 5vw, 64px) 56px' }}
      >
        <div className="flex flex-col items-start" style={{ maxWidth: 'min(900px, 94vw)' }}>
          <h2
            className="mb-8 font-cinzel text-3xl font-bold uppercase leading-tight tracking-[0.02em] text-[#EDEDEA] md:mb-12 md:text-5xl lg:text-7xl"
            style={{ animation: 'rc-intro-appear 600ms ease-out both' }}
          >
            {/* Derived, not written down: `currentLivePhase()` is the furthest
                phase in lib/config/phases.ts still marked live, so this line
                cannot fall behind the ladder the way the hardcoded "Phase 1"
                did once the Robin Knight shipped. */}
            <span className="text-[#CCFF00]">{phase.label}:</span>{' '}
            <br className="md:hidden" />
            <br />
            {phase.title} is Live
          </h2>

          <div
            className="flex flex-col items-start font-inter text-xs uppercase leading-[2.4] tracking-[0.25em] text-[#8a8a8a] md:text-base lg:text-xl"
            style={{ animation: `rc-intro-text 1000ms ${EASE_OUT_2} both` }}
          >
            <StaggerLine text="Development needs time." />
            <StaggerLine text="Precision needs patience." />
            <StaggerLine text="Perfection needs Knowledge." />
          </div>
        </div>
      </section>

      {/* film grain */}
      <div
        className="pointer-events-none absolute inset-0 z-30 opacity-[0.055]"
        style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23n)'/%3E%3C/svg%3E\")" }}
      />
    </div>
  );
}
