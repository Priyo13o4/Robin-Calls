import { formatEther } from "viem";
import { COMMISSION_BPS, DEFAULT_REFERRAL_RULES } from "@/lib/referrals/rules";

const REFERRER_PCT = COMMISSION_BPS.referrerTokens / 100;
const REFERRER_ETH_PCT = COMMISSION_BPS.referrerEth / 100;
const REFERRED_BUYER_PCT = COMMISSION_BPS.buyerBonus / 100;
const MIN_REFERRED_WALLETS = DEFAULT_REFERRAL_RULES.minReferredWallets;
const MIN_REFERRED_ETH = formatEther(DEFAULT_REFERRAL_RULES.minReferredWei);

export type FaqGroup = "sale" | "referral" | "custody";

export interface FaqItem {
  q: string;
  a: string;
  group: FaqGroup;
}

// Canonical FAQ copy consumed by SalePageClient, SaleTeaser, and FAQPage JSON-LD.
export const SALE_FAQ: ReadonlyArray<FaqItem> = [
  {
    group: "sale",
    q: "When do I find out my price?",
    a: "At the close. The sale has no fixed price while it runs. Your share of the ETH raised is your share of the token pool, so two people who paid the same paid the same. Buying in the first minute and buying in the last gets you the same price.",
  },
  {
    group: "sale",
    q: "Is there a deadline to claim?",
    a: "Yes, and it is the one date on this page worth writing down. Sixty days after the sale closes, the owner can burn whatever is still sitting in the contract unclaimed. That is a real burn: the tokens are destroyed and the total supply falls. Nobody takes them, and they cannot be handed to somebody else. Before that date your allocation is yours and nothing expires. The clock is unconditional, so do not wait for it.",
  },
  {
    group: "sale",
    q: "Can I add more ETH later?",
    a: "Yes. Each contribution adds to the same tally. Your position is one accumulated number, not separate entries.",
  },
  {
    group: "referral",
    q: "What do I get for using someone's code?",
    a: `${REFERRED_BUYER_PCT}% more tokens than you bought. If your ETH works out to 1,000 tokens at the close, you get 1,020. It scales with what you put in, and it does not depend on how many other people used a code. Using a code costs you nothing: you still buy at the same pro-rata price as everybody else.`,
  },
  {
    group: "referral",
    q: "When do I have to add the code?",
    a: "Before your first contribution. Applying a code asks your wallet for a signature, which is free and moves nothing. Once your money is on chain the code field closes for good: we refuse a code after the first contribution rather than accepting one and scoring it later. A code added afterwards does nothing, and there is no appeal, because the sale contract itself has no idea referrals exist.",
  },
  {
    group: "referral",
    q: "What do I earn for referring people?",
    a: `Two commissions on what your people actually bought. You get ${REFERRER_PCT}% of the tokens they receive, and ${REFERRER_ETH_PCT}% of the ETH they put in. There is no shared pool, so nobody else's referrals change your number. To qualify, currently at least ${MIN_REFERRED_WALLETS} people must have used your code before their own first contribution, and they must have put in at least ${MIN_REFERRED_ETH} ETH between them. Your own contribution does not count toward that. Both thresholds are operator settings and can move before the close; whatever they are when the final snapshot runs is stored with it.`,
  },
  {
    group: "referral",
    q: "Is this a pyramid?",
    a: "No. Credit goes exactly one step up. If C uses B's code, C's money counts for B and stops there. It does not also count for A. There is no second level and no downline.",
  },
  {
    group: "referral",
    q: "Does my bonus depend on the person whose code I used?",
    a: `No. You earn the ${REFERRED_BUYER_PCT}% for adding a code before you paid, and that is the whole test. Whether they go on to qualify for their own commission is their business and it does not change your number.`,
  },
  {
    group: "referral",
    q: "When do referral rewards actually pay out?",
    a: "After the close. Buyers are paid their bonus in tokens. Referrers are paid in tokens and in ETH. Eligibility is worked out once at the close and frozen into a snapshot, and that snapshot is only allowed to be final when our records add up to exactly the contract's own total. If the two disagree we are missing something, and the snapshot is refused rather than published.",
  },
  {
    group: "custody",
    q: "Who can touch the raised ETH?",
    a: "Nobody, until the owner closes the sale. It is held by the sale contract, and the RAISED number on this page is that contract's own balance, read live. You do not have to take our word for it: the address is on this page and the balance is on the explorer.",
  },
  {
    group: "custody",
    q: "What if the sale is abandoned?",
    a: "Every wei goes back to whoever sent it, by claim. The refund button appears on this page and the contract holds the funds until you pull them. Nothing expires.",
  },
  {
    group: "custody",
    q: "Why are tokens claimed instead of sent to me?",
    a: "Because a push can fail. A transfer loop that runs out of gas strands whoever it was on when it died. Claiming yourself means your allocation cannot be lost inside somebody else's failed transaction. The owner may also push tokens out in batches as a convenience, but do not wait for it: claim within 60 days of the close, because anything unclaimed after that can be burned.",
  },
  {
    group: "custody",
    q: "What stops the team dumping on me?",
    a: "The schedule, and you can read all of it on the tokenomics page. Team and contributors hold 5% of supply behind a 6-month cliff, then linear to month 24, with nothing at all at launch. Treasury is another 5% behind a 3-month cliff on the same curve. Dev and ecosystem is 15%, of which 10% of that row unlocks at launch. Nothing about that is enforced by this sale contract, so treat it as a published commitment you can check against the chain later, not as a lock that already exists.",
  },
  {
    group: "custody",
    q: "Where does the raised ETH go at the close?",
    a: "80% of it seeds the liquidity pool alongside 20% of the token supply. The remaining 20% is proceeds. A lock on that pool position is planned and is not on chain yet, and the tokenomics page carries the same warning. That is the single largest open risk in this launch and it is better that you hear it here.",
  },
];
