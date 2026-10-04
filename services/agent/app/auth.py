"""Who is calling — the one bearer check, shared by every surface.

There are exactly two kinds of caller here and the difference is not a role
hierarchy, it is a trust boundary:

- **public** — a browser. It holds the user's own provider key, never one of
  ours, so it cannot present a bearer and must never be asked to. Everything it
  can reach is bounded by the persona allowlist and the edge rate limit.
- **internal** — us. A caller presenting ``MCP_AUTH_TOKEN``: our own MCP client,
  an operator, or an admin surface.

The distinction exists because internal personas expose our *blind spots*.
``get_dex_registry`` answers "which venues can this scanner not discover", which
is a fix list for us and an evasion manual for everyone else. That answer must
not be one anonymous POST away, and a persona flagged internal is the mechanism
(see ``Persona.is_internal``).

Deliberately the same credential as the MCP surface rather than a second one.
Two secrets to rotate, where one of them is only used by a code path nobody
exercises weekly, is how a stale credential survives a rotation.
"""

from __future__ import annotations

import hmac

from fastapi import Request

from .settings import settings


def is_internal_caller(request: Request) -> bool:
    """True when the request carries the internal bearer token.

    Open only when no token is configured, and never in production:
    ``assert_serveable`` refuses to boot a production process without one, so
    the open branch is a development convenience that cannot ship. It is
    scoped to development on purpose — a missing secret must fail closed
    wherever it matters, and a `not token` check that returned True everywhere
    would turn an unset variable into a full internal grant.
    """
    token = settings().mcp_auth_token
    if not token:
        return not settings().is_production
    provided = request.headers.get("authorization", "")
    expected = f"Bearer {token}"
    # Constant-time: `==` on a secret leaks its prefix through response timing,
    # and these endpoints are reachable by anyone who can guess the hostname.
    return hmac.compare_digest(provided, expected)
