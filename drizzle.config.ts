import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error("DATABASE_URL is required for Drizzle Kit commands.");
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
});
