/**
 * The PinkLock vesting locks behind VESTING's four locked rows, as created on
 * chain 2026-09-29 (contracts/README.md holds the same table). Terms are
 * static on purpose: PinkLock's editLock can only add tokens or move a date
 * LATER, so a stored term can go stale only toward "more locked", never less.
 */
export const PINKLOCK_ADDRESS = "0xbe0b139abc90723af76a89d3051f60ba1b64c8d9";

export const PINKSALE_LOGO_URL = "https://www.pinksale.finance/logo192.png";

export const pinklockRecordUrl = (lockId: number) =>
  `https://www.pinksale.finance/pinklock/robinhood/record/${lockId}`;

export interface VestingLock {
  lockId: number;
  /** Tokens in this lock (whole ROBINCALLS). */
  amount: number;
  /** Lock owner: the only wallet that can claim released tokens. */
  claimWallet: string;
  firstUnlock: string;
  release: string;
  fullyUnlocked: string;
}

export interface VestingLockGroup {
  /** A TOKENOMICS label; pinned against the split in tests/sale-projection.test.ts. */
  label: string;
  locks: VestingLock[];
  /** Part of the allocation deliberately outside PinkLock. */
  unlockedOutside?: { amount: number; wallet: string; why: string };
}

const TEAM_WALLET = "0xae05be602f7332b4560a9ca2a1fd4a484b40ac7d";
const TREASURY_WALLET = "0x596bf66512785daf78604d844c21b5b6dccb2310";
const DEV_WALLET = "0xc83f82ebae1f01f0fc7f52b39c97df7077f28bbf";
const REWARDS_WALLET = "0x4e204b84c065b4d856036242b115ca61abfc9c96";

export const VESTING_LOCKS: VestingLockGroup[] = [
  {
    label: "TEAM & CONTRIBUTORS",
    locks: [
      { lockId: 1001282, amount: 500_000, claimWallet: TEAM_WALLET, firstUnlock: "2027-04-01", release: "5% every 29 days", fullyUnlocked: "2028-10-03" },
    ],
  },
  {
    label: "TREASURY",
    locks: [
      { lockId: 1001284, amount: 500_000, claimWallet: TREASURY_WALLET, firstUnlock: "2027-01-01", release: "5% every 33 days", fullyUnlocked: "2028-09-19" },
    ],
  },
  {
    label: "DEV & ECOSYSTEM",
    locks: [
      { lockId: 1001285, amount: 1_350_000, claimWallet: DEV_WALLET, firstUnlock: "2027-01-01", release: "5% every 33 days", fullyUnlocked: "2028-09-19" },
    ],
    unlockedOutside: { amount: 150_000, wallet: DEV_WALLET, why: "the 10% released at TGE" },
  },
  {
    label: "PLATFORM REWARD",
    locks: [
      { lockId: 1001286, amount: 375_000, claimWallet: REWARDS_WALLET, firstUnlock: "2026-10-01", release: "50% at TGE, 50% at M3", fullyUnlocked: "2027-01-01" },
      { lockId: 1001287, amount: 1_125_000, claimWallet: REWARDS_WALLET, firstUnlock: "2027-10-01", release: "a third at M12, M18 and M24", fullyUnlocked: "2028-10-01" },
    ],
  },
];
