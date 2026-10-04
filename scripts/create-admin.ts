/**
 * One-time (and idempotent) admin seed.
 *
 *   npx tsx scripts/create-admin.ts
 *
 * Reads ADMIN_USERNAME / ADMIN_EMAIL / ADMIN_PASSWORD (+ DATABASE_URL,
 * BETTER_AUTH_SECRET) from .env.local. Creates the admin account, or if it
 * already exists, RESETS its password to ADMIN_PASSWORD.
 *
 * Behaviour on re-run:
 *   • same password   → admin is recreated with the same password (no-op effect).
 *   • different pwd    → admin's password is rotated to the new one.
 *   • lost password    → just re-run with a new ADMIN_PASSWORD to recover.
 * Re-running deletes the old rows first, so any existing admin sessions are
 * invalidated (the admin logs in again). It never creates a second admin.
 */
import { Pool } from "pg";
import { betterAuth } from "better-auth";
import { admin, username as usernamePlugin } from "better-auth/plugins";

// Load .env.local so the bare `npx tsx` command works (Node 21+).
try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local absent — rely on the ambient environment.
}

async function main() {
  const username = process.env.ADMIN_USERNAME?.trim();
  const email = process.env.ADMIN_EMAIL?.trim();
  const password = process.env.ADMIN_PASSWORD;

  const dbPassword = process.env.APP_DB_PASSWORD;
  if (!dbPassword) throw new Error("APP_DB_PASSWORD is not set.");

  // Build the local docker string natively.
  // When running inside the app container, host is 'pgbouncer'. When running on host, 'localhost'.
  const dbHost = process.env.DB_HOST || (process.env.HOSTNAME ? 'pgbouncer' : 'localhost');
  const dbUrl = `postgresql://robincalls_app:${dbPassword}@${dbHost}:6432/robincalls`;
  if (!process.env.BETTER_AUTH_SECRET) throw new Error("BETTER_AUTH_SECRET is not set.");
  if (!username || !email || !password) {
    throw new Error("ADMIN_USERNAME, ADMIN_EMAIL and ADMIN_PASSWORD must all be set.");
  }
  if (password.length < 10) {
    throw new Error("ADMIN_PASSWORD must be at least 10 characters.");
  }

  const pool = new Pool({ connectionString: dbUrl });

  // A standalone Better Auth instance WITHOUT the nextCookies() plugin — that
  // plugin calls next/headers cookies(), which throws outside a Next request.
  // Same secret + schema (username + admin) as the app, so hashes are identical.
  const auth = betterAuth({
    database: pool,
    secret: process.env.BETTER_AUTH_SECRET,
    emailAndPassword: { enabled: true, minPasswordLength: 10 },
    plugins: [usernamePlugin(), admin()],
  });

  try {
    // wipe any existing admin (cascades to session/account) → clean re-seed
    const del = await pool.query('delete from "user" where "email" = $1', [email]);
    if (del.rowCount) {
      console.log(`Removed ${del.rowCount} existing account for ${email} (password reset).`);
    }

    // create via Better Auth so the password is hashed correctly
    await auth.api.signUpEmail({
      body: { email, password, name: username, username },
    });

    // elevate to admin (sign-up defaults role to null/user)
    await pool.query('update "user" set "role" = $1 where "email" = $2', ["admin", email]);

    console.log(`✓ Admin ready — username "${username}" (${email}). Log in at /admin/login.`);
  } finally {
    await pool.end();
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("✗ Failed to create admin:", err?.message ?? err);
  process.exit(1);
});
