import type { CSSProperties } from 'react';
import Link from 'next/link';
import { cdnUrl } from '@/lib/config/cdn';
import { SmartImage } from "./SmartImage";

const socialLinkStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontFamily: 'var(--font-inter), Inter, sans-serif',
  fontSize: '14px',
  color: '#A3A3A3',
};

function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161c-.18 1.897-.962 6.502-1.36 8.627-.168.9-.499 1.2-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212-.07-.062-.174-.041-.249-.024-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.301.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.831-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472z" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-10 6L2 7" />
    </svg>
  );
}

function ForumIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function SiteFooter() {
  return (
    <footer data-screen-label="Footer" style={{ position: 'relative', overflow: 'hidden', background: '#0A0A0A', borderTop: '1px solid #2A2A2A', padding: 'clamp(64px, 9vh, 96px) clamp(24px, 6vw, 80px) 48px' }}>
      {/* Skyline Overlay */}
      <div className="absolute inset-0 z-0 pointer-events-none opacity-40">
        <SmartImage
          src={cdnUrl("/scene/city-skyline.webp")}
          alt=""
          className="w-full h-full object-cover object-[65%_35%] md:object-[78%_40%]"
        />
        {/* Gradients to blend the edges smoothly into the dark background */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0A0A0A] via-transparent to-[#0A0A0A] opacity-90"></div>
      </div>

      <div data-reveal style={{ position: 'relative', zIndex: 1, maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '40px', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ maxWidth: '380px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/logo-sm.webp" alt="RobinCalls logomark" style={{ width: '40px', height: '40px', objectFit: 'contain' }} />
              <span style={{ fontFamily: 'var(--font-cinzel), Cinzel, Georgia, serif', fontWeight: 700, fontSize: '20px', letterSpacing: '0.22em', color: '#EDEDEA' }}>ROBINCALLS</span>
            </div>
            <p style={{ margin: 0, fontFamily: 'var(--font-cinzel), Cinzel, Georgia, serif', fontWeight: 600, fontStyle: 'italic', fontSize: '1.05rem', color: '#EDEDEA' }}>On-chain. On record. On time.</p>
          </div>
          <div style={{ display: 'flex', gap: '56px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <span style={{ fontFamily: 'var(--font-inter), Inter, sans-serif', fontSize: '11px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#888888', marginBottom: '4px' }}>Follow</span>
              <a href="https://x.com/RobinCalls" target="_blank" rel="noopener noreferrer" style={socialLinkStyle} className="hover:text-[#EDEDEA] transition-colors"><XIcon /> X / Twitter</a>
              <a href="https://t.me/RobinCallsChat" target="_blank" rel="noopener noreferrer" style={socialLinkStyle} className="hover:text-[#EDEDEA] transition-colors"><TelegramIcon /> Telegram Chat</a>
              <a href="https://t.me/RobinCallsAnn" target="_blank" rel="noopener noreferrer" style={socialLinkStyle} className="hover:text-[#EDEDEA] transition-colors"><TelegramIcon /> Telegram Announcements</a>
              <a href="https://bitcointalk.org/index.php?topic=5592733.msg67094943#msg67094943" target="_blank" rel="noopener noreferrer" style={socialLinkStyle} className="hover:text-[#EDEDEA] transition-colors"><ForumIcon /> Bitcointalk</a>
              <a href="https://www.altcoinstalks.com/index.php?topic=348789.msg2228131#msg2228131" target="_blank" rel="noopener noreferrer" style={socialLinkStyle} className="hover:text-[#EDEDEA] transition-colors"><ForumIcon /> Altcoinstalks</a>
              <span style={{ fontFamily: 'var(--font-inter), Inter, sans-serif', fontSize: '11px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#888888', marginTop: '12px', marginBottom: '4px' }}>Contact us</span>
              <a href="mailto:social@robincalls.com" style={socialLinkStyle} className="hover:text-[#EDEDEA] transition-colors"><MailIcon /> <span>social<span>@</span>robincalls.com</span></a>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <span style={{ fontFamily: 'var(--font-inter), Inter, sans-serif', fontSize: '11px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#888888', marginBottom: '4px' }}>Explore</span>
              <Link href="/story" style={{ fontFamily: 'var(--font-inter), Inter, sans-serif', fontSize: '14px', color: '#A3A3A3' }} className="hover:text-[#EDEDEA] transition-colors">Story</Link>
              <Link href="/#features" style={{ fontFamily: 'var(--font-inter), Inter, sans-serif', fontSize: '14px', color: '#A3A3A3' }} className="hover:text-[#EDEDEA] transition-colors">How It Works</Link>
              <Link href="/#record" style={{ fontFamily: 'var(--font-inter), Inter, sans-serif', fontSize: '14px', color: '#A3A3A3' }} className="hover:text-[#EDEDEA] transition-colors">The Record</Link>
              <Link href="/tokenomics" style={{ fontFamily: 'var(--font-inter), Inter, sans-serif', fontSize: '14px', color: '#A3A3A3' }} className="hover:text-[#EDEDEA] transition-colors">Tokenomics</Link>
              <Link href="/token-sale" style={{ fontFamily: 'var(--font-inter), Inter, sans-serif', fontSize: '14px', color: '#A3A3A3' }} className="hover:text-[#EDEDEA] transition-colors">Token Sale</Link>
            </div>
            {/* Tools Column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <span style={{ fontFamily: 'var(--font-inter), Inter, sans-serif', fontSize: '11px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#888888', marginBottom: '4px' }}>Tools</span>
              <Link href="/rwa" style={{ fontFamily: 'var(--font-inter), Inter, sans-serif', fontSize: '14px', color: '#A3A3A3' }} className="hover:text-[#EDEDEA] transition-colors">Trusted RWAs</Link>
              <Link href="/scan" style={{ fontFamily: 'var(--font-inter), Inter, sans-serif', fontSize: '14px', color: '#A3A3A3' }} className="hover:text-[#EDEDEA] transition-colors">Token Scanner</Link>
              <Link href="/night-market" style={{ fontFamily: 'var(--font-inter), Inter, sans-serif', fontSize: '14px', color: '#A3A3A3' }} className="hover:text-[#EDEDEA] transition-colors">Night Market</Link>
              <Link href="/swap" style={{ fontFamily: 'var(--font-inter), Inter, sans-serif', fontSize: '14px', color: '#A3A3A3' }} className="hover:text-[#EDEDEA] transition-colors">Swap</Link>
              <Link href="/ecosystem" style={{ fontFamily: 'var(--font-inter), Inter, sans-serif', fontSize: '14px', color: '#A3A3A3' }} className="hover:text-[#EDEDEA] transition-colors">Ecosystem</Link>
              <Link href="/robin-knight" style={{ fontFamily: 'var(--font-inter), Inter, sans-serif', fontSize: '14px', color: '#A3A3A3' }} className="hover:text-[#EDEDEA] transition-colors">Robin Knight</Link>
              <Link href="/ledger" style={{ fontFamily: 'var(--font-inter), Inter, sans-serif', fontSize: '14px', color: '#A3A3A3' }} className="hover:text-[#EDEDEA] transition-colors">The Ledger</Link>
              <Link href="/wanted" style={{ fontFamily: 'var(--font-inter), Inter, sans-serif', fontSize: '14px', color: '#A3A3A3' }} className="hover:text-[#EDEDEA] transition-colors">Wanted</Link>
              <Link href="/compare" style={{ fontFamily: 'var(--font-inter), Inter, sans-serif', fontSize: '14px', color: '#A3A3A3' }} className="hover:text-[#EDEDEA] transition-colors">Compare</Link>
              <Link href="/methodology" style={{ fontFamily: 'var(--font-inter), Inter, sans-serif', fontSize: '14px', color: '#A3A3A3' }} className="hover:text-[#EDEDEA] transition-colors">Methodology</Link>
            </div>
          </div>
        </div>
        <div style={{ marginTop: 'clamp(48px, 7vh, 72px)', paddingTop: '28px', borderTop: '1px solid #2A2A2A' }}>
          <p style={{ margin: 0, fontFamily: 'var(--font-inter), Inter, sans-serif', fontSize: '12px', lineHeight: 1.7, color: '#888888', maxWidth: '760px' }}>RobinCalls is an informational tool, not financial advice. Nothing here is a recommendation to buy or sell any asset. RobinCalls is unaffiliated with Robinhood Markets, Inc. and its subsidiaries. Do your own diligence. We simply hand you the receipts.</p>
        </div>
      </div>
    </footer>
  );
}
