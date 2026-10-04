// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { createPublicClient, custom, http, type PublicClient } from "viem";

import { robinhoodChain } from "../config/chain";

import { poolRequest } from "../rpc/provider-pool";

import { forkModeRequested, readForkEnv } from "./fork-mode";

export function swapClient(): PublicClient {
  throw new NotImplementedInPublicBuild("lib/swap/read-client.ts#swapClient");
}