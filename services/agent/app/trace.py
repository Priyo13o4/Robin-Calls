"""One trace id per request, threaded into every log line and every call to Next.

The whole tracing design is this file plus one header. A chat turn, the tool
reads it triggered, the scan those reads triggered, and anything ``reportError``
wrote on the Next side all carry the same ``x-rc-trace-id`` — so "what happened
to this conversation" is one grep rather than a correlation exercise across two
languages.

Deliberately not OpenTelemetry: there is no collector in this stack, and one id
in structured logs answers the question we actually have.
"""

from __future__ import annotations

import logging
import re
import uuid
from contextvars import ContextVar

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

HEADER = "x-rc-trace-id"

#: Same shape Next's routes validate against. A caller-supplied id ends up in
#: log lines, so it is bounded and character-restricted rather than trusted.
_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

_trace_id: ContextVar[str] = ContextVar("trace_id", default="-")


def trace_id() -> str:
    return _trace_id.get()


def new_trace_id() -> str:
    return uuid.uuid4().hex


class TraceFilter(logging.Filter):
    """Puts the current trace id on every record, including third-party ones."""

    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "trace_id"):
            record.trace_id = trace_id()
        return True


class TraceMiddleware:
    """Pure ASGI, deliberately **not** ``BaseHTTPMiddleware``.

    ``BaseHTTPMiddleware`` runs the application inside its own anyio task group
    and consumes the response as a stream. That wrapping has a long history of
    interfering with client-disconnect propagation on streaming responses —
    ``http.disconnect`` not reaching the endpoint, so a chat turn keeps calling
    the model after the browser closed the tab. Billable output nobody will
    read, and the only tell is a suspiciously long ``agent.turn`` duration.

    Honest scope: that failure has **not** been reproduced on the Starlette
    version pinned here, which has reworked this area — and the contextvar
    *does* survive into a streaming body under both implementations (checked).
    This is removing a hazard class, not fixing a demonstrated bug. It is worth
    doing anyway because /agent/chat is a long-lived SSE stream that spends
    money per token, the pure-ASGI form is strictly fewer moving parts, and the
    behaviour we depend on is then ours rather than a property of whichever
    Starlette the lockless resolver picked.

    Verify against a real browser once the chat UI exists: close a tab
    mid-stream and confirm the ``agent.turn`` line shows a short duration.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        supplied = Headers(scope=scope).get(HEADER)
        tid = supplied if supplied and _SAFE_ID.match(supplied) else new_trace_id()
        token = _trace_id.set(tid)

        async def send_with_trace(message: Message) -> None:
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message)[HEADER] = tid
            await send(message)

        try:
            await self.app(scope, receive, send_with_trace)
        finally:
            _trace_id.reset(token)


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler()
    handler.addFilter(TraceFilter())
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s [%(trace_id)s] %(name)s %(message)s")
    )
    root = logging.getLogger()
    root.handlers = [handler]
    # logging.setLevel rejects lowercase names ("debug") — normalize so a
    # lowercase LOG_LEVEL (docker-compose.local.yml sets one) doesn't crash-loop.
    root.setLevel(level.upper())
