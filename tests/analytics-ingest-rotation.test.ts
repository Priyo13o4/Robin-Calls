import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readChunk } from "../app/api/jobs/analytics-ingest/route";

/**
 * readChunk() is the primitive the ingest job's rotation-drain logic is
 * built on (route.ts's own comment walks through the full rename+USR1+drain
 * sequence). No mocking needed — it only touches real files, so these use
 * a real temp directory the way tests/top-traders-endpoint.test.ts imports
 * a route handler's extracted pure function directly.
 */

function tmpFile(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rc-analytics-"));
  const file = path.join(dir, "analytics.log");
  fs.writeFileSync(file, content);
  return file;
}

test("readChunk reads only complete newline-terminated lines by default", () => {
  const file = tmpFile('{"a":1}\n{"a":2}\n{"a":3}'); // no trailing \n on last line
  const size = fs.statSync(file).size;

  const chunk = readChunk(file, 0, size, false);
  assert.ok(chunk);
  assert.equal(chunk.lines.length, 2);
  assert.equal(chunk.lines[0], '{"a":1}');
  assert.equal(chunk.lines[1], '{"a":2}');
  // The trailing unterminated line is NOT consumed — it may still be mid-write.
  assert.ok(chunk.bytesConsumed < size);
});

test("readChunk without forceDrainAtEof waits forever on a file with no newline", () => {
  const file = tmpFile('{"a":1}'); // never terminated
  const size = fs.statSync(file).size;

  const chunk = readChunk(file, 0, size, false);
  assert.ok(chunk);
  assert.equal(chunk.lines.length, 0);
  assert.equal(chunk.bytesConsumed, 0);
});

test("readChunk with forceDrainAtEof consumes a file with no newline at all, once nothing more is coming", () => {
  // A rotated file frozen mid-write: no \n anywhere. Without forceDrainAtEof
  // this would wait forever for a byte that will never arrive (nginx has
  // already switched to writing the new file). Draining it fully, discarding
  // the malformed content, is how the cursor is able to move past the .1
  // file and reach the new file's data at all.
  const file = tmpFile('{"a":1}'); // never terminated
  const size = fs.statSync(file).size;

  const chunk = readChunk(file, 0, size, true);
  assert.ok(chunk);
  assert.equal(chunk.bytesConsumed, size);
  assert.equal(chunk.lines.length, 1);
});

test("readChunk resuming mid-file only returns bytes after startOffset", () => {
  const file = tmpFile('{"a":1}\n{"a":2}\n{"a":3}\n');
  const size = fs.statSync(file).size;
  const firstNewline = fs.readFileSync(file, "utf8").indexOf("\n") + 1;

  const chunk = readChunk(file, firstNewline, size, false);
  assert.ok(chunk);
  assert.deepEqual(chunk.lines, ['{"a":2}', '{"a":3}']);
});

test("readChunk at or past EOF returns an empty, zero-byte result", () => {
  const file = tmpFile('{"a":1}\n');
  const size = fs.statSync(file).size;

  const chunk = readChunk(file, size, size, false);
  assert.ok(chunk);
  assert.equal(chunk.lines.length, 0);
  assert.equal(chunk.bytesConsumed, 0);
});

test("readChunk respects MAX_BYTES_PER_RUN by carrying the remainder to the next call", () => {
  // Build a file bigger than the 10MB per-run cap so the caller must loop.
  const line = `{"padding":"${"x".repeat(200)}"}\n`;
  const linesNeeded = Math.ceil((10 * 1024 * 1024 + 1) / line.length);
  const file = tmpFile(line.repeat(linesNeeded));
  const size = fs.statSync(file).size;
  assert.ok(size > 10 * 1024 * 1024);

  const first = readChunk(file, 0, size, false);
  assert.ok(first);
  assert.ok(first.bytesConsumed <= 10 * 1024 * 1024);
  assert.ok(first.bytesConsumed < size, "first call must not consume the whole oversized file");

  const second = readChunk(file, first.bytesConsumed, size, false);
  assert.ok(second);
  assert.ok(second.bytesConsumed > 0);
});
