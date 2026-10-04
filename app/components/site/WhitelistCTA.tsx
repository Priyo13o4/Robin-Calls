'use client';

import React, { useEffect, useState } from 'react';
import { WhitelistModal } from './WhitelistModal';
import { flags } from '@/lib/config/flags';

/**
 * Whitelist CTA section — sits between Roadmap and Footer on the landing page.
 * Self-contained: owns the modal open/close state. The parent just renders
 * <WhitelistCTA /> and nothing else is needed.
 *
 * Design: noir canvas, venetian-blind light bars (same motif as the Manifesto
 * section), film grain, and the single lime CTA button. The copy follows the
 * brand voice from DESIGN.md — vigilante authority, myth meets machine.
 */
export function WhitelistCTA() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);

  if (!flags.whitelist) return null;

  // Re-open the modal when we land back from a social redirect — X
  // (/api/whitelist/x/callback → /?x=connected|error) or Telegram
  // (/api/whitelist/telegram/verify → /?tg=connected|error) — then strip the
  // query params so a refresh doesn't re-trigger it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const x = params.get('x');
    const tg = params.get('tg');
    const kind = x ? 'x' : tg ? 'tg' : null;
    const value = x ?? tg;
    if (value !== 'connected' && value !== 'error') return;
    const reason = value === 'error' ? params.get('reason') : null;
    params.delete(kind === 'x' ? 'x' : 'tg');
    params.delete('reason');
    const qs = params.toString();
    const url =
      window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
    window.history.replaceState(null, '', url);
    // One-time init driven by the OAuth return URL (an external navigation),
    // not derived state — opening the modal here is the intended effect.
    /* eslint-disable react-hooks/set-state-in-effect */
    setOauthError(reason);
    setIsModalOpen(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  return (
    <>
      <section
        id="whitelist"
        data-screen-label="Whitelist"
        style={{
          position: 'relative',
          background: '#0A0A0A',
          overflow: 'hidden',
          padding: 'clamp(96px, 14vh, 200px) clamp(24px, 6vw, 80px)',
          borderTop: '1px solid #2A2A2A',
        }}
      >
        {/* venetian-blind light bars — same motif as Manifesto section */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 0,
            pointerEvents: 'none',
            background:
              'repeating-linear-gradient(180deg, rgba(237,237,234,0.04) 0px, rgba(237,237,234,0.04) 1px, transparent 1px, transparent 40px)',
          }}
        />
        {/* diagonal light shaft */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 0,
            pointerEvents: 'none',
            background:
              'linear-gradient(115deg, rgba(237,237,234,0.06) 0%, transparent 35%), radial-gradient(ellipse 50% 60% at 50% 40%, rgba(204,255,0,0.02), transparent 70%)',
          }}
        />
        {/* film grain */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 1,
            pointerEvents: 'none',
            opacity: 0.05,
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23n)'/%3E%3C/svg%3E\")",
          }}
        />

        <div
          data-reveal
          style={{
            position: 'relative',
            zIndex: 2,
            maxWidth: '720px',
            margin: '0 auto',
            textAlign: 'center',
          }}
        >
          {/* eyebrow */}
          <p
            style={{
              margin: '0 0 16px',
              fontFamily: 'Inter, sans-serif',
              fontWeight: 500,
              fontSize: '11px',
              letterSpacing: '0.28em',
              textTransform: 'uppercase',
              color: '#8a8a8a',
            }}
          >
            Whitelist
          </p>

          {/* headline */}
          <h2
            style={{
              margin: '0 0 24px',
              fontFamily: "Cinzel, Georgia, 'Times New Roman', serif",
              fontWeight: 700,
              fontSize: 'clamp(2rem, 5.5vw, 3.5rem)',
              lineHeight: 1.02,
              color: '#EDEDEA',
              textWrap: 'balance',
            }}
          >
            The list is{' '}
            <span style={{ color: '#CCFF00' }}>open.</span>
          </h2>

          {/* body */}
          <div
            style={{
              maxWidth: '540px',
              margin: '0 auto 44px',
              fontFamily: 'Inter, sans-serif',
              fontWeight: 400,
              fontSize: 'clamp(0.95rem, 1.3vw, 1.1rem)',
              lineHeight: 1.72,
              color: '#8a8a8a',
            }}
          >
            <p style={{ margin: '0 0 16px' }}>
              Gated features. Early access. One wallet, one spot. Secure your
              allocation before the token goes live.
            </p>
            <p style={{ margin: 0 }}>
              Connect your X, complete the social onboarding, and prove you
              control a wallet.{' '}
              <span style={{ color: '#EDEDEA' }}>
                That&apos;s the whole requirement.
              </span>
            </p>
          </div>

          {/* CTA button — the one lime element in this viewport */}
          <button
            onClick={() => setIsModalOpen(true)}
            className="brutalist-box brutalist-pressable"
            style={{
              fontFamily: 'Inter, sans-serif',
              fontWeight: 700,
              fontSize: '13px',
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: '#0A0A0A',
              background: '#CCFF00',
              border: '2px solid #CCFF00',
              padding: '16px 52px',
              cursor: 'pointer',
              boxShadow: '6px 6px 0px 0px rgba(204, 255, 0, 0.25)',
              transition: 'all 0.2s ease',
            }}
          >
            Get Early Access
          </button>

          {/* sub-note */}
          <p
            style={{
              margin: '28px 0 0',
              fontFamily: "Georgia, 'Times New Roman', serif",
              fontStyle: 'italic',
              fontSize: '14px',
              color: '#3D3D3D',
            }}
          >
            Three steps. No gas. No cost.
          </p>
        </div>
      </section>

      {/* Modal lives outside the section so it covers the full viewport */}
      <WhitelistModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setOauthError(null);
        }}
        initialError={oauthError}
      />
    </>
  );
}
