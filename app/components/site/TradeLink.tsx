import Link from "next/link";
import { tradeWarning, type VerdictSignal } from "@/lib/swap/ui-state";

export interface TradeLinkProps {
  token: string;
  signal: VerdictSignal;
  variant: "card" | "inline";
}

// Presentational trade link with a paired warning line according to the signal.
export function TradeLink({ token, signal, variant }: TradeLinkProps) {
  const warning = tradeWarning(signal);
  const href = `/trade/${token.toLowerCase()}`;

  const warningLine = warning.sentence ? (
    <span
      className={`font-mono text-[10px] leading-tight ${
        warning.level === "danger" ? "text-[#e0897a]" : "text-[#d9c96a]"
      }`}
    >
      {warning.sentence}
    </span>
  ) : null;

  if (variant === "card") {
    return (
      <div className="flex flex-col gap-1 text-center">
        <Link
          href={href}
          className="brutalist-box brutalist-pressable brutalist-shadow-dark inline-flex items-center justify-center gap-1.5 border-[#0a0a0a] bg-[#ededea] py-2.5 text-center font-cinzel text-[11px] font-bold tracking-[0.18em] text-[#0a0a0a]"
        >
          TRADE
        </Link>
        {warningLine}
      </div>
    );
  }

  return (
    <div className="mx-auto -mt-2 mb-6 flex max-w-6xl flex-col items-center justify-center gap-1 px-4 text-center font-mono text-[11px] tracking-[0.14em] text-[#8a8a8a] sm:px-6">
      <Link href={href} className="underline hover:text-[#ededea]">
        Trade
      </Link>
      {warningLine}
    </div>
  );
}
