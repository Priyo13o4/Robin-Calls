# RobinCalls

A token safety scanner for Robinhood Chain (chain id 4663). It reads a token
contract and its pools directly from the chain, runs a fixed battery of checks
over what it finds, and publishes a verdict with the evidence behind every
claim.

The design rule the whole codebase is built around: **a failed probe is not a
negative result.** An RPC timeout must never become "this token is safe", and an
empty result must never become a sentence about the token. Most of the structure
here exists to keep those two apart.

## Stack

- Next.js 16 (App Router), TypeScript, Tailwind
- Postgres via Drizzle, pgbouncer, Valkey
- A separate FastAPI service (`services/agent/`) that explains verdicts and
  never produces them. It owns no database and no RPC pool; its only egress is
  back into Next through an internal read contract.
- Foundry contracts under `contracts/`

## Layout

| Path | Owns |
| --- | --- |
| `lib/data/` | Every database access. Nothing else touches a connection. |
| `lib/scanner/`, `lib/audit/`, `lib/dex/` | The checks, the contract audit, DEX plumbing |
| `lib/rpc/` | Pooled providers, fault classification, multicall |
| `lib/security/` | Auth, rate limits, SSRF guards |
| `app/` | Routes and pages, kept thin |
| `services/agent/` | The AI plane, in Python |
| `tests/` | `node:test`, no database and no network |

## Note

Some modules are not included in this repository. Their exports and types are kept so
the app compiles and the UI runs, but scans and swaps need those modules to work.

## Running it

```bash
cp .env.example .env.local
```

Fill in `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `BETTER_AUTH_SECRET`,
`INTERNAL_JOB_SECRET` and `MCP_AUTH_TOKEN` with any values you
like. Two more need a non-empty placeholder even though the services that use
them are not started below, because Docker Compose interpolates the whole file
before it decides what to run: `CLOUDFLARE_TUNNEL_TOKEN` and `GHCR_PAT`.

```bash
docker compose --env-file .env.local \
  -f docker-compose.yml -f docker-compose.local.yml \
  up --build postgres pgbouncer valkey app agent nginx
```

Naming the services is deliberate: it leaves out the Cloudflare tunnel, which
only exists to expose a deployment. The app is then on http://localhost:3000.

The schema is not part of this repository, so the app starts against an empty
database and stays there. That is a supported state rather than a crash: every
function in `lib/data/` returns its documented empty value when the query finds
nothing, and the UI renders the empty case. You get a running app and a browsable
codebase, not populated verdicts.

## Verification

```bash
npm install
npx tsc --noEmit
```
