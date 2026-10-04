"""FastAPI application assembly and the startup gates.

Everything that can be checked at boot is checked at boot. A misconfiguration
that surfaces on the thousandth request instead of at startup is a
misconfiguration that reaches users first.

Three gates, in order of what they protect:

1. ``assert_serveable`` — refuses to start without the internal secret, without
   an MCP token in production, or with an empty client-RPC allowlist. Each of
   those failures is silent at every layer if allowed through.
2. **Check coverage** — fetches live ``get_methodology`` and refuses to start
   if any check the engine can publish has no explainer. Against live config,
   not a build-time snapshot, so it reacts to what this deployment actually
   runs.
3. **Registry integrity** — every cross-reference in ``tools.toml`` and
   ``personas.toml`` resolves. This one runs at import, so it fails even
   earlier.

Gate 2 is the one that can be temporarily waived (``AGENT_SKIP_COVERAGE_GATE``)
because it depends on Next being reachable, and a chicken-and-egg during a
cold cluster start should not be unfixable. It logs loudly when waived.
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from . import chat, codes, mcp
from .knowledge import KnowledgeGapError, assert_check_coverage, knowledge
from .next_client import next_client
from .registry import registry
from .settings import settings
from .trace import TraceMiddleware, configure_logging, new_trace_id

log = logging.getLogger("agent.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging(os.getenv("LOG_LEVEL", "INFO"))
    cfg = settings()
    cfg.assert_serveable()

    reg = registry()  # raises on any unresolved cross-reference
    log.info(
        "agent.registry_loaded",
        extra={"tools": len(reg.tools), "personas": len(reg.personas)},
    )

    if not cfg.our_models_enabled:
        # Deliberately not a boot failure — BYOK-only is a legitimate way to run
        # this service. But it is a degraded state that every other signal
        # reports as healthy: /health and /health/ready both stay green while
        # every our-models chat returns MODEL_UNAVAILABLE. Say it once, loudly,
        # where an operator reading the boot log will see it.
        log.warning(
            "agent.our_models_disabled — ANTHROPIC_API_KEY is unset, so every "
            "our-models chat turn will return MODEL_UNAVAILABLE. BYOK is "
            "unaffected. This is not reflected in /health."
        )

    if os.getenv("AGENT_SKIP_COVERAGE_GATE") == "1":
        log.warning(
            "agent.coverage_gate_skipped — the agent may answer 'I have no "
            "information on that check' for a live check. Unset "
            "AGENT_SKIP_COVERAGE_GATE before serving real traffic."
        )
    else:
        result = await next_client().read("get_methodology", {}, new_trace_id())
        if not result.ok:
            raise RuntimeError(
                "Could not reach Next.js to verify check coverage "
                f"({result.code}: {result.error}). The agent refuses to start "
                "unverified — set AGENT_SKIP_COVERAGE_GATE=1 only to break a "
                "cold-start deadlock."
            )
        assert_check_coverage(result.value or {})
        log.info("agent.coverage_gate_passed", extra={"explainers": len(knowledge().checks)})

    yield

    await next_client().aclose()


app = FastAPI(
    title="RobinCalls agent plane",
    version="1.0.0",
    lifespan=lifespan,
    # No docs surface in production: it enumerates every route on a service
    # whose whole security model is "nothing here is publicly interesting".
    docs_url=None if settings().is_production else "/docs",
    openapi_url=None if settings().is_production else "/openapi.json",
)

app.add_middleware(TraceMiddleware)
app.include_router(mcp.router)
app.include_router(chat.router)


@app.get("/health")
async def health() -> JSONResponse:
    """Liveness only — deliberately does not call Next.

    A health check that fails when a dependency is down turns one outage into
    two: the orchestrator restarts a perfectly healthy container, and the
    restart cannot fix the dependency. Dependency health belongs in
    /health/ready, which nothing restarts on.
    """
    return JSONResponse({"ok": True, "service": "agent"})


@app.get("/health/ready")
async def ready() -> JSONResponse:
    result = await next_client().read("get_methodology", {}, new_trace_id())
    return JSONResponse(
        {
            "ok": result.ok,
            "next": "reachable" if result.ok else "unreachable",
            "code": result.code,
        },
        status_code=200 if result.ok else 503,
    )


@app.exception_handler(KnowledgeGapError)
async def knowledge_gap_handler(_request, exc: KnowledgeGapError) -> JSONResponse:
    return JSONResponse({"error": str(exc), "code": codes.KNOWLEDGE_GAP}, status_code=500)
