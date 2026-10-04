import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

/**
 * The single application database boundary. During the transition this points
 * at Supabase Postgres; after cutover the same URL points at pgbouncer.
 */
const globalForDb = globalThis as typeof globalThis & {
  robincallsPgPool?: Pool;
  robincallsDb?: ReturnType<typeof drizzle<typeof schema>>;
};

function databaseUrl(): string | null {
  const value = process.env.DATABASE_URL;
  return value && !value.includes("YOUR_") ? value : null;
}

function pool(): Pool | null {
  const url = databaseUrl();
  if (!url) return null;

  if (!globalForDb.robincallsPgPool) {
    const parsed = new URL(url);
    globalForDb.robincallsPgPool = new Pool({
      connectionString: url,
      // Supabase pooler connections use TLS; the self-hosted pgbouncer URL is
      // internal and has no sslmode, so pg keeps TLS disabled there.
      ssl:
        parsed.searchParams.get("sslmode") || parsed.hostname.endsWith(".supabase.com")
          ? { rejectUnauthorized: false }
          : undefined,
    });
  }
  return globalForDb.robincallsPgPool;
}

/**
 * Returns null when DATABASE_URL has not been configured (local empty-state).
 *
 * Memoized alongside the pool: every repository function calls this, and
 * rebuilding the Drizzle wrapper (which re-derives the schema's relational
 * metadata) on each call is pure overhead. The underlying pool was already
 * shared, so this changes cost, not connection behavior.
 */
export function database() {
  const connection = pool();
  if (!connection) return null;

  if (!globalForDb.robincallsDb) {
    globalForDb.robincallsDb = drizzle(connection, { schema });
  }
  return globalForDb.robincallsDb;
}

export type Database = NonNullable<ReturnType<typeof database>>;

/**
 * True when DATABASE_URL is set (and not a placeholder) — i.e. persistence is a
 * live boundary, so a null/empty read means "nothing on record", not "we never
 * looked". A pure presence check: it opens no pool and holds no connection, so
 * it is safe for a domain module (e.g. the scan pipeline) to consult without
 * crossing the "never touch a connection directly" boundary. Checks that turn
 * an empty read into a sentence about the token MUST gate on this rather than
 * assume the DB is absent (see the `ctx.db` consumers in lib/scanner/checks.ts).
 */
export function isDatabaseConfigured(): boolean {
  return databaseUrl() != null;
}
