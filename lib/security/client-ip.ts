/**
 * The client IP every per-IP budget keys on.
 *
 * `x-real-ip` FIRST, and the order is the whole point. nginx sets it with
 * `proxy_set_header X-Real-IP $remote_addr`, which overwrites whatever the
 * caller sent. `x-forwarded-for` is set with `$proxy_add_x_forwarded_for`,
 * which APPENDS the real peer to the caller's own header, so its first entry
 * is attacker-controlled: measured 2026-09-14 against dev, 60 requests to
 * /api/stats under one forged value returned 429, and changing the forged
 * value returned 200 immediately. Reading the forwarded chain first made every
 * budget in `WINDOWS` a formality.
 *
 * The fallback is not dead code. `app/api/internal/v1/scan` builds a synthetic
 * request carrying only `x-forwarded-for`, copied from the `x-rc-caller-ip`
 * nginx overwrites for exactly this reason, and it has no `x-real-ip` to find.
 *
 * Same shape as CLAUDE.md §8 #19: identity read from an envelope a relayer can
 * forge, versus identity read from something we set ourselves.
 */
export function clientIpFromHeaders(headers: Headers): string | null {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first || null;
}
