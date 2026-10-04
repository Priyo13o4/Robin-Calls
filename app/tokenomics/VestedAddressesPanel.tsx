import { cdnUrl } from "@/lib/config/cdn";
import { SectionHead } from "./SectionHead";
import { explorerWebUrl } from "@/lib/config/chain";
import {
  PINKLOCK_ADDRESS,
  PINKSALE_LOGO_URL,
  VESTING_LOCKS,
  pinklockRecordUrl,
  type VestingLock,
} from "@/lib/sale/vesting-locks";

const MASKED_ADDRESS = "0x" + "•".repeat(38);

const fmt = (n: number) => n.toLocaleString("en-US");

// Hotlinked from PinkSale's own site, not copied into /public; allowed in
// nginx's CSP img-src. A dead link shows an empty 16px slot, nothing else.
function PinkSaleIcon() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={PINKSALE_LOGO_URL} alt="" aria-hidden width={16} height={16} loading="lazy" className="h-4 w-4 flex-none rounded-full" />
  );
}

function ExternalIcon() {
  return (
    <svg aria-hidden viewBox="0 0 12 12" className="h-2.5 w-2.5 flex-none" fill="none">
      <path d="M4.5 2H10v5.5M10 2 3 9" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function AddressRow({ label, address }: { label: string; address: string }) {
  return (
    <div className="mt-2 min-w-0">
      <p className="font-mono text-[11px] tracking-[0.16em] text-[#ccff00]/70">{label}</p>
      <a
        href={`${explorerWebUrl}/address/${address}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-0.5 flex min-w-0 items-center gap-1.5 font-mono text-[14.5px] font-medium tracking-[0.04em] text-white transition-colors hover:text-[#ccff00]"
      >
        <span className="min-w-0 truncate">{address}</span>
        <ExternalIcon />
      </a>
    </div>
  );
}

function LockBlock({ lock }: { lock: VestingLock }) {
  return (
    <div className="mt-3 border-t border-[#2a2a2a] pt-3 first:mt-2 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <a
          href={pinklockRecordUrl(lock.lockId)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 font-mono text-[13px] font-bold tracking-[0.1em] text-[#f95997] transition-colors hover:text-[#ffa3c4]"
        >
          <PinkSaleIcon />
          PINKLOCK #{lock.lockId}
          <ExternalIcon />
        </a>
        <span className="font-mono text-[14.5px] font-bold tabular-nums text-white">
          {fmt(lock.amount)} ROBINCALLS
        </span>
      </div>
      <p className="mt-1.5 text-[14.5px] leading-relaxed text-[#8a8a8a]">
        First unlock {lock.firstUnlock}, {lock.release}. Fully unlocked {lock.fullyUnlocked}.
      </p>
      <AddressRow label="CLAIM WALLET · RECEIVES UNLOCKED TOKENS" address={lock.claimWallet} />
    </div>
  );
}

/**
 * Sits below §3/§4: one card per locked allocation, read from
 * lib/sale/vesting-locks.ts. The LP lock is the one entry still pending; it
 * keeps the masked placeholder until the pool exists.
 */
export function VestedAddressesPanel() {
  return (
    <section id="locks" className="scroll-mt-24">
      <SectionHead
        n="05"
        title="VESTING & LP LOCK CONTRACTS"
        sub="EVERY VESTED ALLOCATION IS LOCKED ON PINKLOCK"
      />
      <div
        className="relative overflow-hidden rounded-2xl border border-[#2a2a2a] p-[26px] sm:p-[42px]"
        style={{
          backgroundImage: `linear-gradient(180deg, rgba(10,10,10,0.85) 0%, rgba(10,10,10,0.78) 100%), url(${cdnUrl("/backgrounds/vesting-card-bg.webp")})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
      <p className="max-w-2xl text-[17px] leading-[1.618] text-[#c9c9c3]">
        Open a lock to check it on PinkSale, or an address to check it on the explorer.
        A lock can be extended, never shortened.
      </p>
      <div className="mt-[16px] min-w-0 max-w-xl">
        <AddressRow label="LOCK CONTRACT · PINKLOCK V2" address={PINKLOCK_ADDRESS} />
      </div>
      <div className="mt-[26px] grid gap-[16px] sm:grid-cols-2">
        {VESTING_LOCKS.map((group) => (
          // min-w-0: a grid item's default `min-width:auto` sizes to the
          // nowrap address, so without it the card overflows its track.
          <div
            key={group.label}
            className="tk-card min-w-0 p-[16px]"
          >
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 truncate font-mono text-[15.5px] font-bold tracking-[0.1em] text-white lg:text-[19px]">
                {group.label} VESTING
              </span>
              <span className="flex-none whitespace-nowrap rounded-full border border-[#3d5c1f] bg-[#141c0c] px-2.5 py-1 font-mono text-[11px] font-bold tracking-[0.16em] text-[#ccff00]">
                LOCKED
              </span>
            </div>
            {group.locks.map((lock) => (
              <LockBlock key={lock.lockId} lock={lock} />
            ))}
            {group.unlockedOutside && (
              <p className="mt-3 border-t border-[#2a2a2a] pt-3 text-[14.5px] leading-relaxed text-[#8a8a8a]">
                Plus {fmt(group.unlockedOutside.amount)} ROBINCALLS outside the lock:{" "}
                {group.unlockedOutside.why}, held by the claim wallet above.
              </p>
            )}
          </div>
        ))}

        <div className="tk-card min-w-0 p-[16px]">
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate font-mono text-[15.5px] font-bold tracking-[0.1em] text-white lg:text-[19px]">
              LP POSITION LOCK
            </span>
            <span className="flex-none whitespace-nowrap rounded-full border border-[#3a3320] bg-[#1c1810] px-2.5 py-1 font-mono text-[11px] font-bold tracking-[0.16em] text-[#d9c96a]">
              TO BE DEPLOYED
            </span>
          </div>
          <span
            aria-hidden
            className="mt-2 block select-none truncate font-mono text-[13px] tracking-[0.08em] text-[#6a6a6a] [filter:blur(3px)]"
          >
            {MASKED_ADDRESS}
          </span>
        </div>
      </div>
      </div>
    </section>
  );
}
