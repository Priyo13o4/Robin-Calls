// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import type { rpc } from "../rpc/client";

import {
  launchFactoryDevBuyEvent as LAUNCH_FACTORY_DEV_BUY_EVENT,
  launchFactoryTokenLaunchedEvent as LAUNCH_FACTORY_TOKEN_LAUNCHED_EVENT,
} from "../rpc/abis";

export type LaunchInsiderBuyStatus =
  | "insider-buy"
  | "no-insider-buy"
  | "not-launched-via-tracked-factory"
  | "unreadable";

export interface LaunchInsiderBuyPrimitives {
  /** A `TokenLaunched` log for this token was found at a registered factory. */
  launchFound: boolean;
  /** The factory that emitted it, when found. */
  factory: string | null;
  creator: string | null;
  /** Non-null only when a `DevBuy` for this token shares the launch tx hash. */
  devBuyEthIn: string | null;
  devBuyTokensOut: string | null;
  /**
   * True when the launch WAS found but the DevBuy query itself faulted (a
   * transient RPC failure). Never collapsed into `devBuyEthIn === null` — that
   * reads as a proven negative (§4), and this is the opposite: we simply could
   * not check. Checked BEFORE the null branch below.
   */
  devBuyReadFaulted: boolean;
  /**
   * The `TokenLaunched` query itself faulted for at least one registered
   * factory, so "no launch found" may just be a transport failure. Optional so
   * every primitives literal written before this field stays valid; absent
   * reads as `false`, which is the pre-existing behaviour for a genuinely
   * clean read.
   */
  launchReadFaulted?: boolean;
}

export interface LaunchInsiderBuyResult {
  status: LaunchInsiderBuyStatus;
  factory: string | null;
  creator: string | null;
  ethIn: string | null;
  tokensOut: string | null;
}

export const UNREADABLE: LaunchInsiderBuyResult = {} as any;

export function classifyLaunchInsiderBuy(p: LaunchInsiderBuyPrimitives): LaunchInsiderBuyResult {
  throw new NotImplementedInPublicBuild("lib/dex/launch-insider-buy.ts#classifyLaunchInsiderBuy");
}

export async function readLaunchInsiderBuy(client: ReturnType<typeof rpc>, token: `0x${string}`, factories: readonly string[]): Promise<LaunchInsiderBuyResult> {
  throw new NotImplementedInPublicBuild("lib/dex/launch-insider-buy.ts#readLaunchInsiderBuy");
}