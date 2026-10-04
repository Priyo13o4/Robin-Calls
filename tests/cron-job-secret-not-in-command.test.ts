import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// Read 0092 migration directly relative to this test file.
const migrationUrl = new URL(
  "../supabase/migrations/0092_job_secret_via_stdin.sql",
  import.meta.url
);
const sql = readFileSync(migrationUrl, "utf8");

function extractFunctionBody(content: string): string {
  assert.ok(
    content.includes("create or replace function public.call_robincalls_job"),
    "migration must declare create or replace function public.call_robincalls_job"
  );
  const match = content.match(/as\s*\$\$([\s\S]*?)\$\$;/);
  assert.ok(match, "could not extract function body between 'as $$' and '$$;'");
  const body = match[1].trim();
  assert.ok(body.length > 0, "extracted function body must be non-empty");
  return body;
}

test("function body extraction is non-empty and verifies migration declaration", () => {
  // CLAUDE.md §8 #22: extraction-based tests must prove they extracted.
  const body = extractFunctionBody(sql);
  assert.ok(body.length > 0);
});

test("cmd := format call does not reference job_secret or x-job-secret", () => {
  const body = extractFunctionBody(sql);
  const cmdStartIndex = body.indexOf("cmd := format(");
  assert.ok(cmdStartIndex !== -1, "expected 'cmd := format(' in function body");
  const cmdEndIndex = body.indexOf(");", cmdStartIndex);
  assert.ok(cmdEndIndex !== -1, "expected closing ');' for cmd := format(...)");
  const cmdCall = body.slice(cmdStartIndex, cmdEndIndex + 2);

  assert.ok(
    !cmdCall.includes("job_secret"),
    "cmd format call must not reference job_secret"
  );
  assert.ok(
    !cmdCall.includes("x-job-secret"),
    "cmd format call must not reference x-job-secret"
  );
});

test("copy statement pipes header via query args", () => {
  const body = extractFunctionBody(sql);
  assert.match(
    body,
    /copy\s+\(select\s+%L\)\s+to\s+program\s+%L/,
    "copy statement must match /copy (select %L) to program %L/"
  );
  assert.ok(
    body.includes("'x-job-secret: ' || job_secret"),
    "format args must include 'x-job-secret: ' || job_secret"
  );
});

test("curl reads headers from stdin (-H @-) with secure function attributes", () => {
  const body = extractFunctionBody(sql);
  assert.ok(body.includes("-H @-"), "curl command must include '-H @-'");
  assert.match(sql, /security\s+definer/i, "function must declare security definer");
  assert.match(sql, /set\s+search_path\s*=\s*''/i, "function must set search_path = ''");
});

test("revoke execute on function from public is present", () => {
  assert.match(
    sql,
    /revoke\s+execute\s+on\s+function\s+public\.call_robincalls_job\(text\)\s+from\s+public;/i,
    "must revoke execute on function public.call_robincalls_job(text) from public"
  );
});

test("latest migration defining call_robincalls_job is 0092", () => {
  const migrationsUrl = new URL("../supabase/migrations", import.meta.url);
  const matchingFiles = readdirSync(migrationsUrl)
    .filter((file) => file.endsWith(".sql"))
    .filter((file) => {
      const content = readFileSync(
        new URL(`../supabase/migrations/${file}`, import.meta.url),
        "utf8"
      );
      return content.includes("function public.call_robincalls_job");
    })
    .sort();

  assert.ok(
    matchingFiles.length > 0,
    "expected at least one migration defining call_robincalls_job"
  );
  assert.equal(
    matchingFiles[matchingFiles.length - 1],
    "0092_job_secret_via_stdin.sql",
    "latest migration defining call_robincalls_job must be 0092_job_secret_via_stdin.sql"
  );
});
