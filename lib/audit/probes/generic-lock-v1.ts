// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import { parseAbi, toFunctionSelector } from "viem";

import { auditCallKey, type AuditReadContext } from "../read-context";

import type { ProbeAdapter, ProbeAdapterMatchArgs, ProbeResult } from "../types";

interface AbiFunctionLike {
  type?: string;
  name?: string;
  inputs?: { type?: string }[];
}

export const genericLockV1Adapter: ProbeAdapter = {} as any;