import { NoirShell } from "@/app/components/site/NoirShell";
import { SkeletonTradePage } from "@/app/components/site/Skeleton";

export default function TradeIndexLoading() {
  return (
    <NoirShell showFooter={false}>
      <SkeletonTradePage />
    </NoirShell>
  );
}
