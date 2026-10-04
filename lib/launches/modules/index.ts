// This module is not included in this repository.
// Exports and types are kept so the app compiles.

import { NotImplementedInPublicBuild } from "@/lib/public-build";



import type { LauncherFamily, LauncherModule } from "../types";

import { cashcatV1Module } from "./cashcat-v1";

import { curveEventsV1Module } from "./curve-events-v1";

import { directDexModule } from "./direct-dex";

import { dopplerMulticurveModule } from "./doppler-multicurve";

import { flapV1Module } from "./flap-v1";

import { pairV5Module } from "./pair-v5";

import { partyV1Module } from "./party-v1";

import { ponsV1Module } from "./pons-v1";

import { ponsV2Module } from "./pons-v2";

import { v4PoolsModule } from "./v4-pools";

export const LAUNCHER_MODULES: Record<LauncherFamily, LauncherModule> = {} as any;

export const STATIC_FAMILIES: readonly LauncherFamily[] = [] as any;