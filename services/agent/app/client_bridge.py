"""Verification for tool results computed in the user's browser.

A client-locale tool is executed against a public RPC endpoint by code we
shipped but do not control, on a machine we do not control, and the answer is
then handed to a model that will state it as fact. Everything here exists
because that result arrives with no error even when it is wrong.

Three failures, three guards:

**Wrong chain.** A user (or a page) pointed at Ethereum mainnet gets a real,
well-formed, confidently wrong answer for any address that exists on both
chains — which includes every address, since addresses are not chain-scoped.
So the envelope carries ``chainId`` and anything other than 4663 is refused.

**Silent staleness.** An endpoint hundreds of blocks behind returns valid data
from the past with no indication of it. There is no error to catch, so
``blockNumber`` is mandatory and is compared against the head we know about.

**A hostile endpoint.** Nothing here can stop a determined user from lying to
their own agent about their own balance — and that is an acceptable exposure,
because the honest guard is elsewhere: no tool whose answer could accuse or
exonerate a token is client-locale in the first place. Sell simulation and
anything honeypot-shaped are SERVER-only precisely so a manufactured "you can
sell fine" is not reachable from here.
"""

from __future__ import annotations

import ipaddress
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlparse

from .settings import CHAIN_ID, settings

_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T")


class ProvenanceError(ValueError):
    """A client-supplied result failed verification and must not be used.

    ``reason`` is a fixed label rather than the message, so diagnostics can
    count rejections by kind without ever recording the message text — a rise
    in ``stale`` means the public endpoint is lagging, a rise in
    ``wrong_chain`` means users are pointed elsewhere, and those are two
    different operational problems.
    """

    def __init__(self, message: str, reason: str = "malformed") -> None:
        super().__init__(message)
        self.reason = reason


@dataclass(frozen=True)
class Provenance:
    source: str
    endpoint_host: str
    chain_id: int
    block_number: int
    observed_at: str


def _require(envelope: dict[str, Any], key: str) -> Any:
    if key not in envelope:
        raise ProvenanceError(f"provenance is missing required field {key!r}")
    return envelope[key]


def verify(
    payload: Any, *, head_block: int | None = None, allow_hosts: list[str] | None = None
) -> tuple[Any, Provenance]:
    """Validate a ``{value, provenance}`` envelope and return both halves.

    ``head_block`` is the height we independently believe the chain is at. When
    it is unknown the staleness check is skipped rather than faked — an unknown
    head cannot prove freshness, and pretending otherwise would turn this guard
    into decoration.
    """
    if not isinstance(payload, dict) or "provenance" not in payload:
        raise ProvenanceError(
            "client tool results must be {value, provenance}; a bare value is "
            "not accepted, because an unlabelled result cannot be checked"
        )

    envelope = payload["provenance"]
    if not isinstance(envelope, dict):
        raise ProvenanceError("provenance must be an object")

    chain_id = _require(envelope, "chainId")
    if not isinstance(chain_id, int) or chain_id != CHAIN_ID:
        raise ProvenanceError(
            f"result came from chain {chain_id!r}, not Robinhood Chain ({CHAIN_ID})", "wrong_chain"
        )

    block_number = _require(envelope, "blockNumber")
    if not isinstance(block_number, int) or block_number <= 0:
        raise ProvenanceError("blockNumber must be a positive integer")

    if head_block is not None:
        lag = head_block - block_number
        if lag > settings().client_rpc_max_block_lag:
            raise ProvenanceError(
                f"result is {lag} blocks behind the head — the endpoint is stale", "stale"
            )
        # Slightly ahead is normal (the head moved between two reads). Far ahead
        # is a fabricated or wrong-chain number wearing the right shape.
        if lag < -settings().client_rpc_max_block_lag:
            raise ProvenanceError(
                f"result claims block {block_number}, which is ahead of the known head", "stale"
            )

    endpoint = str(envelope.get("endpointHost") or "")
    hosts = allow_hosts if allow_hosts is not None else _allowed_hosts()
    if endpoint and hosts and endpoint not in hosts:
        raise ProvenanceError(
            f"endpoint host {endpoint!r} is not on the client allowlist", "off_allowlist"
        )

    observed_at = str(envelope.get("observedAt") or "")
    if observed_at and not _ISO.match(observed_at):
        raise ProvenanceError("observedAt must be an ISO-8601 timestamp")

    return payload.get("value"), Provenance(
        source=str(envelope.get("source") or "client-rpc"),
        endpoint_host=endpoint,
        chain_id=chain_id,
        block_number=block_number,
        observed_at=observed_at or datetime.now(UTC).isoformat(),
    )


def verify_external(payload: Any, *, tool_name: str) -> tuple[Any, dict[str, Any]]:
    """Validate keyless web/market results without inventing chain provenance.

    These sources are advisory. Their bounded URLs, timestamps and completeness
    travel with the content, while the RPC verifier above remains unchanged.
    """
    if not isinstance(payload, dict) or not isinstance(payload.get("provenance"), dict):
        raise ProvenanceError("external results require an explicit provenance envelope")
    envelope = payload["provenance"]
    expected = "dexscreener" if tool_name == "search_token_market" else "parallel-mcp"
    if envelope.get("source") != expected:
        raise ProvenanceError(f"{tool_name} must identify source {expected!r}")
    fetched_at = envelope.get("fetchedAt")
    if not isinstance(fetched_at, str) or not _ISO.match(fetched_at):
        raise ProvenanceError("external fetchedAt must be an ISO-8601 timestamp")
    completeness = envelope.get("completeness")
    if completeness not in {"complete", "partial"}:
        raise ProvenanceError("external completeness must be complete or partial")
    value = payload.get("value")
    if not isinstance(value, dict):
        raise ProvenanceError("external result value must be an object")

    def clean_text(item: Any, limit: int) -> str:
        if not isinstance(item, str):
            return ""
        return re.sub(r"\s+", " ", re.sub(r"[\x00-\x1f\x7f]", " ", item)).strip()[:limit]

    def public_url(item: Any) -> str:
        if not isinstance(item, str):
            return ""
        parsed = urlparse(item)
        hostname = (parsed.hostname or "").lower().rstrip(".")
        public_dns_name = bool(
            re.fullmatch(
                r"(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})",
                hostname,
            )
        )
        try:
            ip_address = ipaddress.ip_address(hostname)
        except ValueError:
            ip_address = None
        if (
            parsed.scheme != "https"
            or not public_dns_name
            or parsed.username
            or parsed.password
            or ip_address is not None
            or hostname == "localhost"
            or hostname.endswith((".localhost", ".local", ".internal", ".test"))
            or hostname == "home.arpa"
        ):
            return ""
        return item[:2048]

    if tool_name == "web_search":
        rows = value.get("results")
        if not isinstance(rows, list) or len(rows) > 20:
            raise ProvenanceError("web_search results must be a bounded list")
        clean_rows = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            url = public_url(row.get("url"))
            if not url:
                continue
            clean_rows.append(
                {
                    "title": clean_text(row.get("title"), 160),
                    "url": url,
                    "domain": (urlparse(url).hostname or "")[:253],
                    "publishDate": clean_text(row.get("publishDate"), 64) or None,
                    "excerpt": clean_text(row.get("excerpt"), 500),
                    "category": clean_text(row.get("category"), 24),
                }
            )
        value = {
            "objective": clean_text(value.get("objective"), 600),
            "results": clean_rows,
            "source": expected,
            "fetchedAt": fetched_at,
            "completeness": completeness,
        }
    elif tool_name == "web_fetch":
        rows = value.get("pages")
        if not isinstance(rows, list) or len(rows) > 8:
            raise ProvenanceError("web_fetch pages must be a bounded list")
        value = {
            "pages": [
                {
                    "url": public_url(row.get("url")),
                    "title": clean_text(row.get("title"), 160),
                    "content": clean_text(row.get("content"), 4000),
                }
                for row in rows
                if isinstance(row, dict) and public_url(row.get("url"))
            ],
            "source": expected,
            "fetchedAt": fetched_at,
            "completeness": completeness,
        }
    elif tool_name == "search_token_market":
        rows = value.get("pairs")
        if not isinstance(rows, list) or len(rows) > 12:
            raise ProvenanceError("search_token_market pairs must be a bounded list")
        exact_address = clean_text(value.get("query"), 42).lower()
        pairs = []
        for row in rows:
            if not isinstance(row, dict) or str(row.get("chainId", "")).lower() != "robinhood":
                continue
            base, quote, pair_address = (
                row.get("baseToken"),
                row.get("quoteToken"),
                row.get("pairAddress"),
            )
            base = base if isinstance(base, dict) else {}
            quote = quote if isinstance(quote, dict) else {}
            if exact_address.startswith("0x") and len(exact_address) == 42:
                addresses = [
                    str(base.get("address", "")).lower(),
                    str(quote.get("address", "")).lower(),
                    str(pair_address or "").lower(),
                ]
                if exact_address not in addresses:
                    continue

            def numeric(value: Any) -> int | float | None:
                return (
                    value
                    if isinstance(value, (int, float))
                    and not isinstance(value, bool)
                    and abs(value) <= 1e100
                    else None
                )

            def token(value: dict[str, Any]) -> dict[str, str]:
                return {
                    key: clean_text(value.get(key), limit)
                    for key, limit in (("address", 64), ("name", 120), ("symbol", 40))
                }

            def metric_group(group: Any, keys: tuple[str, ...]) -> dict[str, int | float]:
                if not isinstance(group, dict):
                    return {}
                return {
                    key: number for key in keys if (number := numeric(group.get(key))) is not None
                }

            raw_info = row.get("info")
            info: dict[str, Any] = raw_info if isinstance(raw_info, dict) else {}
            websites = (
                info.get("websites", []) if isinstance(info.get("websites", []), list) else []
            )
            socials = info.get("socials", []) if isinstance(info.get("socials", []), list) else []
            pairs.append(
                {
                    "chainId": "robinhood",
                    "dexId": clean_text(row.get("dexId"), 80),
                    "url": public_url(row.get("url")),
                    "pairAddress": clean_text(pair_address, 80),
                    "baseToken": token(base),
                    "quoteToken": token(quote),
                    "priceUsd": clean_text(row.get("priceUsd"), 64),
                    "priceNative": clean_text(row.get("priceNative"), 64),
                    "fdv": numeric(row.get("fdv")),
                    "marketCap": numeric(row.get("marketCap")),
                    "pairCreatedAt": numeric(row.get("pairCreatedAt")),
                    "txns": {
                        period: metric_group(
                            row.get("txns", {}).get(period)
                            if isinstance(row.get("txns"), dict)
                            else None,
                            ("buys", "sells"),
                        )
                        for period in ("m5", "h1", "h6", "h24")
                    },
                    "volume": metric_group(row.get("volume"), ("m5", "h1", "h6", "h24")),
                    "priceChange": metric_group(row.get("priceChange"), ("m5", "h1", "h6", "h24")),
                    "liquidity": metric_group(row.get("liquidity"), ("usd",)),
                    "info": {
                        "websites": [
                            {
                                "label": clean_text(item.get("label"), 80),
                                "url": public_url(item.get("url")),
                            }
                            for item in websites[:8]
                            if isinstance(item, dict) and public_url(item.get("url"))
                        ],
                        "socials": [
                            {
                                "type": clean_text(item.get("type"), 32),
                                "url": public_url(item.get("url")),
                            }
                            for item in socials[:8]
                            if isinstance(item, dict) and public_url(item.get("url"))
                        ],
                    },
                }
            )
        value = {
            "query": clean_text(value.get("query"), 128),
            "chain": "robinhood",
            "pairs": pairs,
            "source": expected,
            "fetchedAt": fetched_at,
            "completeness": completeness,
        }
    else:
        raise ProvenanceError(f"{tool_name} is not an external tool")
    return value, {"source": expected, "fetchedAt": fetched_at, "completeness": completeness}


def _allowed_hosts() -> list[str]:
    return [urlparse(u).hostname or "" for u in settings().client_rpc_urls]


def client_config() -> dict[str, Any]:
    """What the browser is told. Endpoints only — never a credentialed URL.

    ``settings`` validates the allowlist at load time, so by the time a URL
    reaches this function it has already been checked for a key in the path, a
    query string, and userinfo credentials. That validation is the one whose
    failure is silent and total: a leaked provider key in a public bundle is
    permanent and invisible.
    """
    return {
        "chainId": CHAIN_ID,
        "endpoints": settings().client_rpc_urls,
        "maxBlockLag": settings().client_rpc_max_block_lag,
        # The contract audit's source fetch. Same rule as the endpoints above:
        # served from here rather than hardcoded in the bundle, and validated
        # keyless at settings load, because a URL that reaches the browser is a
        # URL that is public forever.
        "explorerApiUrl": settings().public_explorer_api_url,
    }
