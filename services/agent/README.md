# RobinCalls agent plane

The AI surface: MCP tools for external agents, the Robin Knight chat surface for
the website, and (next) the audit capability classifier. One tool registry, one
model seam, one trace id.

Design: [`docs/ways-of-work/plan/ai-plane/implementation-plan.md`](../../docs/ways-of-work/plan/ai-plane/implementation-plan.md).
Usage: [`docs/MCP.md`](../../docs/MCP.md).

---

## The one thing to understand

**The verdict engine is not here and will not move here.** `scanToken` stays in
TypeScript. A Python port would be a second scoring engine, and two engines that
disagree makes every ledger hash unverifiable — with no golden corpus to prove
equivalence against.

So this service owns the *tool layer*, and reaches back into Next for anything
that touches the database or the RPC pool:

```
  agents  ──► FastAPI  /mcp                              MCP Streamable HTTP
  browser ──► FastAPI  /agent/chat                       SSE, BYOK or our models
  FastAPI ──► Next     /api/internal/v1/read/<name>      tool backing
  FastAPI ──► Next     /api/internal/v1/scan             the scan pipeline
```

Two consequences that are easy to violate by accident:

- **No database access.** Domain tables belong to `lib/data/` (CLAUDE.md §1).
  New tables this service owns end to end (credits, conversations, rates) are
  fine; reaching into the scanner's tables is not.
- **No RPC client.** Circuit-breaker state is per-process, so a second pool
  would give two blind views of the same providers. Server-locale chain reads go
  through Next's pool.

---

## Layout

```
app/
  settings.py        typed env, fail-closed; validates the client RPC allowlist
  tools.toml         every tool: name, locale, read, cost, personas
  personas.toml      four personas; allowed_tools is enforcement, not docs
  registry.py        loads both, validates every cross-reference at import
  dispatch.py        the single tool-execution path shared by /mcp and /chat
  next_client.py     the ONLY egress to Next: auth + trace + timeout
  client_bridge.py   provenance verification for browser-computed results
  knowledge.py       file-backed prose + the startup coverage gate
  knowledge/         core.md (always loaded) · checks.md (behind lookup_check)
  citations.py       citation-or-silence, as a post-generation validator
  auth.py            one bearer check: is this caller us?
  llm/               the model seam — base.py + one file per provider
                     (anthropic.py, gemini.py). A third is one more file plus
                     one entry in settings.DEFAULT_MODELS.
  mcp.py  chat.py    the two surfaces
  trace.py           one X-RC-Trace-Id, threaded everywhere
  main.py            assembly + three startup gates
```

---

## Run it

```bash
pip install -e '.[dev]'

INTERNAL_JOB_SECRET=dev-secret \
NEXT_INTERNAL_BASE_URL=http://localhost:3000 \
uvicorn app.main:app --reload
```

It will refuse to start if `INTERNAL_JOB_SECRET` is unset, if Next is
unreachable, or if any live check lacks an explainer in `knowledge/checks.md`.
The last gate is waivable with `AGENT_SKIP_COVERAGE_GATE=1` — only to break a
cold-start deadlock, and it logs loudly.

```bash
ruff check .    # lint
mypy app        # types
pytest -q       # tests
```

The tests need no secret and no network: every egress is stubbed. A suite that
needed a real secret would be a suite that could reach production data.

---

## Adding a tool

Two files (three for a client-locale one), no codegen:

1. `lib/internal/reads.ts` — one entry calling an existing `lib/data/` function.
   Return the **full domain object**; never shape a payload there.
2. `app/tools.toml` — a `[[tool]]` block. The `description` *is* the
   model-facing documentation; there is no separate knowledge-base entry.
3. Client-locale only: an executor in `lib/agent/client-tools.ts`.

`tests/test_registry.py` fails CI on a typo in any cross-reference, in both
directions.

---

## The invariants the tests exist to hold

These are not style preferences. Each one maps to a wrong verdict this system
has already published, or to a way one could be published silently.

- **A failed lookup is not a finding.** Every payload carries `transient`, and
  an unrecognised failure defaults to transient — a wrong `True` costs a retry,
  a wrong `False` costs a false accusation.
- **An empty result is not a fact.** `found: false` is separate from `ok`, and
  carries a note saying so. "No deployer on record" and "this deployer is safe"
  are different sentences.
- **Nothing honeypot-shaped is client-executable.** viem throws identically for
  a revert and a timeout; `isTransientRpcError` lives server-side.
- **Client results are labelled, not trusted.** Wrong chain, missing block
  number, or a stale head is refused before the model sees it.
- **Citation-or-silence is a validator, not an instruction.** A sentence making
  a numeric claim no tool result supports is stripped whole.
- **A turn whose tools faulted transiently is not billable.**
- **`cost` is required and fail-closed**, so a new expensive tool cannot be
  metered as free by omission.
- **The persona allowlist is enforced in dispatch**, so the Interrogator cannot
  burn fresh-scan quota no matter what the model decides to do.
