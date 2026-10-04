import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // dev.robincalls.com is the cloudflared tunnel hostname for the local dev
  // stack (some_commands.md). Without it, next dev blocks every HMR request
  // from that origin as cross-origin — which doesn't just kill hot-reload,
  // it left the client stuck mid-bootstrap: zero hydration, every button and
  // effect (including PlatformBanner's og-proxy fetch) permanently inert.
  allowedDevOrigins: ['dev.robincalls.com'],

  /**
   * Barrel packages this app imports from by name. Without this, one
   * `import { Zap } from "lucide-react"` pulls the package's whole index
   * through the compiler; with it, only the touched module is.
   *
   * `lucide-react` is NOT listed: Next already ships it in the built-in
   * default list (server/config.js), and user entries are merged with those
   * rather than replacing them, so repeating it buys nothing. Everything here
   * is a barrel this app actually depends on and Next does not cover.
   *
   * three/@react-three/* are the heaviest by far — drei alone re-exports
   * several hundred modules, and Lanyard.tsx is the only route that needs any
   * of them.
   */
  experimental: {
    // Dev only: without a target Turbopack holds every compiled route's graph (~4.7 GB after four
    // pages here). A build keeps the default so the image build is not slowed by eviction.
    ...(process.env.NODE_ENV === "development" ? { turbopackMemoryLimit: 2 * 1024 ** 3 } : {}),
    optimizePackageImports: [
      "three",
      "@react-three/fiber",
      "@react-three/drei",
      "@react-three/rapier",
      "framer-motion",
      "viem",
      "wagmi",
      "@wagmi/core",
      "@wagmi/connectors",
      "@reown/appkit",
      "radix-ui",
      "@tanstack/react-query",
    ],
  },
  // Typechecking is enforced in pre-push and CI workflows on the host
  // in seconds. Skipping it inside Docker cuts image build time from ~10 min to ~35s.
  typescript: {
    ignoreBuildErrors: true,
  },
  // Self-hosted Docker deploy: small runtime image (docker/Dockerfile copies
  // only .next/standalone + .next/static + public — no full node_modules).
  output: "standalone",

  /**
   * `/agent/*` is served by the FastAPI agent container, and in every real
   * deployment nginx routes it there before Next ever sees it. `next dev` has
   * no nginx, so the chat UI would 404 against its own origin — and the client
   * must keep calling a same-origin relative path, because a configurable agent
   * base would put "where the persona allowlist is enforced" into an
   * environment variable.
   *
   * So this is a dev-only bridge, off unless AGENT_DEV_PROXY is set, and it
   * cannot apply in production: the production build emits no rewrite at all.
   */
  async rewrites() {
    const target = process.env.AGENT_DEV_PROXY;
    if (process.env.NODE_ENV === "production" || !target) return [];
    return [
      { source: "/agent/:path*", destination: `${target.replace(/\/$/, "")}/agent/:path*` },
    ];
  },

  /**
   * `permanent: true` — Next emits **308**, which Google treats exactly as a
   * 301 for consolidating a URL and moving its ranking signal. What matters is
   * that it is not a 302: a temporary redirect tells Google to keep the OLD URL
   * indexed and transfer nothing, so the new path would start from zero for as
   * long as the redirect stood.
   *
   * The per-listing `/directory/<id>` hop lives in app/directory/[id]/page.tsx
   * instead — it needs a database read to turn a numeric id into its slug,
   * which a config rewrite cannot do.
   *
   * **Nothing here may match `/agent/*`.** That is not a page, it is the AI
   * plane's live API surface: `lib/agent/runner.ts` pins `AGENT_BASE = "/agent"`
   * and the browser calls `/agent/config`, `/agent/persona/*` and `/agent/tool`
   * against it, which nginx proxies to the FastAPI container (docker/nginx.conf,
   * `location /agent/`). A 308 on `/agent/:path*` was added and survived only
   * because nginx's location block matches before Next ever sees the request —
   * anywhere without nginx (next dev, a bare `next start`, a smoke stack) it
   * turned every AI-plane call into an HTML page, and a 308 is cached by the
   * browser permanently, so the breakage outlives the deploy that caused it.
   * Bare `/agent` is safe and stays: nginx's prefix needs the trailing slash,
   * so it falls through to the app, and no page has ever lived there.
   */
  /**
   * `/public` is served by Next with `Cache-Control: public, max-age=0`, so every
   * background, logo and model was REVALIDATED on each navigation — a 304 round
   * trip per asset, per page, on a self-hosted box with no CDN in front of it.
   * Only `.next/static` gets the content-hashed `immutable` treatment, and none
   * of these files live there.
   *
   * Deliberately NOT `immutable`: these paths are not content-hashed, so an
   * `immutable` year would strand a replaced asset in every browser that had
   * seen the old one. A week fresh plus a month of `stale-while-revalidate`
   * means a swap lands within 7 days and the refill is never on the critical
   * path. Bump the filename (`logo-sm.webp`) when a change must be instant.
   *
   * `:file+` (one or more), never `:file*`: several of these prefixes are ALSO
   * page routes — `/tokenomics` is a page and `/public/tokenomics/city` is art.
   * A zero-or-more rule matches the bare prefix too, which would put a week of
   * browser cache on an HTML page. `tests/static-cache-headers.test.ts` pins it.
   */
  async headers() {
    const STATIC_MEDIA = "public, max-age=604800, stale-while-revalidate=2592000";
    return [
      { source: "/brand/:file+", headers: [{ key: "Cache-Control", value: STATIC_MEDIA }] },
      { source: "/backgrounds/:file+", headers: [{ key: "Cache-Control", value: STATIC_MEDIA }] },
      { source: "/models/:file+", headers: [{ key: "Cache-Control", value: STATIC_MEDIA }] },
      { source: "/lanyard/:file+", headers: [{ key: "Cache-Control", value: STATIC_MEDIA }] },
      { source: "/scene/:file+", headers: [{ key: "Cache-Control", value: STATIC_MEDIA }] },
      { source: "/tokenomics/city/:file+", headers: [{ key: "Cache-Control", value: STATIC_MEDIA }] },
    ];
  },

  async redirects() {
    return [
      { source: "/directory", destination: "/ecosystem", permanent: true },
      // Brand renames, 2026-08-24: the Watchlist became the Night Market and
      // the Consigliere became the Robin Knight.
      { source: "/watchlist", destination: "/night-market", permanent: true },
      { source: "/watchlist/:path*", destination: "/night-market", permanent: true },
      { source: "/consigliere", destination: "/robin-knight", permanent: true },
      { source: "/consigliere/:path*", destination: "/robin-knight", permanent: true },
      { source: "/agent", destination: "/robin-knight", permanent: true },
    ];
  },

};

export default nextConfig;
