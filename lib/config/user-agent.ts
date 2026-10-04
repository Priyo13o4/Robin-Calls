/**
 * The one User-Agent every outbound RobinCalls request carries.
 *
 * Not cosmetic and not politeness: Cloudflare fronts the community Blockscout
 * instance (`robinhoodchain.blockscout.com`, our verified-source fallback) and
 * **403s any request whose UA is not in the `Mozilla/5.0 (compatible; …)`
 * shape.** Sending none at all — undici's default — is a 403, which is how the
 * fallback silently stopped answering (KNOWN-PROBLEMS L95).
 *
 * Probed 2026-09-03 against that host:
 *   this string                          -> 200
 *   full Chrome UA                       -> 200
 *   "RobinCalls/1.0"                     -> 403
 *   bare "Mozilla/5.0"                   -> 403
 *   no User-Agent header                 -> 403
 *
 * So it stays HONEST — we self-identify and give a contact URL — because that
 * already passes. Do not swap it for a copied browser UA: impersonation buys
 * nothing here and breaks the operator's ability to identify our traffic.
 */
export const OUTBOUND_USER_AGENT =
  "Mozilla/5.0 (compatible; RobinCalls-Bot/1.0; +https://robincalls.com)";
