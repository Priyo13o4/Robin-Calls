"use client";

/**
 * A Server-Sent Events reader built on `fetch` + `ReadableStream`.
 *
 * **Not `EventSource`, and it cannot be.** `/agent/chat` is a POST carrying the
 * whole transcript, and `EventSource` issues a GET and accepts no headers —
 * neither limit has a workaround. Putting a transcript in a query string is not
 * one: URLs are logged by every proxy in the path, and the transcript is the
 * conversation.
 *
 * So the frames are parsed here. Three properties matter:
 *
 * - **Frames split on a blank line, not on a chunk boundary.** A network chunk
 *   cuts wherever TCP felt like it, routinely mid-JSON. The buffer below is the
 *   whole reason this is not four lines of code.
 * - **`data:` accumulates across lines.** Multi-line data is one payload joined
 *   with `\n`, per the spec. Our server does not currently emit one, which is
 *   exactly why it is handled here rather than discovered later.
 * - **An abort is a normal ending, not an error.** The user pressing STOP and
 *   the model failing must not produce the same UI.
 */

export interface SseFrame {
  event: string;
  data: string;
}

export class SseHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string
  ) {
    super(`The agent service answered ${status}.`);
    this.name = "SseHttpError";
  }
}

/**
 * POST `body` to `url` and yield SSE frames as they arrive.
 *
 * Rejects a non-2xx before yielding anything: nginx's own 429 and 502 are HTML,
 * and feeding those to a frame parser produces a confusing silence instead of a
 * readable failure.
 */
export async function* postEventStream(
  url: string,
  body: unknown,
  options: { signal?: AbortSignal; headers?: Record<string, string> } = {}
): AsyncGenerator<SseFrame> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream", ...options.headers },
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new SseHttpError(response.status, detail.slice(0, 500));
  }
  if (!response.body) {
    throw new SseHttpError(response.status, "The response carried no body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // `\r\n\r\n` is legal SSE too; normalising first keeps the split simple.
      buffer = buffer.replace(/\r\n/g, "\n");
      let split = buffer.indexOf("\n\n");
      while (split !== -1) {
        const frame = parseFrame(buffer.slice(0, split));
        buffer = buffer.slice(split + 2);
        if (frame) yield frame;
        split = buffer.indexOf("\n\n");
      }
    }
    // A trailing frame with no terminating blank line. Our server always sends
    // one, but a proxy truncating the final newline would otherwise silently
    // swallow `done` — and a turn that never reports its ending is exactly the
    // failure the UI cannot tell from a hang.
    const last = parseFrame(buffer);
    if (last) yield last;
  } finally {
    // Releasing the lock lets the body be cancelled by the abort signal; a
    // reader still holding it keeps the connection open after the user has
    // navigated away, which is the leak that makes an SSE endpoint expensive.
    reader.releaseLock();
    if (!response.bodyUsed) await response.body.cancel().catch(() => {});
  }
}

function parseFrame(raw: string): SseFrame | null {
  const text = raw.trim();
  if (!text) return null;

  let event = "message";
  const data: string[] = [];

  for (const line of text.split("\n")) {
    if (line.startsWith(":")) continue; // comment / keep-alive
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    // One optional leading space after the colon, per the spec.
    const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }

  if (data.length === 0 && event === "message") return null;
  return { event, data: data.join("\n") };
}

/** True when a thrown value is the user pressing STOP rather than a failure. */
export function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}
