import { createHash, randomBytes } from "node:crypto";
import {
  X_OAUTH,
  xClientId,
  xClientSecret,
  xScopes,
  xRedirectUri,
} from "./config";

/**
 * OAuth 2.0 Authorization-Code-with-PKCE against X.
 *
 * PKCE binds the authorize request to the token exchange with a one-time secret
 * (`code_verifier`) so an intercepted `code` alone is useless. Confidential
 * clients (a "Web App" X app, which has a client secret) additionally
 * authenticate the token endpoint with HTTP Basic; public clients rely on PKCE
 * alone. We support both by branching on whether a secret is configured.
 */

export interface Pkce {
  verifier: string;
  challenge: string;
}

export function generatePkce(): Pkce {
  const verifier = randomBytes(48).toString("base64url"); // 64 chars, in RFC range
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function randomState(): string {
  return randomBytes(24).toString("base64url");
}

export function buildAuthorizeUrl(input: {
  origin: string;
  state: string;
  challenge: string;
}): string {
  const clientId = xClientId();
  if (!clientId) throw new Error("X client id not configured");
  const url = new URL(X_OAUTH.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", xRedirectUri(input.origin));
  url.searchParams.set("scope", xScopes().join(" "));
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export interface XTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number; // seconds
  scope?: string;
  token_type: string;
}

function tokenAuthHeaders(): Record<string, string> {
  const clientId = xClientId();
  const secret = xClientSecret();
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
  };
  if (secret && clientId) {
    // Confidential client: authenticate with HTTP Basic (client_id:secret).
    headers.authorization =
      "Basic " + Buffer.from(`${clientId}:${secret}`).toString("base64");
  }
  return headers;
}

async function tokenRequest(body: URLSearchParams): Promise<XTokenResponse> {
  const res = await fetch(X_OAUTH.tokenUrl, {
    method: "POST",
    headers: tokenAuthHeaders(),
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`X token endpoint ${res.status}: ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as XTokenResponse;
}

/** Exchange an authorization `code` for tokens (must reuse the same origin). */
export function exchangeCode(input: {
  origin: string;
  code: string;
  verifier: string;
}): Promise<XTokenResponse> {
  const clientId = xClientId();
  if (!clientId) throw new Error("X client id not configured");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: xRedirectUri(input.origin),
    code_verifier: input.verifier,
    client_id: clientId,
  });
  return tokenRequest(body);
}

/** Refresh an expired access token (needs the offline.access scope). */
export function refreshAccessToken(refreshToken: string): Promise<XTokenResponse> {
  const clientId = xClientId();
  if (!clientId) throw new Error("X client id not configured");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
  });
  return tokenRequest(body);
}
