import { NextRequest, NextResponse } from 'next/server';
import { database } from '@/lib/db/client';
import {
  addWhitelistEvent,
  ensureWhitelistMember,
  moveWhitelistMember,
  updateWhitelistMember,
  whitelistMemberByWallet,
  whitelistWalletBySocialIdentity,
} from '@/lib/data/whitelist';
import { flags } from '@/lib/config/flags';
import { isXConfigured } from '@/lib/x/config';
import { X_SESSION_COOKIE, readSession } from '@/lib/x/session';
import { resolveTargets } from '@/lib/x/targets';
import { groupChatId, isTgConfigured } from '@/lib/telegram/config';
import { isChatMember } from '@/lib/telegram/client';
import { TG_SESSION_COOKIE, readTgSession } from '@/lib/telegram/session';
import { UNAVAILABLE_SENTENCE, verifyWalletSignature } from '@/lib/referrals/verify';

/**
 * Every mutating action requires a signature over the SAME message the
 * client already signs once in the "Connect Wallet & Sign" step — a proof
 * of control on connect_x/social_tasks too, not just connect_wallet.
 * Without this, anyone who knows a wallet address (public by definition)
 * could overwrite that wallet's linked X handle with no proof at all.
 *
 * The message embeds an issued-at timestamp so a captured signature can't
 * be replayed indefinitely; ±10 minutes covers clock skew and the couple of
 * seconds between the three batched calls the client fires after signing.
 *
 * Verification goes through `verifyWalletSignature` (lib/referrals/verify.ts)
 * so ERC-1271 contract wallets can sign. A whitelist retry is possible, so the
 * stakes are lower than the referral surface's, but the answer is the same
 * helper because the alternative is two verifiers that drift.
 */
const SIGNATURE_FRESHNESS_MS = 10 * 60 * 1000;

function whitelistMessage(walletLower: string, issuedAt: string): string {
  return `RobinCalls whitelist: ${walletLower}\nIssued: ${issuedAt}`;
}

async function verifyWalletProof(
  walletLower: string,
  issuedAt: unknown,
  signature: unknown
): Promise<string | null> {
  if (typeof issuedAt !== 'string' || typeof signature !== 'string') {
    return 'Missing signature or issuedAt.';
  }
  const issuedMs = Date.parse(issuedAt);
  if (!Number.isFinite(issuedMs)) return 'Invalid issuedAt.';
  if (Math.abs(Date.now() - issuedMs) > SIGNATURE_FRESHNESS_MS) {
    return 'Signature expired. Please try again.';
  }
  const verdict = await verifyWalletSignature(walletLower, whitelistMessage(walletLower, issuedAt), signature);
  if (verdict === 'verified') return null;
  // An RPC blip must not read as "your signature is wrong". The message is the
  // same one the referral routes send, and their callers map it to 503; here the
  // status stays 401 with the retry sentence, because every whitelist action can
  // simply be resubmitted after the blip passes.
  if (verdict === 'unavailable') {
    return UNAVAILABLE_SENTENCE;
  }
  return 'Invalid signature — wallet control not proven.';}

/* ------------------------------------------------------------------ */
/*  GET /api/whitelist?wallet=0x...                                    */
/*  Returns whitelist status for a wallet address.                     */
/* ------------------------------------------------------------------ */
export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get('wallet');
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    return NextResponse.json(
      { error: 'Missing or invalid wallet address' },
      { status: 400 },
    );
  }

  if (!database()) {
    return NextResponse.json(
      { error: 'Database not configured' },
      { status: 503 },
    );
  }

  let data;
  try {
    data = await whitelistMemberByWallet(wallet);
  } catch (error) {
    console.error('[whitelist] GET error:', error);
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ status: 'not_found' });
  }

  return NextResponse.json({
    status: data.whitelist_status,
    eligible: data.eligible,
    steps: {
      step_1: data.step_1_status,
      step_2: data.step_2_status,
      step_3: data.step_3_status,
    },
    twitter_username: data.twitter_username,
    telegram_username: data.telegram_username,
    telegram_chat_member: data.telegram_chat_member,
    approved_at: data.approved_at,
  });
}

/* ------------------------------------------------------------------ */
/*  POST /api/whitelist                                                */
/*  Upserts whitelist progress. Body:                                  */
/*  { wallet_address, action, payload }                                */
/*  Actions: connect_x, social_tasks, connect_wallet                   */
/* ------------------------------------------------------------------ */

interface WhitelistBody {
  wallet_address: string;
  action: 'connect_x' | 'social_tasks' | 'connect_wallet' | 'change_wallet';
  payload?: {
    twitter_username?: string;
    signature?: string;
    issuedAt?: string;
    // change_wallet only: proof of the OLD wallet (recovery path A). The
    // top-level signature always proves the NEW wallet (= wallet_address).
    old_wallet_address?: string;
    old_signature?: string;
    old_issuedAt?: string;
  };
}

/**
 * change_wallet recovery path B: find the member to re-key by a connected
 * social session (X or Telegram) instead of an old-wallet signature — for users
 * who've lost access to their old wallet. The session cookie is minted only by
 * a real OAuth/Login round-trip, so it proves control of that identity; we then
 * locate the member row bound to it. Returns the old wallet_address or null.
 */
async function findMemberBySocialSession(
  req: NextRequest,
): Promise<string | null> {
  if (isXConfigured()) {
    const xs = readSession(req.cookies.get(X_SESSION_COOKIE)?.value);
    if (xs) {
      const data = await whitelistWalletBySocialIdentity('twitterUserId', xs.userId);
      if (data) return data.wallet_address;
    }
  }
  if (isTgConfigured()) {
    const tg = readTgSession(req.cookies.get(TG_SESSION_COOKIE)?.value);
    if (tg) {
      const data = await whitelistWalletBySocialIdentity('telegramUserId', tg.userId);
      if (data) return data.wallet_address;
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  if (!flags.whitelist) {
    return NextResponse.json(
      { error: "Whitelist onboarding isn't open yet." },
      { status: 503 },
    );
  }

  if (!database()) {
    return NextResponse.json(
      { error: 'Database not configured' },
      { status: 503 },
    );
  }

  let body: WhitelistBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { wallet_address, action, payload } = body;

  if (!wallet_address || !/^0x[a-fA-F0-9]{40}$/.test(wallet_address)) {
    return NextResponse.json(
      { error: 'Missing or invalid wallet_address' },
      { status: 400 },
    );
  }

  const walletLower = wallet_address.toLowerCase();

  // ── Every mutation requires proof of wallet control, not just connect_wallet.
  // Otherwise anyone who knows a (public) wallet address could overwrite that
  // wallet's linked X handle with zero verification. The client already signs
  // once and reuses the same signature+issuedAt across all three batched calls. ──
  const proofError = await verifyWalletProof(
    walletLower,
    payload?.issuedAt,
    payload?.signature,
  );
  if (proofError) {
    return NextResponse.json({ error: proofError }, { status: 401 });
  }

  // ── change_wallet: re-key an existing record to a NEW wallet. Handled BEFORE
  // the ensure-member upsert below, so we don't create a phantom row for the
  // new address that would then collide with the re-key. The new wallet is
  // already proven (proofError check above); we still need authorisation to
  // move the OLD record — either an old-wallet signature or a social session. ──
  if (action === 'change_wallet') {
    // Resolve + authorise the OLD record.
    let oldWallet: string | null = null;
    const oldAddrRaw = payload?.old_wallet_address;
    if (typeof oldAddrRaw === 'string' && /^0x[a-fA-F0-9]{40}$/.test(oldAddrRaw)) {
      const oldLower = oldAddrRaw.toLowerCase();
      const oldProofError = await verifyWalletProof(
        oldLower,
        payload?.old_issuedAt,
        payload?.old_signature,
      );
      if (oldProofError) {
        return NextResponse.json(
          { error: `Old wallet proof failed: ${oldProofError}` },
          { status: 401 },
        );
      }
      oldWallet = oldLower;
    } else {
      // Recovery path B — authenticate via a connected social session.
      oldWallet = await findMemberBySocialSession(req);
      if (!oldWallet) {
        return NextResponse.json(
          {
            error:
              'Prove the old wallet (sign with it) or connect the X/Telegram account linked to your record.',
          },
          { status: 401 },
        );
      }
    }

    if (oldWallet === walletLower) {
      return NextResponse.json(
        { error: 'The new wallet is the same as the current one.' },
        { status: 400 },
      );
    }

    // The record to move must exist.
    const oldMember = await whitelistMemberByWallet(oldWallet);
    if (!oldMember) {
      return NextResponse.json(
        { error: 'No whitelist record found for the old wallet.' },
        { status: 404 },
      );
    }

    // The new wallet must not already be a member (no merging two records).
    const clash = await whitelistMemberByWallet(walletLower);
    if (clash) {
      return NextResponse.json(
        { error: 'That wallet is already registered on the whitelist.' },
        { status: 409 },
      );
    }

    await moveWhitelistMember(oldWallet, walletLower);
    await addWhitelistEvent(walletLower, 'wallet_changed', {
        from: oldWallet,
        to: walletLower,
        method: payload?.old_signature ? 'old_signature' : 'social_recovery',
    });
    const moved = await whitelistMemberByWallet(walletLower);

    return NextResponse.json({
      status: moved?.whitelist_status ?? 'approved',
      eligible: moved?.eligible ?? false,
      wallet_address: walletLower,
      changed: true,
      twitter_username: moved?.twitter_username,
      telegram_username: moved?.telegram_username,
      approved_at: moved?.approved_at,
    });
  }

  // ── Ensure member row exists ──
  try {
    await ensureWhitelistMember(walletLower);
  } catch (error) {
    console.error('[whitelist] upsert error:', error);
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }

  // ── Process action ──
  const validActions = ['connect_x', 'social_tasks', 'connect_wallet'] as const;
  if (!validActions.includes(action)) {
    return NextResponse.json(
      { error: `Invalid action. Must be one of: ${validActions.join(', ')}` },
      { status: 400 },
    );
  }

  // When a social connection is finalized at wallet-signing time, its onboarding
  // session cookie is consumed — flag it so we clear it on the response.
  let clearXSession = false;
  let clearTgSession = false;

  try {
    switch (action) {
      case 'connect_x': {
        const username = payload?.twitter_username?.replace(/^@/, '').trim();
        if (!username || !/^[A-Za-z0-9_]{1,15}$/.test(username)) {
          return NextResponse.json(
            {
              error:
                'Invalid X handle. 1-15 characters, letters/numbers/underscore only.',
            },
            { status: 400 },
          );
        }

        await updateWhitelistMember(walletLower, {
          twitterUsername: username,
          twitterConnectedAt: new Date().toISOString(),
          step1Status: 'completed',
          updatedAt: new Date().toISOString(),
        });

        // audit event
        await addWhitelistEvent(walletLower, 'x_connected', { twitter_username: username });

        break;
      }

      case 'social_tasks': {
        await updateWhitelistMember(walletLower, {
          step2Status: 'completed', updatedAt: new Date().toISOString(),
        });

        await addWhitelistEvent(walletLower, 'social_tasks_completed', { completed_at: new Date().toISOString() });

        break;
      }

      case 'connect_wallet': {
        // Signature is already verified above (verifyWalletProof) for every
        // action, so by this point wallet control is proven. The wallet is the
        // MEMBERSHIP anchor — signing it makes you a member regardless of any
        // social identity. Allocation ELIGIBILITY (the `eligible` generated
        // column) is separate and needs a verified X identity (0023: X-only;
        // Telegram is community/recovery and no longer flips `eligible`).
        const now = new Date().toISOString();
        const updates: Record<string, unknown> = {
          step_3_status: 'completed',
          updated_at: now,
        };

        // Bind X IF the user completed the X path (optional now, not required).
        // Its identity + task attestations live in the encrypted onboarding
        // cookie set by /api/whitelist/x/*. A user who chose Telegram or
        // wallet-only simply has no X cookie — that's a valid, ineligible-via-X
        // member, not an error.
        if (isXConfigured()) {
          const xs = readSession(req.cookies.get(X_SESSION_COOKIE)?.value);
          if (xs) {
            const likeRequired = Boolean((await resolveTargets()).likeTweetId);
            const tasksDone =
              xs.tasks.follow && xs.tasks.post && (!likeRequired || xs.tasks.like);
            if (tasksDone) {
              // Dedupe: one X account = one whitelist spot. If this verified X
              // id is already bound to a DIFFERENT wallet, stop with a clean
              // 409 instead of letting the 0021 unique index throw a raw 500.
              const existingX = await whitelistWalletBySocialIdentity('twitterUserId', xs.userId);
              if (existingX && existingX.wallet_address !== walletLower) {
                return NextResponse.json(
                  {
                    error:
                      'This X account is already on the whitelist with a different wallet. One X account, one spot.',
                  },
                  { status: 409 },
                );
              }

              Object.assign(updates, {
                twitter_user_id: xs.userId,
                twitter_username: xs.username,
                twitter_connected_at: now,
                twitter_oauth_provider: 'x_oauth2',
                x_followed: xs.tasks.follow,
                x_liked: xs.tasks.like,
                x_posted: xs.tasks.post,
                x_posted_tweet_id: xs.postedTweetId ?? null,
                social_steps_policy_version: '2.1-oauth-intent',
                step_1_status: 'completed',
                step_2_status: 'completed',
              });
              clearXSession = true;
            }
          }
        }

        // Bind Telegram IF the user completed the Telegram path. Same pattern:
        // present → bind, absent → skip. We re-check group membership fresh at
        // bind time (one free Bot API call) so a "joined then left" cookie
        // can't buy eligibility; if the check can't run we trust the cookie's
        // last-known state.
        if (isTgConfigured()) {
          const tg = readTgSession(req.cookies.get(TG_SESSION_COOKIE)?.value);
          if (tg) {
            let isMember = tg.isMember;
            try {
              isMember = await isChatMember(groupChatId(), tg.userId);
            } catch (err) {
              console.error('[whitelist] tg membership re-check failed:', err);
            }
            // Dedupe: one Telegram account = one spot (0022 unique index backs this).
            const existingTg = await whitelistWalletBySocialIdentity('telegramUserId', tg.userId);
            if (existingTg && existingTg.wallet_address !== walletLower) {
              return NextResponse.json(
                {
                  error:
                    'This Telegram account is already on the whitelist with a different wallet. One Telegram account, one spot.',
                },
                { status: 409 },
              );
            }
            Object.assign(updates, {
              telegram_user_id: tg.userId,
              telegram_username: tg.username,
              telegram_first_name: tg.firstName,
              telegram_connected_at: now,
              telegram_chat_member: isMember,
              telegram_membership_checked_at: now,
            });
            clearTgSession = true;
          }
        }

        try {
          await updateWhitelistMember(walletLower, updates);
        } catch (updateErr: unknown) {
          // 23505 = a social-identity unique index fired (0021 X / 0022 TG):
          // two onboardings raced the same account past the check above.
          // Surface the matching clean 409.
          if ((updateErr as { code?: string }).code === '23505') {
            const dbError = updateErr as { message?: string; details?: string };
            const isTg = `${dbError.message ?? ''} ${dbError.details ?? ''}`
              .toLowerCase()
              .includes('telegram');
            return NextResponse.json(
              {
                error: isTg
                  ? 'This Telegram account is already on the whitelist with a different wallet. One Telegram account, one spot.'
                  : 'This X account is already on the whitelist with a different wallet. One X account, one spot.',
              },
              { status: 409 },
            );
          }
          throw updateErr;
        }

        await addWhitelistEvent(walletLower, 'wallet_signed', {
            signature: (payload?.signature ?? '').slice(0, 10) + '...',
            verified: true,
            x_bound: clearXSession,
        });

        break;
      }
    }

    // ── Wallet signed → approved member. Approval now keys on the wallet step
    // alone (the membership anchor); a verified X identity drives `eligible`,
    // not approval, so a wallet-only or Telegram-only member is
    // approved-but-ineligible. ──
    const member = await whitelistMemberByWallet(walletLower);

    if (
      member &&
      member.step_3_status === 'completed' &&
      member.whitelist_status !== 'approved'
    ) {
      const now = new Date().toISOString();
      await updateWhitelistMember(walletLower, {
        whitelistStatus: 'approved', approvedAt: now, updatedAt: now,
      });

      await addWhitelistEvent(walletLower, 'approved', { approved_at: now, auto: true });
    }

    // Return updated status
    const updated = await whitelistMemberByWallet(walletLower);

    const response = NextResponse.json({
      status: updated?.whitelist_status ?? 'pending',
      eligible: updated?.eligible ?? false,
      steps: {
        step_1: updated?.step_1_status ?? 'not_started',
        step_2: updated?.step_2_status ?? 'not_started',
        step_3: updated?.step_3_status ?? 'not_started',
      },
      twitter_username: updated?.twitter_username,
      telegram_username: updated?.telegram_username,
      approved_at: updated?.approved_at,
    });
    if (clearXSession) response.cookies.delete(X_SESSION_COOKIE);
    if (clearTgSession) response.cookies.delete(TG_SESSION_COOKIE);
    return response;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[whitelist] POST action error:', msg);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
