"""The ONLY egress from this process to Next.js.

One door means one place to instrument, one place to set a timeout, one place
where the internal secret lives, and one place a failure can be classified.
That is what makes an agent-plane failure traceable instead of a mystery
somewhere in a tool loop, and it is why this module must not be bypassed even
for "just one quick call" (implementation-plan §4).

Two properties are load-bearing.

**A transport fault must never become a verdict.** viem's revert-versus-timeout
problem has an exact analogue one layer out: a FastAPI→Next timeout that
surfaces as ``{"error": …}`` will be narrated by the model as a finding about
the token. So every failure returns a ``NextResult`` carrying an explicit
``transient`` flag, and — following ``isTransientRpcError``'s reasoning — an
*unrecognised* failure defaults to transient. A wrong ``True`` costs a retry; a
wrong ``False`` costs a false accusation.

**"Not found" and "could not look" stay distinct.** The dispatcher reports
``found`` separately from ``ok``; this client keeps them separate all the way
to the tool result the model sees (CLAUDE.md §4).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

import httpx

from . import codes
from .settings import settings

log = logging.getLogger("agent.next")


@dataclass(frozen=True)
class NextResult:
    ok: bool
    #: Only meaningful when ok. False = the read ran and found nothing.
    found: bool = False
    value: Any = None
    error: str | None = None
    code: str | None = None
    #: Infrastructure or capacity, not an answer. Never narrate as a finding.
    transient: bool = False
    status: int | None = None

    def as_tool_payload(self) -> dict[str, Any]:
        """What the model actually sees. The shape is the honesty contract."""
        if self.ok and self.found:
            return {"ok": True, "found": True, "value": self.value}
        if self.ok:
            return {
                "ok": True,
                "found": False,
                "value": None,
                "note": (
                    "Nothing is on record for this query. That means no record "
                    "exists — it does not mean the subject is clean."
                ),
            }
        return {
            "ok": False,
            "error": self.error,
            "code": self.code,
            "transient": self.transient,
            "note": (
                "This lookup did not complete. It is a statement about our "
                "infrastructure, not about the token or wallet. Do not report "
                "it as a finding, and do not treat it as an all-clear."
            )
            if self.transient
            else None,
        }


#: Statuses that are a real answer rather than a failure of ours. Everything
#: else — including anything unrecognised — is treated as transient.
_DEFINITE_STATUSES = {400, 404, 422}


class NextClient:
    def __init__(self, client: httpx.AsyncClient | None = None) -> None:
        self._client = client
        self._cfg = settings()

    async def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                base_url=self._cfg.next_base_url,
                # Per-call timeouts are passed explicitly; this is the ceiling.
                timeout=self._cfg.next_scan_timeout_s,
            )
        return self._client

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    def _headers(self, trace_id: str, caller_ip: str | None = None) -> dict[str, str]:
        headers = {
            "content-type": "application/json",
            "x-job-secret": self._cfg.internal_job_secret,
            "x-rc-trace-id": trace_id,
        }
        if caller_ip:
            headers["x-rc-caller-ip"] = caller_ip
        return headers

    async def read(self, name: str, args: dict[str, Any], trace_id: str) -> NextResult:
        return await self._post(
            f"/api/internal/v1/read/{name}",
            {"args": args},
            trace_id,
            timeout=self._cfg.next_read_timeout_s,
            operation=f"read:{name}",
        )

    async def scan(
        self, address: str, trace_id: str, caller_ip: str | None = None
    ) -> NextResult:
        # The scan route's own budget is ~180s; this timeout must clear it or an
        # honest slow scan becomes a transport fault (§12.4).
        return await self._post(
            "/api/internal/v1/scan",
            {"address": address},
            trace_id,
            timeout=self._cfg.next_scan_timeout_s,
            operation="scan",
            caller_ip=caller_ip,
        )

    async def _post(
        self,
        path: str,
        body: dict[str, Any],
        trace_id: str,
        *,
        timeout: float,
        operation: str,
        caller_ip: str | None = None,
    ) -> NextResult:
        client = await self._http()
        try:
            response = await client.post(
                path,
                json=body,
                headers=self._headers(trace_id, caller_ip),
                timeout=timeout,
            )
        except httpx.TimeoutException as exc:
            log.warning(
                "next.timeout", extra={"trace_id": trace_id, "op": operation, "err": str(exc)}
            )
            return NextResult(
                ok=False,
                error="The lookup timed out.",
                code=codes.UPSTREAM_TIMEOUT,
                transient=True,
            )
        except httpx.HTTPError as exc:
            log.warning(
                "next.transport", extra={"trace_id": trace_id, "op": operation, "err": str(exc)}
            )
            return NextResult(
                ok=False,
                error="The lookup could not reach the scanner.",
                code=codes.UPSTREAM_UNREACHABLE,
                transient=True,
            )

        try:
            payload = response.json()
        except ValueError:
            # A body we cannot parse is not an answer. Notably this catches an
            # HTML error page from a proxy, which would otherwise be handed to
            # the model as if it were data.
            log.warning(
                "next.unparseable",
                extra={"trace_id": trace_id, "op": operation, "status": response.status_code},
            )
            return NextResult(
                ok=False,
                error="The scanner returned an unreadable response.",
                code=codes.UPSTREAM_INVALID,
                transient=True,
                status=response.status_code,
            )

        if response.is_success and payload.get("ok"):
            # The scan route answers with the verdict body inline rather than
            # under `value`, and always "found" something when ok.
            if "value" in payload:
                return NextResult(
                    ok=True, found=bool(payload.get("found")), value=payload.get("value")
                )
            return NextResult(ok=True, found=True, value=payload)

        status = response.status_code
        # Next may itself have classified this — its judgement wins, because it
        # is the side that knows whether the pipeline refused or the explorer
        # died. We only guess when it did not say.
        declared = payload.get("transient")
        transient = (
            bool(declared)
            if isinstance(declared, bool)
            else status not in _DEFINITE_STATUSES
        )
        log.warning(
            "next.error",
            extra={
                "trace_id": trace_id,
                "op": operation,
                "status": status,
                "code": payload.get("code"),
            },
        )
        return NextResult(
            ok=False,
            error=payload.get("error") or "The lookup failed.",
            code=payload.get("code"),
            transient=transient,
            status=status,
        )


_client: NextClient | None = None


def next_client() -> NextClient:
    global _client
    if _client is None:
        _client = NextClient()
    return _client
