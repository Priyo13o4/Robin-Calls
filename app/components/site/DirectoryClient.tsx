"use client";

import { EcosystemNetflixClient } from "./EcosystemNetflixClient";

/**
 * Re-export EcosystemNetflixClient as DirectoryClient for backward compatibility.
 */
export const DirectoryClient = EcosystemNetflixClient;
export default EcosystemNetflixClient;
