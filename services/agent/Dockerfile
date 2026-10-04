# ─────────────────────────────────────────────────────────────
# RobinCalls agent plane — MCP tools, the chat surface, and (later)
# the audit capability classifier.
#
# Build context is `services/agent`, NOT the repo root: this image needs none
# of the Next.js tree, and a repo-root context would ship the whole thing into
# the layer cache and invalidate it on every unrelated frontend commit.
# ─────────────────────────────────────────────────────────────

FROM python:3.12-slim-bookworm AS builder
WORKDIR /build

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_NO_CACHE_DIR=1

# Dependencies resolve from pyproject.toml alone, so this layer is cached until
# the dependency list itself changes — not on every source edit.
#
# Two wrinkles, both from `[tool.setuptools] packages = […]` in pyproject:
#
#   - setuptools needs every listed package directory to EXIST to build a
#     wheel, and the real source is deliberately not here yet. Hence the empty
#     placeholders — one per entry in `packages`. Adding `app.llm` there
#     without adding it here failed the build outright, which is the good
#     outcome: the alternative is a silently incomplete wheel.
#   - the resulting stub `app` package would then sit in site-packages while
#     the real one arrives at /srv/app in the runtime stage — two importable
#     `app` packages, resolved by sys.path order, which is precisely the kind
#     of thing that works until it doesn't. So it is uninstalled immediately;
#     that drops the stub and keeps every resolved dependency.
COPY pyproject.toml ./
RUN mkdir -p app/llm && touch app/__init__.py app/llm/__init__.py \
 && python -m venv /opt/venv \
 && /opt/venv/bin/pip install --upgrade pip \
 && /opt/venv/bin/pip install . \
 && /opt/venv/bin/pip uninstall -y robincalls-agent

# ── Runtime ──
FROM python:3.12-slim-bookworm AS runner
WORKDIR /srv

ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

RUN groupadd --system --gid 1001 agent \
 && useradd --system --uid 1001 --gid agent agent

COPY --from=builder /opt/venv /opt/venv
COPY --chown=agent:agent app ./app

USER agent
EXPOSE 8000

# One worker per container. Scaling is horizontal (the process is stateless —
# no session store, conversation state rides the request), and multiple workers
# in one container would multiply the httpx connection pool against Next while
# hiding it behind a single container's metrics.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
