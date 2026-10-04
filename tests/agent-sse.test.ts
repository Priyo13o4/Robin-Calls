import test from "node:test";
import assert from "node:assert/strict";

import { isAbort, postEventStream, SseHttpError } from "../lib/agent/sse";

/**
 * The SSE reader.
 *
 * `EventSource` cannot be used here and there is no workaround: `/agent/chat`
 * is a POST carrying the whole transcript, and `EventSource` issues a GET and
 * accepts no headers. Putting a transcript in a query string is not an option
 * either — every proxy in the path logs URLs, and the transcript *is* the
 * conversation.
 *
 * So frames are parsed by hand, and the case that matters is the one a naive
 * implementation gets wrong every time: **a network chunk cuts wherever TCP
 * felt like it**, routinely mid-JSON.
 */

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function respondWith(chunks: string[], init: ResponseInit = {}): typeof globalThis.fetch {
  return (async () =>
    new Response(streamOf(chunks), { status: 200, ...init })) as typeof globalThis.fetch;
}

async function collect(fetchImpl: typeof globalThis.fetch) {
  const original = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    const frames = [];
    for await (const frame of postEventStream("/agent/chat", {})) frames.push(frame);
    return frames;
  } finally {
    globalThis.fetch = original;
  }
}

test("a frame split across chunks mid-JSON is reassembled", async () => {
  const frames = await collect(
    respondWith([
      'event: message\ndata: {"text":"Twenty-eight points ca',
      'me off a hundred.","strippedClaims":0}\n\n',
      "event: done\ndata: {}\n\n",
    ])
  );

  assert.equal(frames.length, 2);
  assert.equal(frames[0].event, "message");
  assert.equal(JSON.parse(frames[0].data).text, "Twenty-eight points came off a hundred.");
  assert.equal(frames[1].event, "done");
});

test("several frames arriving in one chunk are all yielded", async () => {
  const frames = await collect(
    respondWith(['event: start\ndata: {"traceId":"t1"}\n\nevent: usage\ndata: {}\n\nevent: done\ndata: {}\n\n'])
  );

  assert.deepEqual(
    frames.map((f) => f.event),
    ["start", "usage", "done"]
  );
});

test("multi-line data joins with a newline, and comments are skipped", async () => {
  const frames = await collect(
    respondWith([": keep-alive\nevent: notice\ndata: line one\ndata: line two\n\n"])
  );

  assert.equal(frames.length, 1);
  assert.equal(frames[0].data, "line one\nline two");
});

test("CRLF framing is handled", async () => {
  const frames = await collect(respondWith(["event: done\r\ndata: {}\r\n\r\n"]));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].event, "done");
});

test("a final frame with no trailing blank line is not swallowed", async () => {
  // A turn that never reports its ending is indistinguishable from a hang, so
  // a proxy clipping the last newline must not cost us the `done`.
  const frames = await collect(respondWith(['event: done\ndata: {"traceId":"t9"}']));
  assert.equal(frames.length, 1);
  assert.equal(frames[0].event, "done");
});

test("a non-2xx is raised before any frame, with the status", async () => {
  const failing = (async () =>
    new Response("<html>429</html>", { status: 429 })) as typeof globalThis.fetch;

  const original = globalThis.fetch;
  globalThis.fetch = failing;
  try {
    await assert.rejects(
      async () => {
        for await (const _ of postEventStream("/agent/chat", {})) void _;
      },
      (err: unknown) => err instanceof SseHttpError && err.status === 429
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("an abort is recognised as a normal ending, not a failure", () => {
  const abort = new Error("aborted");
  abort.name = "AbortError";
  assert.equal(isAbort(abort), true);
  assert.equal(isAbort(new Error("the model call failed")), false);
});
