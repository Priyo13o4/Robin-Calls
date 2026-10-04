import { betterAuth } from "better-auth";
import { firstSet } from "@/lib/config/env";
import { admin, username } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { Pool } from "pg";

/**
 * Better Auth — admin-only credential auth, backed by Supabase Postgres.
 *
 * Better Auth needs a DIRECT Postgres connection (it runs SQL), not the REST
 * API — so it uses DATABASE_URL (the Supabase connection string), separate from
 * the sb_publishable / sb_secret keys the rest of the app uses.
 *
 * Public sign-up over HTTP is blocked in the route handler
 * (app/api/auth/[...all]/route.ts); the only way an account is created is the
 * one-time seed script (scripts/create-admin.ts), which calls auth.api directly.
 */
export const auth = betterAuth({
  database: new Pool({
    connectionString: process.env.DATABASE_URL,
  }),
  secret: process.env.BETTER_AUTH_SECRET,
  // firstSet, NOT `??`: NEXT_PUBLIC_SITE_URL arrives as "" from any image
  // build where the repo Variable is unset, and "" would win the `??` chain —
  // silently making the auth baseURL an empty string instead of localhost.
  baseURL:
    firstSet(process.env.BETTER_AUTH_URL, process.env.NEXT_PUBLIC_SITE_URL) ??
    "http://localhost:3000",
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
  },
  // username() → sign in with a username; admin() → role column + management;
  // nextCookies() must be LAST so Server Actions can set cookies.
  plugins: [username(), admin(), nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
