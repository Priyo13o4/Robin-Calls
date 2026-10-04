'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useWallet } from '@/lib/wallet/useWallet';
import { flags } from '@/lib/config/flags';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
type Path = 'x' | 'telegram' | 'wallet';
type XTask = 'follow' | 'like' | 'post';

interface XTasks {
  follow: boolean;
  like: boolean;
  post: boolean;
}

interface XSessionState {
  configured: boolean;
  connected: boolean;
  username?: string;
  name?: string;
  tasks?: XTasks;
  likeAvailable?: boolean;
  intents?: { follow: string | null; like: string | null; post: string };
}

interface TgSessionState {
  configured: boolean;
  connected: boolean;
  username?: string | null;
  firstName?: string | null;
  isMember?: boolean;
  botUsername?: string | null;
  groupUrl?: string;
}

interface WhitelistModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** When the modal opens straight off a social redirect, this is the ?reason. */
  initialError?: string | null;
}

const SOCIAL_ERRORS: Record<string, string> = {
  denied: 'Sign-in was cancelled. Try again when ready.',
  state: 'Sign-in expired or was tampered with. Start again.',
  exchange: "Couldn't complete sign-in. Try again.",
  signature: "Telegram sign-in couldn't be verified. Try again.",
  payload: 'Telegram sign-in was incomplete. Try again.',
  unavailable: "That sign-in isn't available right now.",
};

const WALLET_MSG = (walletLower: string, issuedAt: string) =>
  `RobinCalls whitelist: ${walletLower}\nIssued: ${issuedAt}`;

/* ------------------------------------------------------------------ */
/*  Small shared bits                                                  */
/* ------------------------------------------------------------------ */
function TaskRow({
  label,
  hint,
  done,
  busy,
  onClick,
}: {
  label: string;
  hint: string;
  done: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={done || busy}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        width: '100%',
        textAlign: 'left',
        background: '#141414',
        border: `1px solid ${done ? '#CCFF00' : '#2A2A2A'}`,
        padding: '12px 16px',
        cursor: done ? 'default' : busy ? 'wait' : 'pointer',
        transition: 'border-color 0.15s',
      }}
    >
      <span
        style={{
          width: '18px',
          height: '18px',
          flexShrink: 0,
          border: `1px solid ${done ? '#CCFF00' : '#3D3D3D'}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#CCFF00',
          fontSize: '11px',
        }}
      >
        {done ? '✓' : ''}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '12px', fontWeight: 500, letterSpacing: '0.04em', color: '#EDEDEA' }}>
          {label}
        </span>
        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '10px', color: '#8a8a8a' }}>{hint}</span>
      </span>
      <span style={{ marginLeft: 'auto', fontFamily: 'Inter, sans-serif', fontSize: '10px', letterSpacing: '0.12em', color: done ? '#CCFF00' : '#3D3D3D' }}>
        {busy ? 'WORKING…' : done ? 'DONE ✓' : 'RUN ↗'}
      </span>
    </button>
  );
}

const primaryBtn: React.CSSProperties = {
  fontFamily: 'Inter, sans-serif',
  fontWeight: 700,
  fontSize: '12px',
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: '#0A0A0A',
  background: '#CCFF00',
  border: '2px solid #CCFF00',
  padding: '14px 24px',
  cursor: 'pointer',
  width: '100%',
  boxShadow: '6px 6px 0px 0px rgba(204, 255, 0, 0.3)',
};

const ghostBtn: React.CSSProperties = {
  fontFamily: 'Inter, sans-serif',
  fontWeight: 600,
  fontSize: '11px',
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: '#EDEDEA',
  background: '#0A0A0A',
  border: '2px solid #EDEDEA',
  padding: '12px 24px',
  cursor: 'pointer',
  width: '100%',
};

/* ------------------------------------------------------------------ */
/*  Main modal                                                         */
/* ------------------------------------------------------------------ */
export function WhitelistModal({ isOpen, onClose, initialError }: WhitelistModalProps) {
  const [path, setPath] = useState<Path | null>(null);
  const [xSession, setXSession] = useState<XSessionState | null>(null);
  const [tgSession, setTgSession] = useState<TgSessionState | null>(null);
  const [loading, setLoading] = useState(true);

  const [taskBusy, setTaskBusy] = useState<XTask | null>(null);
  const [tgRechecking, setTgRechecking] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(
    initialError ? SOCIAL_ERRORS[initialError] ?? 'Sign-in failed. Try again.' : null,
  );
  const [isApproved, setIsApproved] = useState(false);
  const [eligible, setEligible] = useState(false);
  const [walletDismissed, setWalletDismissed] = useState(false);
  // Telegram bound to the DB record (recovery only — never flips `eligible`).
  // Distinct from `tgSession`, which is the ephemeral onboarding-cookie state.
  const [boundTelegramUsername, setBoundTelegramUsername] = useState<string | null>(null);

  // change-wallet sub-flow
  const [changing, setChanging] = useState(false);
  const [changeBusy, setChangeBusy] = useState(false);
  const [oldProof, setOldProof] = useState<{ addr: string; sig: string; issuedAt: string } | null>(null);

  const wallet = useWallet();
  const modalRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const tgWidgetRef = useRef<HTMLDivElement>(null);

  // ── Derived ──
  const xConnected = Boolean(xSession?.connected);
  const tgConnected = Boolean(tgSession?.connected);
  const likeAvailable = xSession?.likeAvailable ?? false;
  const xTasks: XTasks = xSession?.tasks ?? { follow: false, like: false, post: false };
  const xTasksDone = xConnected && xTasks.follow && xTasks.post && (!likeAvailable || xTasks.like);
  const tgMember = Boolean(tgSession?.isMember);

  // A returning approved-but-ineligible member who is part-way through adding a
  // social account (e.g. just back from the X redirect). Don't slam them onto
  // the success screen — let them finish binding first. The last clause covers
  // the gap where the X tasks are done but the wallet re-sign that actually
  // BINDS X (→ eligible) hasn't happened yet: keep them in the flow so they land
  // straight on the wallet step instead of bouncing to the ineligible screen.
  const midAddLater =
    (xConnected && !xTasksDone) ||
    (tgConnected && !tgMember) ||
    (xConnected && xTasksDone && !eligible);
  const onboarding = !isApproved || midAddLater;

  // ── Load both social sessions when the modal opens; pick the active path. ──
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      const [xRes, tgRes] = await Promise.all([
        fetch('/api/whitelist/x/session').then((r) => r.json()).catch(() => null),
        fetch('/api/whitelist/telegram/session').then((r) => r.json()).catch(() => null),
      ]);
      if (cancelled) return;
      const xs = (xRes as XSessionState) ?? { configured: false, connected: false };
      const tgs = (tgRes as TgSessionState) ?? { configured: false, connected: false };
      setXSession(xs);
      setTgSession(tgs);
      // Returning from a redirect auto-selects the connected path.
      setPath((prev) => prev ?? (xs.connected ? 'x' : tgs.connected ? 'telegram' : null));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // Focus trap + scroll lock + escape
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.activeElement as HTMLElement | null;
    // The lock goes on the scrolling element, not on <body>. Body's overflow is
    // only propagated to the viewport while <html> is `overflow: visible`, and
    // this app's <html> declares its own — so the body version silently did
    // nothing and the page scrolled behind the modal. Same defect as SiteNav's
    // drawer; see the longer note there.
    const scroller = (document.scrollingElement ?? document.documentElement) as HTMLElement;
    const prevOverflow = scroller.style.overflow;
    const prevPadding = scroller.style.paddingRight;
    const gutter = window.innerWidth - scroller.clientWidth;
    scroller.style.overflow = 'hidden';
    if (gutter > 0) scroller.style.paddingRight = `${gutter}px`;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      scroller.style.overflow = prevOverflow;
      scroller.style.paddingRight = prevPadding;
      prev?.focus?.();
    };
  }, [isOpen, onClose]);

  // Surface an already-approved wallet on open.
  useEffect(() => {
    if (!isOpen) return;
    // Opening this modal is the intent that ends at the wallet step, so it is
    // the earliest point AppKit may legitimately be built — never on page
    // load. See lib/wallet/appkit-config.ts::hasPriorWalletSession.
    wallet.prepare();
    let cancelled = false;
    (async () => {
      const addr = await wallet.checkConnection();
      if (!addr || cancelled) return;
      try {
        const res = await fetch(`/api/whitelist?wallet=${addr}`);
        const data = await res.json();
        if (cancelled || !data || data.status === 'not_found') return;
        if (data.status === 'approved') {
          setIsApproved(true);
          setEligible(Boolean(data.eligible));
          setBoundTelegramUsername(data.telegram_username ?? null);
        }
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Mount the Telegram Login Widget when on the Telegram path and not connected.
  useEffect(() => {
    if (path !== 'telegram' || tgConnected) return;
    const container = tgWidgetRef.current;
    const botUsername = tgSession?.botUsername;
    if (!container || !botUsername) return;
    container.innerHTML = '';
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://telegram.org/js/telegram-widget.js?22';
    s.setAttribute('data-telegram-login', botUsername);
    s.setAttribute('data-size', 'large');
    s.setAttribute('data-radius', '4');
    s.setAttribute('data-auth-url', `${window.location.origin}/api/whitelist/telegram/verify`);
    s.setAttribute('data-request-access', 'write');
    container.appendChild(s);
    return () => {
      container.innerHTML = '';
    };
  }, [path, tgConnected, tgSession?.botUsername]);

  // Closed-popup watchdog for the wallet step. Focus regaining after a wallet
  // popup closes is NORMAL mid-flow: the user approves connect, the modal
  // returns, and sign() fires — with the wallet's own prompt still pending.
  // Cancelling the flow there (old behavior) aborted the first connect+sign
  // every time; the user had to retry to get through. Only a STABLE idle
  // period while still loading means the popup truly died unread.
  useEffect(() => {
    if (!wallet.isLoading) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onFocus = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (wallet.isLoading && !wallet.isConnected) {
          wallet.reset();
          setWalletDismissed(true);
          setFeedbackMsg('Wallet window closed before finishing. Try again when ready.');
        }
      }, 4000);
    };
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      clearTimeout(timer);
    };
  }, [wallet.isLoading, wallet.isConnected, wallet]);

  /* ---------------------------------------------------------------- */
  /*  Actions                                                         */
  /* ---------------------------------------------------------------- */
  const handleConnectX = () => {
    if (xSession && xSession.configured === false) {
      setFeedbackMsg("X sign-in isn't configured yet. Check back soon.");
      return;
    }
    window.location.href = '/api/whitelist/x/start';
  };

  // X social task: open the intent, then record the attestation (zero API).
  const runTask = (task: XTask) => {
    if (taskBusy) return;
    const url = xSession?.intents?.[task];
    if (!url) {
      setFeedbackMsg("That step isn't configured yet. Check back soon.");
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
    setTaskBusy(task);
    setFeedbackMsg(null);
    void (async () => {
      try {
        const res = await fetch('/api/whitelist/x/task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task }),
        });
        const data = await res.json();
        if (!res.ok) {
          setFeedbackMsg(data.error || 'That action failed. Try again.');
          if (data.reconnect) setXSession((p) => (p ? { ...p, connected: false } : p));
          return;
        }
        setXSession((p) => (p ? { ...p, tasks: data.tasks as XTasks } : p));
      } catch {
        setFeedbackMsg('Network error. Try again.');
      } finally {
        setTaskBusy(null);
      }
    })();
  };

  const recheckTelegram = async () => {
    if (tgRechecking) return;
    setTgRechecking(true);
    setFeedbackMsg(null);
    try {
      const res = await fetch('/api/whitelist/telegram/recheck', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setFeedbackMsg(data.error || "Couldn't verify membership. Try again.");
        if (data.reconnect) setTgSession((p) => (p ? { ...p, connected: false } : p));
        return;
      }
      setTgSession((p) => (p ? { ...p, isMember: Boolean(data.isMember) } : p));
      if (!data.isMember) setFeedbackMsg("We don't see you in the group yet. Join, then verify again.");
    } catch {
      setFeedbackMsg('Network error. Try again.');
    } finally {
      setTgRechecking(false);
    }
  };

  const disconnectSocial = async () => {
    if (taskBusy || isSubmitting) return;
    const route = path === 'telegram' ? '/api/whitelist/telegram/disconnect' : '/api/whitelist/x/disconnect';
    try {
      await fetch(route, { method: 'POST' });
    } catch {
      /* session-scoped anyway */
    }
    if (path === 'telegram') setTgSession((p) => (p ? { ...p, connected: false, isMember: false } : p));
    else setXSession((p) => (p ? { ...p, connected: false } : p));
    setTaskBusy(null);
    setFeedbackMsg(null);
    setPath(null);
  };

  // Wallet step: connect + sign + finalize. Binds whatever social cookie is
  // present (X or Telegram) on the server; wallet-only is allowed (ineligible).
  const handleConnectWallet = async () => {
    setFeedbackMsg(null);
    setWalletDismissed(false);

    let addr = wallet.address;
    if (!addr) {
      addr = await wallet.connect();
      if (!addr) {
        setWalletDismissed(true);
        return;
      }
    }
    const walletLower = addr.toLowerCase();
    const issuedAt = new Date().toISOString();
    const signature = await wallet.sign(WALLET_MSG(walletLower, issuedAt));
    if (!signature) {
      setWalletDismissed(true);
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch('/api/whitelist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet_address: addr,
          action: 'connect_wallet',
          payload: { signature, issuedAt },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedbackMsg(data.error || 'Something went wrong.');
        return;
      }
      if (data.status === 'approved') {
        setIsApproved(true);
        setEligible(Boolean(data.eligible));
        setBoundTelegramUsername(data.telegram_username ?? null);
      }
    } catch {
      setFeedbackMsg('Network error. Try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Change wallet — two-step: sign with the CURRENT wallet, then switch to the
  // new wallet in the extension and sign with it. Server re-keys the record.
  const signOldWallet = async () => {
    setChangeBusy(true);
    setFeedbackMsg(null);
    try {
      const addr = wallet.address ?? (await wallet.connect());
      if (!addr) return;
      const lower = addr.toLowerCase();
      const issuedAt = new Date().toISOString();
      const sig = await wallet.sign(WALLET_MSG(lower, issuedAt));
      if (!sig) return;
      setOldProof({ addr, sig, issuedAt });
      setFeedbackMsg('Now switch to your NEW wallet in your extension, then continue.');
    } catch {
      setFeedbackMsg('Could not sign with the current wallet.');
    } finally {
      setChangeBusy(false);
    }
  };

  const finishChangeWallet = async () => {
    if (!oldProof) return;
    setChangeBusy(true);
    setFeedbackMsg(null);
    try {
      const newAddr = await wallet.connect();
      if (!newAddr) return;
      const newLower = newAddr.toLowerCase();
      if (newLower === oldProof.addr.toLowerCase()) {
        setFeedbackMsg('That is the same wallet — switch to a different account in your extension first.');
        return;
      }
      const newIssuedAt = new Date().toISOString();
      const newSig = await wallet.sign(WALLET_MSG(newLower, newIssuedAt));
      if (!newSig) return;

      const res = await fetch('/api/whitelist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet_address: newAddr,
          action: 'change_wallet',
          payload: {
            signature: newSig,
            issuedAt: newIssuedAt,
            old_wallet_address: oldProof.addr,
            old_signature: oldProof.sig,
            old_issuedAt: oldProof.issuedAt,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedbackMsg(data.error || 'Could not change wallet.');
        return;
      }
      setEligible(Boolean(data.eligible));
      setBoundTelegramUsername(data.telegram_username ?? null);
      setChanging(false);
      setOldProof(null);
      setFeedbackMsg(null);
    } catch {
      setFeedbackMsg('Something went wrong changing the wallet.');
    } finally {
      setChangeBusy(false);
    }
  };

  if (!isOpen || !flags.whitelist) return null;

  /* ---------------------------------------------------------------- */
  /*  Render helpers                                                  */
  /* ---------------------------------------------------------------- */
  const walletButtonLabel = () => {
    if (wallet.isLoading) return 'Waiting for wallet…';
    if (isSubmitting) return 'Verifying…';
    if (walletDismissed) return wallet.isConnected ? 'Retry — sign message' : 'Retry — connect wallet';
    if (wallet.isConnected) return path === 'wallet' ? 'Sign & Join' : 'Sign & Complete';
    return 'Connect Wallet & Sign';
  };

  const renderWalletStep = (walletOnly: boolean) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {walletOnly && (
        <p style={{ margin: 0, fontFamily: 'Inter, sans-serif', fontSize: '12px', color: '#8a8a8a', lineHeight: 1.6 }}>
          Wallet-only: you&apos;ll be on the list but{' '}
          <span style={{ color: '#EDEDEA' }}>not eligible for allocation</span>. You can connect X
          anytime later to qualify.
        </p>
      )}
      {wallet.isConnected && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#141414', border: '1px solid #2A2A2A', padding: '10px 14px' }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#CCFF00', flexShrink: 0 }} />
          <span style={{ fontFamily: "'SF Mono', ui-monospace, Menlo, monospace", fontSize: '12px', color: '#EDEDEA' }}>
            {wallet.address?.slice(0, 6)}…{wallet.address?.slice(-4)}
          </span>
        </div>
      )}
      {!wallet.isMetaMaskInstalled ? (
        <>
          <a href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer" style={{ ...ghostBtn, display: 'block', textAlign: 'center', textDecoration: 'none' }}>
            Install a Wallet
          </a>
          <p style={{ margin: 0, fontFamily: 'Inter, sans-serif', fontSize: '11px', color: '#8a8a8a', lineHeight: 1.5 }}>
            No wallet detected. MetaMask, Phantom, Coinbase, Rabby and other EVM wallets all work.
          </p>
        </>
      ) : (
        <button onClick={handleConnectWallet} onPointerEnter={wallet.prepare} onFocus={wallet.prepare} disabled={isSubmitting || wallet.isLoading} style={{ ...primaryBtn, opacity: isSubmitting || wallet.isLoading ? 0.6 : 1, cursor: isSubmitting || wallet.isLoading ? 'wait' : 'pointer' }}>
          {walletButtonLabel()}
        </button>
      )}
      <p style={{ margin: 0, fontFamily: 'Inter, sans-serif', fontSize: '11px', color: '#3D3D3D', lineHeight: 1.5 }}>
        Signs a message to prove wallet control. No gas fee. No transaction.
      </p>
    </div>
  );

  // Optional community nudge — a PLAIN link (no OAuth, no membership check, no
  // eligibility effect). Just gets people into the group for launch updates.
  const tgCommunityLink = (
    <a
      href={tgSession?.groupUrl ?? 'https://t.me/RobinCallsChat'}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        padding: '11px 16px',
        background: '#141414',
        border: '1px solid #2A2A2A',
        textDecoration: 'none',
        fontFamily: 'Inter, sans-serif',
        fontSize: '12px',
        fontWeight: 500,
        letterSpacing: '0.04em',
        color: '#8a8a8a',
      }}
    >
      Join our Telegram for launch updates{' '}
      <span style={{ color: '#3D3D3D', fontSize: '10px', letterSpacing: '0.1em' }}>OPTIONAL ↗</span>
    </a>
  );

  const renderActivePath = () => {
    // ── Wallet-only ──
    if (path === 'wallet') {
      return (
        <StepCard title="Connect Wallet" subtitle="Prove you control a wallet — this is your whitelist key.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {renderWalletStep(true)}
            {tgCommunityLink}
          </div>
        </StepCard>
      );
    }

    // ── X path ──
    if (path === 'x') {
      if (!xConnected) {
        return (
          <StepCard title="Connect X" subtitle="Sign in with X so we can verify you — no password, just OAuth.">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button onClick={handleConnectX} disabled={loading} style={{ ...ghostBtn, opacity: loading ? 0.5 : 1 }}>
                {loading ? 'Checking…' : 'Sign in with X'}
              </button>
              <p style={{ margin: 0, fontFamily: 'Inter, sans-serif', fontSize: '11px', color: '#3D3D3D', lineHeight: 1.5 }}>
                Opens X to authorise RobinCalls. We never see your password.
              </p>
            </div>
          </StepCard>
        );
      }
      if (!xTasksDone) {
        return (
          <StepCard title="Social Tasks" subtitle="Follow, like, and share — each opens on X.">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {xSession?.username && (
                <p style={{ margin: '0 0 2px', fontFamily: "'SF Mono', ui-monospace, Menlo, monospace", fontSize: '11px', color: '#8a8a8a' }}>
                  Connected as <span style={{ color: '#CCFF00' }}>@{xSession.username}</span>
                </p>
              )}
              <TaskRow label="Follow @RobinCalls" hint="Opens X in a new tab — hit Follow there." done={xTasks.follow} busy={taskBusy === 'follow'} onClick={() => runTask('follow')} />
              {likeAvailable && (
                <TaskRow label="Like the pinned post" hint="Opens the post on X — tap the heart." done={xTasks.like} busy={taskBusy === 'like'} onClick={() => runTask('like')} />
              )}
              <TaskRow label="Post the onboarding tweet" hint="Opens X with the post pre-filled — hit Post." done={xTasks.post} busy={taskBusy === 'post'} onClick={() => runTask('post')} />
            </div>
          </StepCard>
        );
      }
      return (
        <StepCard title="Connect Wallet" subtitle="Last step — prove you control a wallet.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {renderWalletStep(false)}
            {tgCommunityLink}
          </div>
        </StepCard>
      );
    }

    // ── Telegram path ──
    if (path === 'telegram') {
      if (tgSession?.configured === false) {
        return (
          <StepCard title="Connect Telegram" subtitle="Telegram sign-in isn't set up yet.">
            <p style={{ margin: 0, fontFamily: 'Inter, sans-serif', fontSize: '12px', color: '#8a8a8a' }}>Check back soon.</p>
          </StepCard>
        );
      }
      if (!tgConnected) {
        return (
          <StepCard title="Connect Telegram" subtitle="Sign in with Telegram so we can verify you.">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div ref={tgWidgetRef} style={{ minHeight: '44px' }} />
              {!tgSession?.botUsername && (
                <p style={{ margin: 0, fontFamily: 'Inter, sans-serif', fontSize: '11px', color: '#3D3D3D' }}>
                  Loading the Telegram button…
                </p>
              )}
            </div>
          </StepCard>
        );
      }
      if (!tgMember) {
        return (
          <StepCard title="Join the Group" subtitle="Join our Telegram community for launch updates. (Allocation eligibility still needs X.)">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {tgSession?.username && (
                <p style={{ margin: '0 0 2px', fontFamily: "'SF Mono', ui-monospace, Menlo, monospace", fontSize: '11px', color: '#8a8a8a' }}>
                  Connected as <span style={{ color: '#CCFF00' }}>@{tgSession.username}</span>
                </p>
              )}
              <a href={tgSession?.groupUrl ?? 'https://t.me/RobinCallsChat'} target="_blank" rel="noopener noreferrer" style={{ ...ghostBtn, display: 'block', textAlign: 'center', textDecoration: 'none' }}>
                Open Telegram & Join ↗
              </a>
              <button onClick={recheckTelegram} disabled={tgRechecking} style={{ ...primaryBtn, opacity: tgRechecking ? 0.6 : 1, cursor: tgRechecking ? 'wait' : 'pointer' }}>
                {tgRechecking ? 'Checking…' : "I've joined — verify"}
              </button>
            </div>
          </StepCard>
        );
      }
      return (
        <StepCard title="Connect Wallet" subtitle="Last step — prove you control a wallet.">
          {renderWalletStep(false)}
        </StepCard>
      );
    }

    return null;
  };

  /* ---------------------------------------------------------------- */
  /*  Screens                                                         */
  /* ---------------------------------------------------------------- */
  const pathSelector = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <p style={{ margin: '0 0 4px', fontFamily: 'Inter, sans-serif', fontSize: '13px', color: '#8a8a8a', lineHeight: 1.6 }}>
        Connect <span style={{ color: '#EDEDEA' }}>X</span> to be eligible for allocation. Telegram and
        wallet-only join the list too — you can add X anytime to qualify.
      </p>
      <MethodCard title="Continue with X" tag="Eligible" onClick={() => setPath('x')}
        desc="Verify with X, then follow / like / share. The path to allocation." />
      <MethodCard title="Continue with Telegram" tag="Community" muted onClick={() => setPath('telegram')}
        desc="Join our group for launch updates + wallet recovery. Doesn't affect allocation." />
      <MethodCard title="Just my wallet" tag="Not eligible" muted onClick={() => setPath('wallet')}
        desc="Join the list now, add X later to qualify for allocation." />
    </div>
  );

  const changeWalletPanel = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <p style={{ margin: 0, fontFamily: 'Inter, sans-serif', fontSize: '13px', color: '#8a8a8a', lineHeight: 1.6 }}>
        Move your whitelist record to a new wallet. Sign with your current wallet to authorise, then
        switch to the new wallet and sign with it.
      </p>
      {!oldProof ? (
        <button onClick={signOldWallet} disabled={changeBusy} style={{ ...ghostBtn, opacity: changeBusy ? 0.6 : 1 }}>
          {changeBusy ? 'Waiting…' : '1 · Sign with current wallet'}
        </button>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', background: '#141414', border: '1px solid #CCFF00', padding: '10px 14px' }}>
            <span style={{ color: '#CCFF00', fontSize: '11px' }}>✓</span>
            <span style={{ fontFamily: "'SF Mono', ui-monospace, Menlo, monospace", fontSize: '11px', color: '#8a8a8a' }}>
              current wallet authorised
            </span>
          </div>
          <button onClick={finishChangeWallet} disabled={changeBusy} style={{ ...primaryBtn, opacity: changeBusy ? 0.6 : 1 }}>
            {changeBusy ? 'Waiting…' : '2 · Connect new wallet & sign'}
          </button>
        </>
      )}
      <button onClick={() => { setChanging(false); setOldProof(null); setFeedbackMsg(null); }} style={{ background: 'transparent', border: 'none', padding: '4px 0', fontFamily: 'Inter, sans-serif', fontSize: '11px', color: '#8a8a8a', textDecoration: 'underline', textUnderlineOffset: '3px', cursor: 'pointer', alignSelf: 'flex-start' }}>
        Cancel
      </button>
    </div>
  );

  const successScreen = (
    <div style={{ textAlign: 'center', padding: '20px 0' }}>
      <div style={{ fontFamily: 'Cinzel, Georgia, serif', fontWeight: 900, fontSize: '4rem', lineHeight: 0.85, color: eligible ? '#CCFF00' : '#EDEDEA', marginBottom: '18px' }}>
        {eligible ? '✓' : '◐'}
      </div>
      <h3 style={{ margin: '0 0 12px', fontFamily: 'Cinzel, Georgia, serif', fontWeight: 700, fontSize: '1.5rem', color: '#EDEDEA' }}>
        {eligible ? "You're in." : "You're on the list."}
      </h3>
      <p style={{ margin: '0 auto 28px', maxWidth: '400px', fontFamily: 'Inter, sans-serif', fontSize: '14px', lineHeight: 1.6, color: '#8a8a8a' }}>
        {eligible ? (
          <>Your wallet is whitelisted and <span style={{ color: '#CCFF00' }}>eligible for allocation</span>.</>
        ) : (
          <>Your wallet is whitelisted, but <span style={{ color: '#EDEDEA' }}>not eligible for allocation</span> yet.
            Connect X to qualify.</>
        )}
      </p>

      {changing ? (
        changeWalletPanel
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '340px', margin: '0 auto' }}>
          {!eligible && (
            <button onClick={() => { setIsApproved(false); setPath('x'); }} style={primaryBtn}>
              Add X to qualify
            </button>
          )}
          {!eligible && (
            boundTelegramUsername ? (
              <p style={{ margin: 0, fontFamily: "'SF Mono', ui-monospace, Menlo, monospace", fontSize: '11px', color: '#8a8a8a' }}>
                Telegram connected as <span style={{ color: '#CCFF00' }}>@{boundTelegramUsername}</span> — recovery only, doesn&apos;t affect allocation.
              </p>
            ) : (
              <button onClick={() => { setIsApproved(false); setPath('telegram'); }} style={ghostBtn}>
                Add Telegram for recovery
              </button>
            )
          )}
          {eligible && tgCommunityLink}
          <button onClick={() => setChanging(true)} style={ghostBtn}>Change wallet</button>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', padding: '8px', fontFamily: 'Inter, sans-serif', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8a8a8a', cursor: 'pointer' }}>
            Done
          </button>
        </div>
      )}
    </div>
  );

  const showStartOver = (xConnected || tgConnected) && onboarding && path !== null && !changing;

  /* ---------------------------------------------------------------- */
  return (
    <div role="dialog" aria-modal="true" aria-label="Whitelist onboarding" style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(10, 10, 10, 0.92)', backdropFilter: 'blur(8px)' }} />

      {/* `data-lenis-prevent`: this body scrolls (maxHeight 90vh) and the modal
          opens over the landing page, which runs Lenis. Lenis captures the wheel
          document-wide, so without the opt-out the wheel here scrolls the page
          behind the modal and the form's lower fields cannot be reached. */}
      <div ref={modalRef} data-lenis-prevent style={{ position: 'relative', width: '100%', maxWidth: '580px', maxHeight: '90vh', overflowY: 'auto', background: '#0A0A0A', border: '2px solid #2A2A2A', boxShadow: '8px 8px 0px 0px #1C1C1C' }}>
        <div style={{ position: 'relative', zIndex: 1, padding: 'clamp(28px, 5vw, 48px)' }}>
          {/* header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '28px' }}>
            <div>
              <p style={{ margin: '0 0 8px', fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: '10px', letterSpacing: '0.28em', textTransform: 'uppercase', color: '#8a8a8a' }}>
                Early access
              </p>
              <h2 style={{ margin: 0, fontFamily: "Cinzel, Georgia, 'Times New Roman', serif", fontWeight: 700, fontSize: 'clamp(1.5rem, 4vw, 2rem)', lineHeight: 1.08, color: '#EDEDEA' }}>
                Join the <span style={{ color: '#CCFF00' }}>Whitelist.</span>
              </h2>
            </div>
            <button ref={closeRef} onClick={onClose} aria-label="Close whitelist modal" style={{ background: 'transparent', border: '1px solid #2A2A2A', color: '#8a8a8a', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '18px', fontFamily: 'Inter, sans-serif', flexShrink: 0 }}>
              ✕
            </button>
          </div>

          {/* method bar */}
          {path !== null && onboarding && !changing && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '20px', paddingBottom: '14px', borderBottom: '1px solid #1C1C1C' }}>
              <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8a8a8a' }}>
                Method: <span style={{ color: '#EDEDEA' }}>{path === 'x' ? 'X' : path === 'telegram' ? 'Telegram' : 'Wallet only'}</span>
              </span>
              <button onClick={() => { setPath(null); setFeedbackMsg(null); }} style={{ background: 'transparent', border: 'none', padding: 0, fontFamily: 'Inter, sans-serif', fontSize: '11px', color: '#8a8a8a', textDecoration: 'underline', textUnderlineOffset: '3px', cursor: 'pointer' }}>
                Change method
              </button>
            </div>
          )}

          {/* body */}
          {isApproved && !midAddLater ? successScreen : loading ? (
            <p style={{ fontFamily: 'Inter, sans-serif', fontSize: '13px', color: '#8a8a8a', padding: '20px 0' }}>Loading…</p>
          ) : path === null ? (
            pathSelector
          ) : (
            renderActivePath()
          )}

          {(feedbackMsg || wallet.error) && (
            <div style={{ marginTop: '20px', padding: '12px 16px', background: 'rgba(255, 80, 80, 0.06)', border: '1px solid rgba(255, 80, 80, 0.2)', fontFamily: 'Inter, sans-serif', fontSize: '12px', color: '#FF5050', lineHeight: 1.5 }}>
              {feedbackMsg || wallet.error}
            </div>
          )}

          {/* footer */}
          <div style={{ marginTop: '28px', paddingTop: '18px', borderTop: '1px solid #1C1C1C', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
            <p style={{ margin: 0, fontFamily: 'Inter, sans-serif', fontSize: '11px', color: '#3D3D3D', lineHeight: 1.6 }}>
              Your identity is your wallet, plus X or Telegram. No RobinCalls password, ever.
            </p>
            {showStartOver && (
              <button onClick={disconnectSocial} disabled={taskBusy !== null || isSubmitting} style={{ flexShrink: 0, background: 'transparent', border: 'none', padding: 0, fontFamily: 'Inter, sans-serif', fontSize: '11px', color: '#8a8a8a', textDecoration: 'underline', textUnderlineOffset: '3px', cursor: 'pointer', opacity: taskBusy !== null || isSubmitting ? 0.5 : 1 }}>
                Start over
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Presentational sub-components                                      */
/* ------------------------------------------------------------------ */
function StepCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 style={{ margin: '0 0 6px', fontFamily: 'Cinzel, Georgia, serif', fontWeight: 600, fontSize: '1.15rem', letterSpacing: '0.02em', color: '#EDEDEA' }}>
        {title}
      </h3>
      <p style={{ margin: '0 0 18px', fontFamily: 'Inter, sans-serif', fontSize: '13px', lineHeight: 1.55, color: '#8a8a8a' }}>
        {subtitle}
      </p>
      {children}
    </div>
  );
}

function MethodCard({ title, desc, tag, muted, onClick }: { title: string; desc: string; tag: string; muted?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ display: 'block', width: '100%', textAlign: 'left', background: '#141414', border: '1px solid #2A2A2A', padding: '16px 18px', cursor: 'pointer', transition: 'border-color 0.15s' }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = muted ? '#3D3D3D' : '#CCFF00'; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#2A2A2A'; }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: '6px' }}>
        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '14px', fontWeight: 600, color: '#EDEDEA' }}>{title}</span>
        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '9px', fontWeight: 500, letterSpacing: '0.14em', textTransform: 'uppercase', color: muted ? '#8a8a8a' : '#CCFF00', border: `1px solid ${muted ? '#2A2A2A' : 'rgba(204,255,0,0.35)'}`, padding: '3px 8px', flexShrink: 0 }}>
          {tag}
        </span>
      </div>
      <span style={{ fontFamily: 'Inter, sans-serif', fontSize: '12px', color: '#8a8a8a', lineHeight: 1.5 }}>{desc}</span>
    </button>
  );
}
