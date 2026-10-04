import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const modernTradingCardPath = join(import.meta.dirname, "../app/components/trade/ModernTradingCard.tsx");
const useTokenBalancesPath = join(import.meta.dirname, "../lib/trade/useTokenBalances.ts");

const modernTradingCardSource = readFileSync(modernTradingCardPath, "utf8");
const useTokenBalancesSource = readFileSync(useTokenBalancesPath, "utf8");

test("ModernTradingCard reads connection from useWallet alone", () => {
  // useWallet is built on wagmi's useAccount; reading both OR-ed the same store twice.
  assert.doesNotMatch(modernTradingCardSource, /\buseAccount\(/, "one source of truth: useWallet");
});

test("ModernTradingCard derives activePayToken and activeReceiveToken directly from chainTokens", () => {
  assert.match(
    modernTradingCardSource,
    /const\s+activePayToken\s*=\s*useMemo<SelectableToken>\s*\(\s*\(\)\s*=>/,
    "activePayToken must be derived with useMemo directly from chainTokens to prevent caching desync"
  );
  assert.match(
    modernTradingCardSource,
    /const\s+activeReceiveToken\s*=\s*useMemo<SelectableToken>\s*\(\s*\(\)\s*=>/,
    "activeReceiveToken must be derived with useMemo directly from chainTokens"
  );
});

test("ModernTradingCard synchronization effect responds to reconnects and account changes", () => {
  assert.match(
    modernTradingCardSource,
    /\},\s*\[chainTokens,\s*wallet\.address,\s*wallet\.isConnected\]\);/,
    "Synchronization effect must depend on [chainTokens, wallet.address, wallet.isConnected]"
  );
});

test("ModernTradingCard Pay Row balance display uses activePayToken and checks connection", () => {
  assert.ok(
    modernTradingCardSource.includes("!wallet.isConnected || !connectedWalletAddress"),
    "Pay Row balance check must require a connected wallet and address"
  );
  assert.ok(
    modernTradingCardSource.includes("activePayToken.balanceStatus === \"loading\""),
    "Pay Row balance must check activePayToken.balanceStatus"
  );
  assert.ok(
    /formatBaseUnits\(activePayToken\.rawBalance(?: as bigint)?, activePayToken\.decimals, 4\)/.test(modernTradingCardSource),
    "Pay Row balance must format activePayToken.rawBalance"
  );
});

test("useTokenBalances does not collapse pending reads into error", () => {
  assert.match(
    useTokenBalancesSource,
    /isItemPending\s*=\s*t\.isNative/,
    "useTokenBalances must track pending items explicitly"
  );
  assert.match(
    useTokenBalancesSource,
    /isEthPending/,
    "useTokenBalances must observe isEthPending from useBalance"
  );
  assert.match(
    useTokenBalancesSource,
    /isErc20Pending/,
    "useTokenBalances must observe isErc20Pending from useReadContracts"
  );
});

test("useTokenBalances invalidates queryClient cache on account change and explicit refetch", () => {
  assert.ok(
    useTokenBalancesSource.includes("useQueryClient"),
    "useTokenBalances must import and call useQueryClient"
  );
  assert.ok(
    useTokenBalancesSource.includes("queryClient.invalidateQueries({ queryKey: [\"balance\"] })"),
    "useTokenBalances must invalidate balance query cache"
  );
  assert.ok(
    useTokenBalancesSource.includes("queryClient.invalidateQueries({ queryKey: [\"readContracts\"] })"),
    "useTokenBalances must invalidate readContracts query cache"
  );
});

test("useTokenBalances includes resilient direct viem client fallback", () => {
  assert.ok(
    useTokenBalancesSource.includes("robinhoodPublicClient.getBalance"),
    "useTokenBalances must include direct public client fallback for ETH balance"
  );
  assert.ok(
    useTokenBalancesSource.includes("robinhoodPublicClient.multicall"),
    "useTokenBalances must include direct public client fallback for ERC20 multicall"
  );
});

test("ModernTradingCard adopts SalePageClient wallet connection pattern", () => {
  assert.ok(
    modernTradingCardSource.includes("onMouseEnter={wallet.prepare}"),
    "ModernTradingCard must pre-warm AppKit via wallet.prepare on hover"
  );
  assert.ok(
    !modernTradingCardSource.includes('setErrorMsg("Wallet connection was not completed.")'),
    "ModernTradingCard must not prematurely set 'Wallet connection was not completed.' while wallet extension opens"
  );
  assert.ok(
    modernTradingCardSource.includes("void refetchDirectBalance()"),
    "ModernTradingCard must trigger direct balance refresh when wallet connects"
  );
});

test("useTokenBalances uses fallback transport and accepts overrideAddress", () => {
  assert.ok(
    useTokenBalancesSource.includes("fallback("),
    "useTokenBalances robinhoodPublicClient must configure fallback transport"
  );
  assert.ok(
    useTokenBalancesSource.includes("overrideAddress?: string"),
    "useTokenBalances signature must accept overrideAddress"
  );
  assert.ok(
    modernTradingCardSource.includes("useTokenBalances(availableTokens, effectiveAddress)"),
    "ModernTradingCard must supply effectiveAddress to useTokenBalances"
  );
});

test("ModernTradingCard includes dedicated direct pay token balance fallbacks", () => {
  assert.ok(
    modernTradingCardSource.includes("directErc20PayBalance"),
    "ModernTradingCard must have dedicated directErc20PayBalance single-token fallback"
  );
  assert.ok(
    modernTradingCardSource.includes("directNativeFallback"),
    "ModernTradingCard must have directNativeFallback for native ETH"
  );
  assert.ok(
    modernTradingCardSource.includes('activePayToken.balanceStatus === "error"'),
    "ModernTradingCard must differentiate balanceStatus error from loading"
  );
});
