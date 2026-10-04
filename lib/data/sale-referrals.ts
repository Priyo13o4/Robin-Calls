import { sql } from "drizzle-orm";

import { database } from "@/lib/db/client";
import { bigintFromNumericString } from "./numeric";
import { resultRows } from "./rows";
import { deriveReferralCode, normaliseCode } from "@/lib/referrals/code";
import { cleanSocials, type Social } from "@/lib/referrals/socials";

/**
 * The persistence boundary for the referral + airdrop plane (migration 0087,
 * docs/REFERRALS.md). Nothing outside this file touches these five tables.
 *
 * Two conventions from CLAUDE.md §1 that do real work here:
 *
 *  - Reads degrade, writes throw. A leaderboard with no database renders empty;
 *    a user who just signed a message to apply a code gets an error, never a
 *    silent no-op that looks like success.
 *
 *  - Every read whose emptiness would become a SENTENCE returns three states,
 *    not two. "That code does not exist" and "we could not check" are different
 *    facts, and the first one told to a user holding a real code is a lie that
 *    costs them the airdrop.
 */

export type ReferralStatus = "none" | "pending" | "credited" | "missed";

export interface SaleParticipant {
  walletAddress: string;
  nickname: string | null;
  emoji: string | null;
  socials: Social[];
  referralCode: string | null;
  referredByCode: string | null;
  referredByWallet: string | null;
  referralBoundAt: string | null;
  referralStatus: ReferralStatus;
  firstContributionBlock: number | null;
  firstContributionAt: string | null;
  firstContributionTx: string | null;
}

/** Three states. `unavailable` is a fault, `absent` is an answer. */
export type ParticipantRead =
  | { kind: "found"; participant: SaleParticipant }
  | { kind: "absent" }
  | { kind: "unavailable" };

function toParticipant(r: Record<string, unknown>): SaleParticipant {
  return {
    walletAddress: String(r.wallet_address),
    nickname: r.nickname == null ? null : String(r.nickname),
    emoji: r.emoji == null ? null : String(r.emoji),
    socials: cleanSocials(r.socials),
    referralCode: r.referral_code == null ? null : String(r.referral_code),
    referredByCode: r.referred_by_code == null ? null : String(r.referred_by_code),
    referredByWallet: r.referred_by_wallet == null ? null : String(r.referred_by_wallet),
    referralBoundAt: r.referral_bound_at == null ? null : String(r.referral_bound_at),
    referralStatus: String(r.referral_status) as ReferralStatus,
    firstContributionBlock: r.first_contribution_block == null ? null : Number(r.first_contribution_block),
    firstContributionAt: r.first_contribution_at == null ? null : String(r.first_contribution_at),
    firstContributionTx: r.first_contribution_tx == null ? null : String(r.first_contribution_tx),
  };
}

const PARTICIPANT_COLUMNS = sql`wallet_address, nickname, emoji, socials, referral_code, referred_by_code,
  referred_by_wallet, referral_bound_at, referral_status, first_contribution_block,
  first_contribution_at, first_contribution_tx`;

/* ------------------------------------------------------------------ */
/*  Reads                                                              */
/* ------------------------------------------------------------------ */

export async function readParticipant(walletAddress: string): Promise<ParticipantRead> {
  const conn = database();
  if (!conn) return { kind: "unavailable" };
  try {
    const rows = resultRows(
      await conn.execute(
        sql`select ${PARTICIPANT_COLUMNS} from sale_participants where wallet_address = ${walletAddress.toLowerCase()}`,
      ),
    );
    return rows[0] ? { kind: "found", participant: toParticipant(rows[0]) } : { kind: "absent" };
  } catch {
    return { kind: "unavailable" };
  }
}

/**
 * Resolve a code to the wallet that owns it.
 *
 * The three states are load-bearing: this is what the sale page calls to decide
 * whether to show "code applied" or "we don't recognise that code", and a
 * database blip must produce neither — it produces "we can't check that right
 * now", which is a retry rather than a dead end.
 */
export async function readParticipantByCode(code: string): Promise<ParticipantRead> {
  const normalised = normaliseCode(code);
  // A malformed code is a real answer — no lookup can make it exist.
  if (!normalised) return { kind: "absent" };

  const conn = database();
  if (!conn) return { kind: "unavailable" };
  try {
    const rows = resultRows(
      await conn.execute(
        sql`select ${PARTICIPANT_COLUMNS} from sale_participants where referral_code = ${normalised}`,
      ),
    );
    return rows[0] ? { kind: "found", participant: toParticipant(rows[0]) } : { kind: "absent" };
  } catch {
    return { kind: "unavailable" };
  }
}

export interface WalletTotals {
  /** Everything this wallet put into the sale — the contract's own census
   *  total, not our per-tx sum (which misses top-ups until the next pass and
   *  direct contributions entirely). */
  contributedWei: bigint;
  /** Verified claim transactions the mirror holds for this wallet. */
  contributionCount: number;
  /** Credited referrals who have actually paid. */
  referredCount: number;
  /** What those referrals contributed, all of it, not just their first send. */
  referredWei: bigint;
}

/**
 * One wallet's own position. Returns null — not zeroes — when the database
 * could not be read: zeroes here would render as "you have contributed nothing
 * and referred nobody", which is §8 #9 with money attached.
 *
 * `contributedWei` reads the CENSUS row, whose existence means the contract
 * itself counts this wallet as a contributor. A wallet with claims still
 * pending and no census row yet reads 0 here — the UI renders "confirming"
 * for that case from the claim state, not from this number.
 */
export async function readWalletTotals(walletAddress: string): Promise<WalletTotals | null> {
  const conn = database();
  if (!conn) return null;
  const wallet = walletAddress.toLowerCase();
  try {
    const mine = resultRows(
      await conn.execute(
        sql`select t.contributed_wei as wei,
                   (select count(*) from sale_contributions c
                    where c.wallet_address = ${wallet}) as n
            from sale_wallet_totals t
            where t.wallet_address = ${wallet}`,
      ),
    )[0];
    const theirs = resultRows(
      await conn.execute(
        sql`select count(distinct p.wallet_address) as n, coalesce(sum(t2.contributed_wei), 0) as wei
            from sale_participants p
            join sale_wallet_totals t2 on t2.wallet_address = p.wallet_address
            where p.referred_by_wallet = ${wallet} and p.referral_status = 'credited'`,
      ),
    )[0];
    // No census row: the contract has not counted this wallet yet (or the
    // reconciler has not read it). Not a zero it is entitled to publish, but
    // the wallet's own page needs a shape — 0 wei here is "no confirmed
    // contribution", which the panel pairs with the claim-pending state.
    return {
      contributedWei: bigintFromNumericString(mine?.wei == null ? null : String(mine.wei)),
      contributionCount: Number(mine?.n ?? 0),
      referredCount: Number(theirs?.n ?? 0),
      referredWei: bigintFromNumericString(theirs?.wei == null ? null : String(theirs.wei)),
    };
  } catch {
    return null;
  }
}

export interface LeaderboardEntry {
  walletAddress: string;
  nickname: string | null;
  emoji: string | null;
  socials: Social[];
  /** Contributions board: what they put in. Referrals board: what they brought. */
  amountWei: bigint;
  /** Contributions board: number of sends. Referrals board: number of people. */
  count: number;
  /** Contributions board: whether this contributor claimed a refund on an abandoned sale. */
  refunded?: boolean;
}

/**
 * Three states, same as every other read in this module.
 *
 * An empty board and a board we could not read look identical to a reader, and
 * only one of them is a fact about the sale (§4). Returning `[]` on a statement
 * timeout published "Nobody is on this board yet" over four hundred real
 * referrals.
 */
export type LeaderboardRead =
  | { kind: "found"; entries: LeaderboardEntry[] }
  | { kind: "unavailable" };

/**
 * Contributors by ETH in. Ties break on who got there first, so the order is
 * stable across refreshes rather than left to the planner.
 *
 * Amounts read the CENSUS (`sale_wallet_totals`), whose rows exist exactly
 * when the contract counts the wallet as a contributor — that replaces the
 * `join sale_contributions` that used to enforce "actually paid" and covers
 * direct contributors no claim brought in. The `count` shown per row is the
 * number of VERIFIED claim transactions we hold for them, which is a fact
 * about what we saw, not about what they did — the boards label it "SENDS".
 */
export async function readContributionLeaderboard(limit: number): Promise<LeaderboardRead> {
  const conn = database();
  if (!conn) return { kind: "unavailable" };
  try {
    const rows = resultRows(
      await conn.execute(
        sql`select t.wallet_address, p.nickname, p.emoji, p.socials,
                   t.contributed_wei as amount_wei,
                   t.refunded,
                   (select count(*) from sale_contributions c
                    where c.wallet_address = t.wallet_address) as n,
                   t.census_index as first_slot
            from sale_wallet_totals t
            left join sale_participants p on p.wallet_address = t.wallet_address
            order by amount_wei desc, first_slot asc
            limit ${limit}`,
      ),
    );
    return {
      kind: "found",
      entries: rows.map((r) => ({
        walletAddress: String(r.wallet_address),
        nickname: r.nickname == null ? null : String(r.nickname),
        emoji: r.emoji == null ? null : String(r.emoji),
        socials: cleanSocials(r.socials),
        amountWei: bigintFromNumericString(String(r.amount_wei)),
        count: Number(r.n),
        // null = the flag was never read. Undefined, so the badge renders on a
        // measured true only.
        refunded: r.refunded == null ? undefined : Boolean(r.refunded),
      })),
    };
  } catch {
    return { kind: "unavailable" };
  }
}

/**
 * Referrers by the ETH their people brought in.
 *
 * `credited` only — a wallet that applied a code and never paid is not a
 * referral, and counting it would let anyone inflate their standing for free.
 * The join to the census is what enforces "actually paid" — a census row
 * exists exactly when the contract counts the wallet — and `count(distinct)`
 * keeps a referral who contributed five times from counting as five people.
 */
export async function readReferrerLeaderboard(limit: number): Promise<LeaderboardRead> {
  const conn = database();
  if (!conn) return { kind: "unavailable" };
  try {
    const rows = resultRows(
      await conn.execute(
        sql`select p.referred_by_wallet as wallet_address, r.nickname, r.emoji, r.socials,
                   count(distinct p.wallet_address) as n,
                   sum(t.contributed_wei) as amount_wei
            from sale_participants p
            join sale_wallet_totals t on t.wallet_address = p.wallet_address
            left join sale_participants r on r.wallet_address = p.referred_by_wallet
            where p.referral_status = 'credited' and p.referred_by_wallet is not null
            group by p.referred_by_wallet, r.nickname, r.emoji, r.socials
            order by amount_wei desc, n desc, wallet_address asc
            limit ${limit}`,
      ),
    );
    return {
      kind: "found",
      entries: rows.map((r) => ({
        walletAddress: String(r.wallet_address),
        nickname: r.nickname == null ? null : String(r.nickname),
        emoji: r.emoji == null ? null : String(r.emoji),
        socials: cleanSocials(r.socials),
        amountWei: bigintFromNumericString(String(r.amount_wei)),
        count: Number(r.n),
      })),
    };
  } catch {
    return { kind: "unavailable" };
  }
}

export type MirrorFreshnessPair = {
  totalsAt: string | null;
  participantsAt: string | null;
};

/**
 * Read the latest updated_at across both mirror tables in one statement.
 * Folded for leaderboard caching: totals_at covers census refresh times,
 * and participants_at covers nicknames, emojis, and bindings.
 */
export async function readMirrorFreshnessPair(): Promise<MirrorFreshnessPair | null> {
  const conn = database();
  if (!conn) return null;
  try {
    const row = resultRows(
      await conn.execute(
        sql`select (select max(updated_at) from sale_wallet_totals) as totals_at,
                   (select max(updated_at) from sale_participants) as participants_at`,
      ),
    )[0];
    if (!row) return null;
    return {
      totalsAt: row.totals_at == null ? null : String(row.totals_at),
      participantsAt: row.participants_at == null ? null : String(row.participants_at),
    };
  } catch {
    return null;
  }
}

interface CachedLeaderboard {
  read: LeaderboardRead;
  /** The freshness this entry was READ at, compared on every hit. Held in the
   *  entry rather than in the key: keying on it mints a new entry every time
   *  the reconciler runs and never reclaims the old one, which is the
   *  unbounded process-local map §5 forbids. Keyed by board and limit, the map
   *  is bounded by the route's own 1..100 clamp. */
  totalsAt: string | null;
  participantsAt: string | null;
  storedAt: number;
}

const LEADERBOARD_CACHE_TTL_MS = 60_000;
const cached = new Map<string, CachedLeaderboard>();
const inFlight = new Map<string, Promise<{ read: LeaderboardRead; mirrorUpdatedAt: string | null }>>();

/**
 * Read either leaderboard with single-flight deduplication and memory caching.
 *
 * Keyed on the latest updated_at of both mirror tables:
 * - sale_wallet_totals for amount and census changes.
 * - sale_participants for nicknames, emojis, and bindings.
 *
 * Cache key: board:limit. The two freshness readings live in the entry and are
 * compared on each hit, so a moved mirror REPLACES the entry instead of adding
 * one. A null on either side means that table is empty, which is a real
 * reading and not a miss.
 *
 * Faulted reads (read.kind !== "found") are never cached.
 */
export async function readLeaderboardCached(
  board: "contributions" | "referrals",
  limit: number,
): Promise<{ read: LeaderboardRead; mirrorUpdatedAt: string | null }> {
  const conn = database();
  if (!conn) return { read: { kind: "unavailable" }, mirrorUpdatedAt: null };

  const pair = await readMirrorFreshnessPair();
  if (!pair) {
    return { read: { kind: "unavailable" }, mirrorUpdatedAt: null };
  }

  const key = `${board}:${limit}`;

  const hit = cached.get(key);
  if (
    hit &&
    hit.totalsAt === pair.totalsAt &&
    hit.participantsAt === pair.participantsAt &&
    Date.now() - hit.storedAt < LEADERBOARD_CACHE_TTL_MS
  ) {
    return { read: hit.read, mirrorUpdatedAt: hit.totalsAt };
  }

  const running = inFlight.get(key);
  if (running) return running;

  const run = (
    board === "referrals" ? readReferrerLeaderboard(limit) : readContributionLeaderboard(limit)
  )
    .then((read) => {
      if (read.kind === "found") {
        cached.set(key, {
          read,
          totalsAt: pair.totalsAt,
          participantsAt: pair.participantsAt,
          storedAt: Date.now(),
        });
      }
      return { read, mirrorUpdatedAt: pair.totalsAt };
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, run);
  return run;
}

/** Every referrer, unranked and uncapped — the snapshot's input. Throws: a
 *  short list here would silently shrink the 4% pool's denominator. */
export async function readAllReferrerTotals(): Promise<{ wallet: string; referredCount: number; referredWei: bigint }[]> {
  const conn = database();
  if (!conn) throw new Error("Database not configured");
  const rows = resultRows(
    await conn.execute(
      sql`select p.referred_by_wallet as wallet,
                 count(distinct p.wallet_address) as n,
                 sum(t.contributed_wei) as wei
          from sale_participants p
          join sale_wallet_totals t on t.wallet_address = p.wallet_address
          where p.referral_status = 'credited' and p.referred_by_wallet is not null
          group by p.referred_by_wallet`,
    ),
  );
  return rows.map((r) => ({
    wallet: String(r.wallet),
    referredCount: Number(r.n),
    referredWei: bigintFromNumericString(String(r.wei)),
  }));
}

/* ------------------------------------------------------------------ */
/*  Writes the user is waiting on                                      */
/* ------------------------------------------------------------------ */

export type BindOutcome =
  | { ok: true; referrerWallet: string; code: string }
  | { ok: false; reason: "unknown-code" | "own-code" | "already-contributed" };

/**
 * Apply a referral code to a wallet.
 *
 * Provisional until the wallet's first contribution is indexed — up to that
 * moment it can be changed freely, and after it the binding is frozen forever.
 * The freeze is enforced HERE, in the `where` on the conflict branch, not in a
 * caller's if-statement: `first_contribution_block is not null` is the single
 * fact that decides it, and a check in the route would be one a second caller
 * could skip (§8 #7).
 *
 * A wallet that has already contributed gets `already-contributed`, which the
 * UI must state as a settled fact rather than a retryable error.
 */
export async function bindReferralCode(
  walletAddress: string,
  rawCode: string,
): Promise<BindOutcome> {
  const conn = database();
  if (!conn) throw new Error("Database not configured");

  const code = normaliseCode(rawCode);
  if (!code) return { ok: false, reason: "unknown-code" };

  const wallet = walletAddress.toLowerCase();
  const owner = resultRows(
    await conn.execute(sql`select wallet_address from sale_participants where referral_code = ${code}`),
  )[0];
  if (!owner) return { ok: false, reason: "unknown-code" };

  const referrer = String(owner.wallet_address);
  // Checked here for the sentence; the database's own constraint is what makes
  // it true even if a future caller forgets.
  if (referrer === wallet) return { ok: false, reason: "own-code" };

  const written = resultRows(
    await conn.execute(
      sql`insert into sale_participants
            (wallet_address, referred_by_code, referred_by_wallet, referral_bound_at,
             referral_status)
          values (${wallet}, ${code}, ${referrer}, now(), 'pending')
          on conflict (wallet_address) do update
            set referred_by_code    = excluded.referred_by_code,
                referred_by_wallet  = excluded.referred_by_wallet,
                referral_bound_at   = excluded.referral_bound_at,
                referral_status     = 'pending',
                updated_at          = now()
            where sale_participants.first_contribution_block is null
          returning wallet_address`,
    ),
  );

  if (written.length === 0) return { ok: false, reason: "already-contributed" };
  return { ok: true, referrerWallet: referrer, code };
}

/** Nickname, emoji and socials. Empty strings clear a field — that is a real
 *  edit, not a missing value, so they are stored as NULL / [] rather than rejected. */
export async function setParticipantProfile(
  walletAddress: string,
  nickname: string | null,
  emoji: string | null,
  socials: Social[],
): Promise<void> {
  const conn = database();
  if (!conn) throw new Error("Database not configured");
  await conn.execute(
    sql`insert into sale_participants (wallet_address, nickname, emoji, socials)
        values (${walletAddress.toLowerCase()}, ${nickname}, ${emoji}, ${JSON.stringify(socials)}::jsonb)
        on conflict (wallet_address) do update
          set nickname = excluded.nickname, emoji = excluded.emoji,
              socials = excluded.socials, updated_at = now()`,
  );
}

/* ------------------------------------------------------------------ */
/*  Mirror writes — verified claims and census entries                 */
/* ------------------------------------------------------------------ */
/* The walker's batch insert (recordContributions) died with the walker:
 * markClaimVerified writes one verified transaction at a time, inside the
 * same transaction that marks the claim. Nothing else wrote contributions. */

/**
 * Decide, for every wallet that has paid but has not been settled, whether its
 * referral code counted.
 *
 * Computed from the MIRROR rather than from any one write, so it is
 * order-independent and self-healing: a claim verified before or after the
 * census pass, in any order, still settles each wallet against its genuine
 * earliest recorded contribution.
 *
 * There is no longer any comparison to make. "The code came first" is enforced
 * where the binding is WRITTEN: `bindReferralCode` refuses once
 * first_contribution_block is set, so a code on the row is proof it was applied
 * in time and the only question left is whether one is there. That retired the
 * whole block-ordering apparatus, and with it the race between two positions
 * neither of us controlled.
 */
export async function settleFirstContributions(): Promise<{ credited: number; missed: number }> {
  const conn = database();
  if (!conn) throw new Error("Database not configured");

  const settled = resultRows(
    await conn.execute(
      sql`with candidates as (
            select c.wallet_address, c.block_number, c.block_time, c.tx_hash, c.log_index
            from sale_contributions c
            left join sale_participants p on p.wallet_address = c.wallet_address
            where p.wallet_address is null
               or p.first_contribution_block is null
               or p.first_contribution_at is null
          ),
          firsts as (
            select distinct on (wallet_address)
                   wallet_address, block_number, block_time, tx_hash
            from candidates
            order by wallet_address, block_number, log_index
          )
          insert into sale_participants
            (wallet_address, first_contribution_block, first_contribution_at, first_contribution_tx, referral_status)
          select wallet_address, block_number, block_time, tx_hash, 'missed' from firsts
          on conflict (wallet_address) do update
            set first_contribution_block = case
                  when sale_participants.first_contribution_block is null then excluded.first_contribution_block
                  else least(sale_participants.first_contribution_block, excluded.first_contribution_block)
                end,
                -- Backfill chain-fact columns for wallets the census recorded first.
                -- Currently inert: eligibility compares block numbers, not clocks,
                -- but these columns must not stay permanently NULL once a verified
                -- receipt is indexed.
                first_contribution_at    = coalesce(sale_participants.first_contribution_at, excluded.first_contribution_at),
                first_contribution_tx    = coalesce(sale_participants.first_contribution_tx, excluded.first_contribution_tx),
                -- Presence, not order: a binding can only exist on a row whose
                -- first contribution was not yet recorded, so having one IS
                -- having been early. Guarded to unsettled rows by the WHERE
                -- below, so this never re-decides a settled wallet.
                referral_status = case
                  when sale_participants.referred_by_code is not null
                  then 'credited' else 'missed' end,
                updated_at = now()
            where sale_participants.first_contribution_block is null
               or sale_participants.first_contribution_at is null
          returning referral_status`,
    ),
  );

  let credited = 0;
  for (const r of settled) if (String(r.referral_status) === "credited") credited++;
  return { credited, missed: settled.length - credited };
}

/**
 * Issue codes to wallets that have paid and do not have one yet.
 *
 * The code is derived, so this is a pure write of a value we can recompute —
 * but the unique index is still the authority. On the (vanishingly unlikely)
 * collision the next attempt is tried rather than assumed away, because a
 * silently unissued code is a user who can never share anything.
 */
export async function issuePendingReferralCodes(limit = 500): Promise<number> {
  const conn = database();
  if (!conn) throw new Error("Database not configured");

  const pending = resultRows(
    await conn.execute(
      sql`select wallet_address from sale_participants
          where first_contribution_block is not null and referral_code is null
          order by first_contribution_block asc
          limit ${limit}`,
    ),
  );
  if (pending.length === 0) return 0;

  // Two wallets whose attempt-0 codes collide must not both reach the statement:
  // the `not exists` guard is evaluated against the pre-statement snapshot, so
  // neither sees the other, both write the same code, and the UNIQUE index
  // aborts the WHOLE batch. Nobody in it gets a code, the reconciler throws, and
  // the same set recurs every cycle. Verified against Postgres. The duplicate is
  // simply left out and the retry loop below issues it at attempt 1.
  const seen = new Set<string>();
  const pairs: { wallet: string; code: string }[] = [];
  for (const row of pending) {
    const wallet = String(row.wallet_address).toLowerCase();
    const code = deriveReferralCode(wallet, 0);
    if (seen.has(code)) continue;
    seen.add(code);
    pairs.push({ wallet, code });
  }

  const values = pairs.map(
    (p) => sql`(${p.wallet}::text, ${p.code}::text)`,
  );

  const updated = resultRows(
    await conn.execute(
      sql`update sale_participants p
          set referral_code = v.code,
              referral_code_issued_at = now(),
              updated_at = now()
          from (values ${sql.join(values, sql`, `)}) as v(wallet, code)
          where p.wallet_address = v.wallet
            and p.referral_code is null
            and not exists (select 1 from sale_participants x where x.referral_code = v.code)
          returning p.wallet_address`,
    ),
  );

  let issued = updated.length;

  // Re-select over every PENDING wallet, not just the ones that reached the
  // statement: a wallet dropped by the dedupe above never appears in `pairs`,
  // and it is exactly the one that still needs a code.
  const walletList = pending.map((row) => String(row.wallet_address).toLowerCase());
  const stillPending = resultRows(
    await conn.execute(
      sql`select wallet_address from sale_participants
          where wallet_address in (${sql.join(walletList.map((w) => sql`${w}`), sql`, `)})
            and referral_code is null`,
    ),
  );

  // For the collision set only, run the per-wallet retry loop starting at attempt 1.
  for (const row of stillPending) {
    const wallet = String(row.wallet_address);
    for (let attempt = 1; attempt < 8; attempt++) {
      const code = deriveReferralCode(wallet, attempt);
      const written = resultRows(
        await conn.execute(
          sql`update sale_participants
              set referral_code = ${code}, referral_code_issued_at = now(), updated_at = now()
              where wallet_address = ${wallet}
                and referral_code is null
                and not exists (select 1 from sale_participants x where x.referral_code = ${code})
              returning wallet_address`,
        ),
      );
      if (written.length > 0) {
        issued++;
        break;
      }
      const now = resultRows(
        await conn.execute(sql`select referral_code from sale_participants where wallet_address = ${wallet}`),
      )[0];
      if (now?.referral_code != null) break;
    }
  }

  return issued;
}

/* ------------------------------------------------------------------ */
/*  Contribution claims — browser-submitted transaction hashes         */
/* ------------------------------------------------------------------ */

/**
 * The walker is gone. The browser, which already holds the receipt, POSTs the
 * transaction hash; the server verifies it against the chain independently.
 * These four functions are the queue and its verdicts.
 */

export type ClaimVerdict = "pending" | "verified" | "refused";

export type ClaimRead =
  | { kind: "recorded"; verdict: ClaimVerdict }
  /** The hash was already claimed by a different wallet. */
  | { kind: "claimed-by-other" };

/**
 * Record a browser's claim BEFORE any RPC work happens, and return immediately.
 * An RPC outage can therefore never cost the user their place in the queue,
 * only delay it.
 *
 * Idempotent on tx_hash: a resubmission (reload, double click) returns the
 * existing row unchanged. A read-then-insert rather than a single upsert,
 * because the WALLET is part of the answer and not of the conflict target —
 * `on conflict do nothing` cannot say "already claimed by someone else".
 *
 * If a hash was previously claimed by another wallet but was REFUSED, that
 * refusal is proof that wallet did not own the tx. The row is reclaimed by the
 * new claimant, resetting its verdict to 'pending'. A 'pending' or 'verified'
 * claim continues to return 'claimed-by-other'.
 */
export async function recordContributionClaim(
  txHash: string,
  walletAddress: string,
): Promise<ClaimRead> {
  const conn = database();
  if (!conn) throw new Error("Database not configured");
  const db = conn;
  const tx = txHash.toLowerCase();
  const wallet = walletAddress.toLowerCase();

  async function tryReclaimRefused(tx: string, wallet: string): Promise<ClaimRead | null> {
    await db.execute(
      sql`update sale_contribution_claims
          set wallet_address = ${wallet},
              verdict = 'pending',
              refused_because = null,
              verified_at = null,
              attempts = 0,
              last_attempt_at = null,
              created_at = now()
          where tx_hash = ${tx} and verdict = 'refused'`,
    );
    const row = resultRows(
      await db.execute(sql`select wallet_address, verdict from sale_contribution_claims where tx_hash = ${tx}`),
    )[0];
    if (row && String(row.wallet_address) === wallet) {
      return { kind: "recorded", verdict: String(row.verdict) as ClaimVerdict };
    }
    return null;
  }

  const existing = resultRows(
    await conn.execute(sql`select wallet_address, verdict
                            from sale_contribution_claims where tx_hash = ${tx}`),
  )[0];
  if (existing) {
    if (String(existing.wallet_address) !== wallet) {
      if (String(existing.verdict) === "refused") {
        const reclaimed = await tryReclaimRefused(tx, wallet);
        if (reclaimed) return reclaimed;
      }
      return { kind: "claimed-by-other" };
    }
    return { kind: "recorded", verdict: String(existing.verdict) as ClaimVerdict };
  }

  await conn.execute(
    sql`insert into sale_contribution_claims (tx_hash, wallet_address)
        values (${tx}, ${wallet})
        on conflict (tx_hash) do nothing`,
  );
  // A concurrent request may have inserted between the select and here; the
  // answer for the collision is whatever that row says, not "pending".
  const row = resultRows(
    await conn.execute(sql`select wallet_address, verdict from sale_contribution_claims where tx_hash = ${tx}`),
  )[0];
  if (row && String(row.wallet_address) !== wallet) {
    if (String(row.verdict) === "refused") {
      const reclaimed = await tryReclaimRefused(tx, wallet);
      if (reclaimed) return reclaimed;
    }
    return { kind: "claimed-by-other" };
  }
  return { kind: "recorded", verdict: String(row?.verdict ?? "pending") as ClaimVerdict };
}

/**
 * Mark a claim VERIFIED and write the contribution it pointed at, in one
 * transaction. The contribution insert is idempotent on (tx_hash, log_index)
 * — the same key the walker used — so a claim verified twice, or a claim
 * racing the reconciler, writes once and credits nobody twice.
 */
export async function markClaimVerified(args: {
  txHash: string;
  walletAddress: string;
  logIndex: number;
  amountWei: bigint;
  totalRaisedWei: bigint | null;
  blockNumber: number;
  blockTime: string;
}): Promise<void> {
  const conn = database();
  if (!conn) throw new Error("Database not configured");
  const tx = args.txHash.toLowerCase();
  const wallet = args.walletAddress.toLowerCase();

  await conn.transaction(async (trx) => {
    await trx.execute(
      sql`insert into sale_contributions
            (tx_hash, log_index, wallet_address, amount_wei, total_raised_wei, block_number, block_time)
          values (${tx}, ${args.logIndex}, ${wallet}, ${args.amountWei.toString()}::numeric,
                  ${args.totalRaisedWei === null ? null : args.totalRaisedWei.toString()}::numeric,
                  ${args.blockNumber}, ${args.blockTime}::timestamptz)
          on conflict (tx_hash, log_index) do nothing`,
    );
    await trx.execute(
      sql`update sale_contribution_claims
          set verdict = 'verified', verified_at = now(), refused_because = null,
              attempts = attempts + 1, last_attempt_at = now()
          where tx_hash = ${tx} and wallet_address = ${wallet}`,
    );
  });
}

/**
 * Mark a claim REFUSED. Only ever called with an answer the chain itself gave:
 * the receipt reverted, the log came from another contract, or the log's
 * contributor is not the claiming wallet. An RPC failure must NEVER reach here
 * — the caller keeps the claim pending instead (§4: unknown is not "no").
 */
export async function markClaimRefused(args: {
  txHash: string;
  walletAddress: string;
  reason: string;
}): Promise<void> {
  const conn = database();
  if (!conn) throw new Error("Database not configured");
  await conn.execute(
    // `verified_at` is DECIDED-at, not verified-at: the schema's
    // `verdict_paired` check reads `(verdict = 'pending') = (verified_at is
    // null)`, so any non-pending verdict must stamp it. Omitting it here threw
    // on every refusal, both callers swallowed the throw, and no row could ever
    // reach 'refused' — which silently disabled the reclaim branch in
    // `recordContributionClaim` that keys on exactly that value.
    sql`update sale_contribution_claims
        set verdict = 'refused', refused_because = ${args.reason.slice(0, 300)},
            verified_at = now(),
            attempts = attempts + 1, last_attempt_at = now()
        where tx_hash = ${args.txHash.toLowerCase()} and wallet_address = ${args.walletAddress.toLowerCase()}`,
  );
}

/** Count a failed attempt WITHOUT deciding anything. The claim stays pending. */
export async function noteClaimAttempt(txHash: string): Promise<void> {
  const conn = database();
  if (!conn) return;
  try {
    await conn.execute(
      sql`update sale_contribution_claims
          set attempts = attempts + 1, last_attempt_at = now()
          where tx_hash = ${txHash.toLowerCase()}`,
    );
  } catch {
    // Best-effort bookkeeping beside a failure the caller is already reporting.
  }
}

/**
 * Pending claims for the reconciler, LEAST RECENTLY TRIED first. Ordering by
 * created_at let the oldest 200 (e.g. bogus hashes, which never resolve) be
 * the whole batch every pass, starving every real claim behind them.
 * No give-up cap on a failed READ: only a chain answer of "no such transaction",
 * held for hours, may refuse one (lib/referrals/reconcile.ts).
 */
export async function readPendingClaims(limit = 200): Promise<
  { txHash: string; walletAddress: string; attempts: number; createdAt: Date }[]
> {
  const conn = database();
  if (!conn) throw new Error("Database not configured");
  const rows = resultRows(
    await conn.execute(
      sql`select tx_hash, wallet_address, attempts, created_at
          from sale_contribution_claims
          where verdict = 'pending'
          order by last_attempt_at asc nulls first, created_at asc
          limit ${limit}`,
    ),
  );
  return rows.map((r) => ({
    txHash: String(r.tx_hash),
    walletAddress: String(r.wallet_address),
    attempts: Number(r.attempts),
    createdAt: new Date(String(r.created_at)),
  }));
}

/* ------------------------------------------------------------------ */
/*  Census totals — the contract's own wallet balances                */
/* ------------------------------------------------------------------ */

/**
 * Record one census entry: a wallet the contract itself counts as a
 * contributor, whether or not any browser claimed a hash for it. The
 * reconciler calls this for census indices the mirror has not seen.
 *
 * Returns true when the wallet was newly recorded. `on conflict do nothing` —
 * the census slot is unique by construction (the contract pushes a wallet
 * once), and a second sighting of the same index is a no-op, not an update:
 * updates come from `refreshWalletTotals`, which re-reads every known wallet
 * whenever the sale moves.
 * Settle happens in the same statement, crediting if a binding exists and
 * marking missed otherwise: after the 0091 rework, binding presence decides
 * attribution without needing block ordering.
 */
export async function recordCensusEntry(args: {
  walletAddress: string;
  contributedWei: bigint;
  censusIndex: number;
  firstObservedBlock: number;
  refunded?: boolean;
}): Promise<boolean> {
  const conn = database();
  if (!conn) throw new Error("Database not configured");
  const wallet = args.walletAddress.toLowerCase();

  return conn.transaction(async (trx) => {
    const totals = resultRows(
      await trx.execute(
        sql`insert into sale_wallet_totals
              (wallet_address, contributed_wei, census_index, first_observed_block, refunded)
            values (${wallet}, ${args.contributedWei.toString()}::numeric, ${args.censusIndex},
                    ${args.firstObservedBlock}, ${args.refunded ?? null}::boolean)
            on conflict (wallet_address) do nothing
            returning wallet_address`,
      ),
    );
    // Already recorded on an earlier pass: the census slot is a no-op, and
    // the participant settle below must not touch a row the claim path
    // (which knows the real first block) has already settled.
    if (totals.length === 0) return false;

    // Settle the wallet NOW. If a binding exists on the participant record,
    // it is credited; otherwise it settles as missed.
    await trx.execute(
      sql`insert into sale_participants
            (wallet_address, first_contribution_block, referral_status)
          values (${wallet}, ${args.firstObservedBlock}, 'missed')
          on conflict (wallet_address) do update
            set referral_status = case
                  when sale_participants.first_contribution_block is null then
                    case when sale_participants.referred_by_code is not null then 'credited' else 'missed' end
                  else sale_participants.referral_status end,
                -- BACKFILL only: coalesce keeps the claim path's true block,
                -- which is earlier and exact. Leaving this NULL is what broke
                -- the two consumers that read it as "has this wallet paid":
                -- the bind freeze stayed open for a direct contributor, and
                -- issuePendingReferralCodes never issued them a code.
                first_contribution_block = coalesce(
                  sale_participants.first_contribution_block, excluded.first_contribution_block),
                updated_at = now()`,
    );
    return true;
  });
}

/**
 * The first census index the mirror has NOT recorded.
 *
 * A COUNT was here, used as a start index, which is only the same number while
 * the recorded set is a contiguous prefix. One skipped slot (an unread
 * `contributors(i)`, a write that threw) makes the count step over the hole
 * and the walk never returns to it: that wallet is lost from the mirror
 * permanently, with no repair path. The frontier stops at the hole instead, so
 * the next pass re-reads it.
 */
export async function readCensusFrontier(): Promise<number> {
  const conn = database();
  if (!conn) throw new Error("Database not configured");
  const row = resultRows(
    await conn.execute(
      sql`select coalesce(
            (select min(g)
               from generate_series(0, coalesce((select max(census_index) from sale_wallet_totals), -1)) g
              where not exists (select 1 from sale_wallet_totals t where t.census_index = g)),
            (select coalesce(max(census_index) + 1, 0) from sale_wallet_totals)
          ) as frontier`,
    ),
  )[0];
  return Number(row?.frontier ?? 0);
}

/**
 * Census wallets for the per-cycle totals refresh.
 *
 * `onlyUnrefunded` narrows to rows whose refund flag is still false or unread.
 * On an abandoned sale that is the only set worth re-reading — `claimRefund()`
 * changes neither `totalRaised` nor `contributed(w)`, so the cheap totals
 * comparison is blind to it — and the set shrinks to nothing as people claim.
 */
export async function readKnownCensusWallets(
  opts: { onlyUnrefunded?: boolean } = {},
): Promise<{ walletAddress: string; censusIndex: number }[]> {
  const conn = database();
  if (!conn) throw new Error("Database not configured");
  const rows = resultRows(
    await conn.execute(
      opts.onlyUnrefunded
        ? sql`select wallet_address, census_index from sale_wallet_totals
              where refunded is distinct from true
              order by census_index asc`
        : sql`select wallet_address, census_index from sale_wallet_totals
              order by census_index asc`,
    ),
  );
  return rows.map((r) => ({ walletAddress: String(r.wallet_address), censusIndex: Number(r.census_index) }));
}

/**
 * When the census totals were last refreshed, for the boards' freshness
 * labels. Null — never a zero timestamp — when the read faults or the
 * reconciler has never run.
 */
export async function readMirrorFreshness(): Promise<string | null> {
  const pair = await readMirrorFreshnessPair();
  return pair?.totalsAt ?? null;
}

/**
 * One wallet's contribution answer, in the three states the panel renders.
 *
 * `confirmed` needs no claim: the census row exists exactly when the contract
 * counts the wallet, so a direct contributor with no browser session is
 * still confirmed. `confirming` is a pending claim — the receipt is in (or
 * claimed to be), our verification has not landed. `none` is both "no claim
 * and no census row": the panel must not read it as "never contributed"
 * while the chain's own `contributedOnChain` read says otherwise, which is
 * why the client merges this with its live chain read.
 *
 * `mirrorUpdatedAt` is the newest totals refresh, so a panel can say how
 * fresh the amounts are. Null on a fault — not a zero timestamp.
 */
export type ContributionClaimStates =
  | { contributionState: "confirmed"; mirrorUpdatedAt: string | null }
  | { contributionState: "confirming"; mirrorUpdatedAt: string | null }
  | { contributionState: "none"; mirrorUpdatedAt: string | null };

export async function readContributionClaimStates(
  walletAddress: string,
): Promise<ContributionClaimStates | null> {
  const conn = database();
  if (!conn) return null;
  const wallet = walletAddress.toLowerCase();
  try {
    const row = resultRows(
      await conn.execute(
        sql`select
              exists(select 1 from sale_wallet_totals where wallet_address = ${wallet}) as censused,
              exists(select 1 from sale_contribution_claims
                      where wallet_address = ${wallet} and verdict = 'pending') as pending_claim,
              (select max(updated_at) from sale_wallet_totals) as mirror_updated`,
      ),
    )[0];
    const mirrorUpdatedAt = row?.mirror_updated == null ? null : String(row.mirror_updated);
    if (Boolean(row?.censused)) return { contributionState: "confirmed", mirrorUpdatedAt };
    if (Boolean(row?.pending_claim)) return { contributionState: "confirming", mirrorUpdatedAt };
    return { contributionState: "none", mirrorUpdatedAt };
  } catch {
    return null;
  }
}

/**
 * Re-read `contributed(w)` for every known wallet and store what the
 * contract says NOW. Called when `totalRaised` moved but the census count did
 * not (top-ups), and as a standing refresh so a value here is never stale
 * beyond one reconciler pass.
 *
 * `amounts` is wallet → current total as read this pass. A wallet missing
 * from the map is left untouched: an unread balance is not a zero (§8 #3
 * reads like this have drained a pool to $0 in a different module).
 */
export async function refreshWalletTotals(
  amounts: { walletAddress: string; contributedWei: bigint; refunded?: boolean }[],
): Promise<void> {
  if (amounts.length === 0) return;
  const conn = database();
  if (!conn) throw new Error("Database not configured");

  // The casts are load-bearing: a VALUES list in a FROM has no target column
  // to infer parameter types from, so an uncast boolean arrives as text.
  const values = amounts.map(
    (a) =>
      sql`(${a.walletAddress.toLowerCase()}, ${a.contributedWei.toString()}::numeric, ${a.refunded ?? null}::boolean)`,
  );
  await conn.execute(
    sql`update sale_wallet_totals t
        set contributed_wei = v.wei,
            -- coalesce, not assignment: an unread \`refunded(w)\` is null, and
            -- writing that over a true would un-refund somebody on screen.
            -- Same rule as the amount, which is simply absent when unread.
            refunded = coalesce(v.ref, t.refunded),
            updated_at = now()
        from (values ${sql.join(values, sql`, `)}) as v(wallet, wei, ref)
        where t.wallet_address = v.wallet`,
  );
}

/**
 * The sum of currently mirrored `contributed_wei`. Used to gate refresh passes:
 * when `head.totalRaised` matches this sum, no top-ups occurred and the
 * expensive per-wallet refresh can be skipped.
 */
export async function readMirroredRaisedTotal(): Promise<bigint> {
  const conn = database();
  if (!conn) throw new Error("Database not configured");
  const row = resultRows(
    await conn.execute(sql`select coalesce(sum(contributed_wei), 0) as total from sale_wallet_totals`),
  )[0];
  return bigintFromNumericString(String(row?.total ?? "0"));
}

/* ------------------------------------------------------------------ */
/*  Airdrop snapshot                                                   */
/* ------------------------------------------------------------------ */

export interface SnapshotSubject {
  walletAddress: string;
  contributedWei: bigint;
  referredByWallet: string | null;
  referralStatus: ReferralStatus;
}

/**
 * Everyone the snapshot has to decide about: every wallet that paid.
 *
 * A wallet that applied a code and never contributed is deliberately absent —
 * it is owed nothing by either pool, and listing it as a zero row would put
 * "not eligible" next to people who simply changed their mind.
 *
 * Throws rather than degrading. This list IS the airdrop's population, and a
 * short one silently pays out over a fraction of the sale.
 */
/** Three states. A count we could not take is not a count of zero (§8 #9). */
export type UnsettledRead = { kind: "found"; count: number } | { kind: "unavailable" };

/**
 * Contributors the settle step has not decided about yet.
 *
 * Counts two conditions at once, because a snapshot cannot tell them apart and
 * neither is safe to freeze: a census wallet with no participant row at all
 * (the reconciler recorded the total and failed before settling it), and one
 * whose status is still `none` or `pending`.
 *
 * NOT computed from `readSnapshotPopulation`, whose `coalesce(…, 'missed')`
 * turns a missing participant row into an affirmative "contributed before
 * adding a code" — a gate reading that column would be blind to half of what it
 * exists to catch.
 *
 * Faults rather than returning zero. Zero here licenses a FINAL snapshot, and
 * this is the one run the system will ever mark final.
 */
export async function readUnsettledContributorCount(): Promise<UnsettledRead> {
  const conn = database();
  if (!conn) return { kind: "unavailable" };
  try {
    const rows = resultRows(
      await conn.execute(
        sql`select count(*) as n
            from sale_wallet_totals t
            left join sale_participants p on p.wallet_address = t.wallet_address
            where p.wallet_address is null
               or p.referral_status in ('none', 'pending')`,
      ),
    );
    const n = rows[0]?.n;
    if (n == null) return { kind: "unavailable" };
    return { kind: "found", count: Number(n) };
  } catch {
    return { kind: "unavailable" };
  }
}

/**
 * Everyone the snapshot has to decide about: every wallet the CONTRACT counts
 * as a contributor, with the census amount.
 *
 * A wallet that applied a code and never contributed is deliberately absent —
 * it is owed nothing by either pool, and listing it as a zero row would put
 * "not eligible" next to people who simply changed their mind.
 *
 * `coalesce(p.referral_status, 'missed')` is the same deliberate conservatism
 * as recordCensusEntry: the census cannot say a code was bound in time, and
 * the settle step should have run before the snapshot gates pass anyway —
 * the coalesce is the backstop, not the path.
 */
export async function readSnapshotPopulation(): Promise<SnapshotSubject[]> {
  const conn = database();
  if (!conn) throw new Error("Database not configured");
  const rows = resultRows(
    await conn.execute(
      sql`select t.wallet_address,
                 t.contributed_wei as contributed_wei,
                 p.referred_by_wallet,
                 coalesce(p.referral_status, 'missed') as referral_status
          from sale_wallet_totals t
          left join sale_participants p on p.wallet_address = t.wallet_address
          order by t.wallet_address`,
    ),
  );
  return rows.map((r) => ({
    walletAddress: String(r.wallet_address),
    contributedWei: bigintFromNumericString(String(r.contributed_wei)),
    referredByWallet: r.referred_by_wallet == null ? null : String(r.referred_by_wallet),
    referralStatus: String(r.referral_status) as ReferralStatus,
  }));
}

export interface SnapshotHeader {
  id: string;
  isFinal: boolean;
  finalRequested: boolean;
  /** When this run was taken. Absent on the WRITE path: the column defaults to
   *  now(), and a re-run of the same id is a delete and re-insert, so the
   *  timestamp is the database's answer and never a value a caller supplied. */
  takenAt?: string;
  saleAddress: string;
  saleState: number | null;
  indexedThroughBlock: number;
  /** The contract's own totalRaised, read live. Null when the read faulted;
   *  never our own total standing in for it. */
  totalRaisedWei: bigint | null;
  /** What the mirror sums to. Equal to the above means we missed nothing. */
  mirroredWei: bigint;
  contributorCount: number;
  /** Wallets that applied a code before paying. */
  buyerBonusCount: number;
  qualifiedReferrerCount: number;
  qualifiedReferredWei: bigint;
  /** Tokens the sale is selling, read live. Null when the read faulted; never
   *  SALE_TOKENS standing in for it (§8 #11). */
  tokensForSale: bigint | null;
  /** Totals owed across every row, per leg. Stored by the snapshot so the
   *  payout reconciliation has a second, independently written number to
   *  compare the ledger against. */
  owedBuyerTokens: bigint;
  owedReferrerTokens: bigint;
  owedReferrerWei: bigint;
  rules: Record<string, unknown>;
  notes: string | null;
  blockers: string[];
}

export interface SnapshotRow {
  walletAddress: string;
  contributedWei: bigint;
  referredByWallet: string | null;
  referralStatus: ReferralStatus;
  /** This wallet's own sale allocation, in token base units. */
  saleAllocationTokens: bigint;
  /** Applied a code before paying. Not gated on the referrer qualifying. */
  buyerBonusEligible: boolean;
  buyerBonusTokens: bigint;
  referredCount: number;
  referredWei: bigint;
  /** Summed allocations of the buyers this wallet brought in. */
  referredAllocationTokens: bigint;
  referrerQualified: boolean;
  referrerCommissionTokens: bigint;
  referrerRebateWei: bigint;
  reason: string;
}

function mapSnapshotHeader(r: Record<string, unknown>): SnapshotHeader {
  return {
    id: String(r.id),
    isFinal: Boolean(r.is_final),
    finalRequested: Boolean(r.final_requested),
    saleAddress: String(r.sale_address),
    saleState: r.sale_state === null || r.sale_state === undefined ? null : Number(r.sale_state),
    indexedThroughBlock: Number(r.indexed_through_block),
    totalRaisedWei:
      r.total_raised_wei === null || r.total_raised_wei === undefined
        ? null
        : bigintFromNumericString(String(r.total_raised_wei)),
    mirroredWei: bigintFromNumericString(String(r.mirrored_wei)),
    contributorCount: Number(r.contributor_count),
    buyerBonusCount: Number(r.buyer_bonus_count),
    qualifiedReferrerCount: Number(r.qualified_referrer_count),
    qualifiedReferredWei: bigintFromNumericString(String(r.qualified_referred_wei)),
    tokensForSale:
      r.tokens_for_sale === null || r.tokens_for_sale === undefined
        ? null
        : bigintFromNumericString(String(r.tokens_for_sale)),
    owedBuyerTokens: bigintFromNumericString(String(r.owed_buyer_tokens)),
    owedReferrerTokens: bigintFromNumericString(String(r.owed_referrer_tokens)),
    owedReferrerWei: bigintFromNumericString(String(r.owed_referrer_wei)),
    rules: (r.rules as Record<string, unknown>) ?? {},
    notes: r.notes === null || r.notes === undefined ? null : String(r.notes),
    blockers: Array.isArray(r.blockers) ? (r.blockers as string[]) : [],
    takenAt: r.taken_at === null || r.taken_at === undefined ? undefined : String(r.taken_at),
  };
}

function mapSnapshotRow(r: Record<string, unknown>): SnapshotRow {
  return {
    walletAddress: String(r.wallet_address),
    contributedWei: bigintFromNumericString(String(r.contributed_wei)),
    referredByWallet: r.referred_by_wallet == null ? null : String(r.referred_by_wallet),
    referralStatus: String(r.referral_status) as ReferralStatus,
    saleAllocationTokens: bigintFromNumericString(String(r.sale_allocation_tokens)),
    buyerBonusEligible: Boolean(r.buyer_bonus_eligible),
    buyerBonusTokens: bigintFromNumericString(String(r.buyer_bonus_tokens)),
    referredCount: Number(r.referred_count),
    referredWei: bigintFromNumericString(String(r.referred_wei)),
    referredAllocationTokens: bigintFromNumericString(String(r.referred_allocation_tokens)),
    referrerQualified: Boolean(r.referrer_qualified),
    referrerCommissionTokens: bigintFromNumericString(String(r.referrer_commission_tokens)),
    referrerRebateWei: bigintFromNumericString(String(r.referrer_rebate_wei)),
    reason: String(r.reason),
  };
}

/**
 * Write a snapshot, header and rows together, in one transaction.
 *
 * All-or-nothing on purpose: a header with a partial row set is the exact shape
 * of a conclusion drawn over less than its subject (§9), and it would be
 * indistinguishable from a complete one. Re-running the same id replaces it, so
 * a rehearsal can be repeated until it looks right.
 */
/**
 * Thrown when a run would overwrite a snapshot that is already final.
 *
 * A distinct type so the job route can answer 409 with the reason instead of a
 * generic 500 — the operator needs to know their re-run was refused, not that
 * something broke.
 */
export class SnapshotIsFinalError extends Error {
  constructor(id: string) {
    super(`Snapshot "${id}" is already final and cannot be replaced.`);
    this.name = "SnapshotIsFinalError";
  }
}

export async function writeAirdropSnapshot(header: SnapshotHeader, rows: SnapshotRow[]): Promise<void> {
  const conn = database();
  if (!conn) throw new Error("Database not configured");

  await conn.transaction(async (tx) => {
    // The unique partial index guarantees only one row IS final. It does not
    // protect the one that is: the delete below would take it, and the foreign
    // key cascade would take every snapshot row and draw result under it. A
    // rehearsal re-run with the same id would then land silently in its place,
    // 200, and the frozen list would be gone.
    //
    // `for update` because two runs of the same id are otherwise a race that
    // ends the same way.
    const existing = resultRows(
      await tx.execute(sql`select is_final from sale_airdrop_snapshots where id = ${header.id} for update`),
    );
    if (existing[0]?.is_final === true) throw new SnapshotIsFinalError(header.id);

    await tx.execute(sql`delete from sale_airdrop_snapshots where id = ${header.id}`);
    await tx.execute(
      sql`insert into sale_airdrop_snapshots
            (id, is_final, final_requested, sale_address, sale_state, indexed_through_block,
             total_raised_wei, tokens_for_sale, mirrored_wei, contributor_count, buyer_bonus_count,
             qualified_referrer_count, qualified_referred_wei,
             owed_buyer_tokens, owed_referrer_tokens, owed_referrer_wei, rules, notes, blockers)
          values (${header.id}, ${header.isFinal}, ${header.finalRequested}, ${header.saleAddress.toLowerCase()}, ${header.saleState},
                  ${header.indexedThroughBlock},
                  ${header.totalRaisedWei === null ? null : header.totalRaisedWei.toString()}::numeric,
                  ${header.tokensForSale === null ? null : header.tokensForSale.toString()}::numeric,
                  ${header.mirroredWei.toString()}::numeric,
                  ${header.contributorCount},
                  ${header.buyerBonusCount}, ${header.qualifiedReferrerCount},
                  ${header.qualifiedReferredWei.toString()}::numeric,
                  ${header.owedBuyerTokens.toString()}::numeric,
                  ${header.owedReferrerTokens.toString()}::numeric,
                  ${header.owedReferrerWei.toString()}::numeric,
                  ${JSON.stringify(header.rules)}::jsonb, ${header.notes},
                  ${JSON.stringify(header.blockers)}::jsonb)`,
    );

    // Chunked: one statement per 500 rows keeps the parameter count well inside
    // any driver's limit without needing to know what that limit is.
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const values = chunk.map(
        (r) =>
          sql`(${header.id}, ${r.walletAddress.toLowerCase()}, ${r.contributedWei.toString()}::numeric,
               ${r.referredByWallet}, ${r.referralStatus},
               ${r.saleAllocationTokens.toString()}::numeric, ${r.buyerBonusEligible},
               ${r.buyerBonusTokens.toString()}::numeric, ${r.referredCount},
               ${r.referredWei.toString()}::numeric, ${r.referredAllocationTokens.toString()}::numeric,
               ${r.referrerQualified}, ${r.referrerCommissionTokens.toString()}::numeric,
               ${r.referrerRebateWei.toString()}::numeric, ${r.reason})`,
      );
      await tx.execute(
        sql`insert into sale_airdrop_snapshot_rows
              (snapshot_id, wallet_address, contributed_wei, referred_by_wallet, referral_status,
               sale_allocation_tokens, buyer_bonus_eligible, buyer_bonus_tokens, referred_count,
               referred_wei, referred_allocation_tokens, referrer_qualified,
               referrer_commission_tokens, referrer_rebate_wei, reason)
            values ${sql.join(values, sql`, `)}`,
      );
    }
  });
}

/**
 * One wallet's row in the FINAL snapshot: the "why did I get this?" answer.
 *
 * Only a final run answers questions: a rehearsal is the operator's draft, and
 * handing wallets rows from a draft would publish conclusions the gates had
 * not yet cleared.
 *
 * THREE states, not two (§8 #9). `absent` covers two facts the caller must
 * distinguish from each other — no final snapshot at all, or the wallet is not
 * in the one that exists — so the header is read separately. A fault is its own
 * state: collapsing it into `absent` would tell a wallet a final snapshot
 * exists and excludes them, on the strength of a dead database.
 */
export type FinalSnapshotRead =
  | { kind: "found"; row: SnapshotRow }
  | { kind: "absent"; snapshotFinal: boolean }
  | { kind: "unavailable" };

export async function readFinalSnapshotRow(walletAddress: string): Promise<FinalSnapshotRead> {
  const conn = database();
  if (!conn) return { kind: "unavailable" };
  try {
    const r = resultRows(
      await conn.execute(
        sql`select row.wallet_address, row.contributed_wei, row.referred_by_wallet, row.referral_status,
                   row.sale_allocation_tokens, row.buyer_bonus_eligible, row.buyer_bonus_tokens,
                   row.referred_count, row.referred_wei, row.referred_allocation_tokens,
                   row.referrer_qualified, row.referrer_commission_tokens,
                   row.referrer_rebate_wei, row.reason
            from sale_airdrop_snapshot_rows row
            join sale_airdrop_snapshots hdr on hdr.id = row.snapshot_id
            where hdr.is_final and row.wallet_address = ${walletAddress.toLowerCase()}`,
      ),
    )[0];
    if (r) {
      return {
        kind: "found",
        row: mapSnapshotRow(r),
      };
    }
    // No row. Measure the header rather than asserting it: with no final
    // snapshot, `snapshotFinal` must say so, not claim one exists.
    const hdr = resultRows(
      await conn.execute(sql`select exists(select 1 from sale_airdrop_snapshots where is_final) as any_final`),
    )[0];
    return { kind: "absent", snapshotFinal: Boolean(hdr?.any_final) };
  } catch {
    return { kind: "unavailable" };
  }
}

export type SnapshotListRead =
  | { kind: "found"; runs: SnapshotHeader[] }
  | { kind: "unavailable" };

/** Every snapshot run, newest first. Headers only. */
export async function readSnapshotHeaders(limit = 50): Promise<SnapshotListRead> {
  const conn = database();
  if (!conn) return { kind: "unavailable" };
  try {
    const rows = resultRows(
      await conn.execute(
        sql`select id, taken_at, is_final, final_requested, sale_address, sale_state,
                   indexed_through_block, total_raised_wei, mirrored_wei,
                   tokens_for_sale, contributor_count, buyer_bonus_count, qualified_referrer_count,
                   qualified_referred_wei, owed_buyer_tokens, owed_referrer_tokens,
                   owed_referrer_wei, rules, notes, blockers
            from sale_airdrop_snapshots
            order by taken_at desc
            limit ${Math.max(1, limit)}`,
      ),
    );
    return { kind: "found", runs: rows.map(mapSnapshotHeader) };
  } catch {
    return { kind: "unavailable" };
  }
}

export type SnapshotRowsRead =
  | { kind: "found"; header: SnapshotHeader; rows: SnapshotRow[] }
  | { kind: "absent" }
  | { kind: "unavailable" };

/** One run in full: its header and every row under it, ordered by wallet.
 *  Uncapped on purpose. This is the payout list, and a truncated one pays a
 *  fraction of the sale. */
export async function readSnapshotById(id: string): Promise<SnapshotRowsRead> {
  const conn = database();
  if (!conn) return { kind: "unavailable" };
  try {
    const headerRow = resultRows(
      await conn.execute(
        sql`select id, taken_at, is_final, final_requested, sale_address, sale_state,
                   indexed_through_block, total_raised_wei, mirrored_wei,
                   tokens_for_sale, contributor_count, buyer_bonus_count, qualified_referrer_count,
                   qualified_referred_wei, owed_buyer_tokens, owed_referrer_tokens,
                   owed_referrer_wei, rules, notes, blockers
            from sale_airdrop_snapshots
            where id = ${id}`,
      ),
    )[0];
    if (!headerRow) return { kind: "absent" };

    const rows = resultRows(
      await conn.execute(
        sql`select wallet_address, contributed_wei, referred_by_wallet, referral_status,
                   sale_allocation_tokens, buyer_bonus_eligible, buyer_bonus_tokens,
                   referred_count, referred_wei, referred_allocation_tokens,
                   referrer_qualified, referrer_commission_tokens, referrer_rebate_wei, reason
            from sale_airdrop_snapshot_rows
            where snapshot_id = ${id}
            order by wallet_address asc`,
      ),
    );
    return {
      kind: "found",
      header: mapSnapshotHeader(headerRow),
      rows: rows.map(mapSnapshotRow),
    };
  } catch {
    return { kind: "unavailable" };
  }
}
