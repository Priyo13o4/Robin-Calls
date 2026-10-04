"""Typed configuration for the agent plane. Fail-closed by construction.

Two ideas run through this file.

**Absence is not permission.** ``INTERNAL_JOB_SECRET`` unset means no egress to
Next at all, not "skip the header" — mirroring ``requireJobAuth``'s own refusal
to serve when its secret is blank. Same for the MCP bearer token in production.

**A credentialed URL must never be handed to a browser.** ``RPC_ENDPOINTS_JSON``
on the Next side embeds an Alchemy key in a path and a Goldsky ``?secret=``
query. The browser-facing allowlist here is a *separate* variable, and every
entry is validated against the shapes a credential takes. This is the one
setting whose failure is silent and total, so it raises at import time rather
than at first use.
"""

from __future__ import annotations

import re
from functools import lru_cache
from urllib.parse import urlparse

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Robinhood Chain. Hardcoded, not configurable: a client RPC pointed at another
# chain returns plausible garbage for any address that exists on both, and
# making the guard tunable would make it possible to turn the guard off.
CHAIN_ID = 4663

#: Flipped to True when step 8 (credits/metering) lands — see
#: docs/ways-of-work/plan/ai-plane/credit-system.md.
#:
#: Until then `/agent/chat` has no caller identity and no quota: it is harmless
#: only because there is no model key to spend. The day one is set, that
#: endpoint becomes an unauthenticated, unmetered spend endpoint on our own
#: provider account — a state nobody would choose deliberately and exactly the
#: kind that arrives by adding one environment variable. So production refuses
#: the key rather than honouring it, and this constant is the one line step 8
#: flips. A module constant on purpose: an env var here could be set by the
#: same person, on the same day, for the same reason.
METERING_IMPLEMENTED = False

#: Per-provider default model, used when AGENT_MODEL is blank. Also the set of
#: provider names AGENT_PROVIDER validates against, so adding a provider here
#: and forgetting the validator is not possible.
DEFAULT_MODELS: dict[str, str] = {
    "anthropic": "claude-sonnet-5",
    # Flash-Lite: the cheapest tier with function calling, and a free tier
    # generous enough to exercise the whole loop without a bill.
    "gemini": "gemini-3.5-flash-lite",
}

_CREDENTIAL_HINT = re.compile(
    r"(api[-_]?key|apikey|secret|token|auth|password|access[-_]?key|bearer)",
    re.IGNORECASE,
)


class CredentialLeak(ValueError):
    """A URL bound for the browser looked like it carried a credential."""


def assert_keyless(url: str) -> str:
    """Reject any URL that could leak a provider credential to the browser.

    Deliberately paranoid and deliberately dumb. It rejects on *shape*, not on a
    list of known providers, because the next provider we add will not be on
    that list. A false rejection costs one config edit; a false acceptance ships
    a paid API key to every visitor's devtools, permanently.
    """
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise CredentialLeak(f"{url!r}: client RPC endpoints must be https.")
    if parsed.query:
        # Goldsky's form is `?secret=…`. No public RPC needs a query string, so
        # rejecting all of them is cheaper than trying to classify them.
        raise CredentialLeak(f"{url!r}: query strings are not allowed on a client RPC URL.")
    if parsed.username or parsed.password:
        raise CredentialLeak(f"{url!r}: userinfo credentials are not allowed.")
    if _CREDENTIAL_HINT.search(parsed.path):
        raise CredentialLeak(f"{url!r}: path looks like it contains a credential.")
    # Alchemy's form is `/v2/<32-hex-ish key>` — a long opaque final segment
    # with no vowels-and-slashes structure. Any path segment that looks like a
    # random token is treated as a key.
    for segment in parsed.path.strip("/").split("/"):
        if len(segment) >= 20 and re.fullmatch(r"[A-Za-z0-9_-]+", segment):
            raise CredentialLeak(
                f"{url!r}: path segment {segment!r} looks like an API key."
            )
    return url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", extra="ignore")

    # ── Egress to Next.js ────────────────────────────────────────────────────
    next_base_url: str = Field(default="http://app:3000", alias="NEXT_INTERNAL_BASE_URL")
    internal_job_secret: str = Field(default="", alias="INTERNAL_JOB_SECRET")
    #: A read is a database query behind a route; it should never take this long.
    next_read_timeout_s: float = Field(default=15.0, alias="AGENT_NEXT_READ_TIMEOUT_S")
    #: Must clear the scan pipeline's own ~180s terminal deadline, or an honest
    #: slow scan comes back as a transport fault and gets narrated as a finding
    #: about the token (implementation-plan §12.4/§12.5).
    next_scan_timeout_s: float = Field(default=200.0, alias="AGENT_NEXT_SCAN_TIMEOUT_S")

    # ── Surfaces ─────────────────────────────────────────────────────────────
    #: The operator kill switch on /mcp. Documented as "off → 404" in
    #: docs/MCP.md, README, the Phase 2a PRD and the admin capacity dashboard —
    #: and for one release it was true in none of them: nothing read the flag,
    #: the tile rendered "MCP server: off" while the endpoint served the
    #: internet, and an operator flipping it and redeploying changed nothing.
    #: A control that exists only in prose is worse than no control, because
    #: someone relies on it. Defaults OFF: absent means closed, and K1
    #: (per-caller identity, quota, revocation) is still open.
    enable_mcp: bool = Field(default=False, alias="ENABLE_MCP")
    mcp_auth_token: str = Field(default="", alias="MCP_AUTH_TOKEN")
    environment: str = Field(default="development", alias="AGENT_ENV")

    # ── Models (our-models path only; BYOK never reaches this process) ───────
    #
    # Two providers, one seam (llm.py). Which one runs is chosen by
    # AGENT_PROVIDER, or inferred from whichever key is set — inference exists
    # so the common case (one key, one provider) needs no second variable, and
    # the explicit setting exists so a host holding both keys is never
    # ambiguous about which one it is spending.
    anthropic_api_key: str = Field(default="", alias="ANTHROPIC_API_KEY")
    gemini_api_key: str = Field(default="", alias="GEMINI_API_KEY")
    agent_provider: str = Field(default="", alias="AGENT_PROVIDER")
    #: Blank means "the provider's default", resolved by the `model` property.
    #: A single AGENT_MODEL shared across providers cannot have one useful
    #: default: `claude-sonnet-5` sent to Gemini is a 404 at request time, not
    #: a config error at boot.
    agent_model: str = Field(default="", alias="AGENT_MODEL")
    #: How long to wait for one model response.
    #:
    #: 180s, not the 120s this started at, and measured rather than guessed:
    #: gemini-3.5-flash-lite on the free tier answered a 4,193-token request
    #: carrying 15 tool declarations in **173s** — twelve output tokens, a
    #: correct tool call, and a hard client timeout at 120s. Setting
    #: thinkingLevel=low made it *slower* (203s), so this is queueing latency,
    #: not reasoning time, and no prompt change fixes it.
    #:
    #: Sits under next_scan_timeout_s (200s) so the chain
    #: nginx 210 > agent 200 > model 180 stays ordered. Note the consequence: a
    #: turn needing two model rounds at that latency cannot fit, so a
    #: many-tool persona on a free tier is not viable for multi-round work.
    model_timeout_s: float = Field(default=180.0, alias="AGENT_MODEL_TIMEOUT_S")
    max_output_tokens: int = Field(default=2048, alias="AGENT_MAX_OUTPUT_TOKENS")
    #: Bounds a runaway agent loop. Each iteration can cost the user credits and
    #: our RPC budget, so the ceiling is enforced, not suggested (§10).
    max_tool_calls_per_turn: int = Field(default=8, alias="AGENT_MAX_TOOL_CALLS")
    #: Ceiling for `client`/`local` tool calls, which spend the user's own RPC
    #: or our CPU rather than our database. Higher on purpose: this one is a
    #: runaway-loop bound, not cost control, and a single client-side contract
    #: audit legitimately needs a dozen reads. See TurnBudget.exhausted.
    max_free_tool_calls_per_turn: int = Field(default=40, alias="AGENT_MAX_FREE_TOOL_CALLS")
    #: Which prompt produced a stored answer. Reset to 1 at release — the 2-12
    #: bumps were pre-release churn and mean nothing to a reader now.
    #: Edit HERE on any change under app/knowledge/ or personas.toml. Never pin
    #: it in an env file: the pin outlives the edit, so the new prompt ships
    #: wearing the old number — the one thing this value exists to prevent.
    prompt_version: str = Field(default="6", alias="PROMPT_VERSION")
    #: Ceiling on the transcript handed to the model, in approximate tokens.
    #: Well under any current context window on purpose: the window is not the
    #: budget, cost is. Every turn re-sends the whole history, so an unbounded
    #: transcript is a bill that grows quadratically over a conversation.
    max_history_tokens: int = Field(default=24_000, alias="AGENT_MAX_HISTORY_TOKENS")

    # ── Client-side RPC (browser executes; we only publish the allowlist) ────
    public_client_rpc_urls: str = Field(
        default="https://rpc.mainnet.chain.robinhood.com",
        alias="PUBLIC_CLIENT_RPC_URLS",
    )
    #: How far behind the known head a client-reported block may be before its
    #: result is refused. A client RPC lagging silently returns confidently
    #: stale data with no error (§7).
    client_rpc_max_block_lag: int = Field(default=200, alias="CLIENT_RPC_MAX_BLOCK_LAG")
    #: Where the browser fetches VERIFIED SOURCE for a client-side contract
    #: audit. Blockscout serves `access-control-allow-origin: *` and rate-limits
    #: per IP, so a browser read spends the visitor's explorer budget rather
    #: than ours — better for us than the server path, not worse.
    #:
    #: Held to the same keyless validation as the RPC allowlist. Blockscout
    #: needs no credential today, and that is exactly why the check has to be
    #: here: the day someone points this at a keyed explorer, the key ships to
    #: every visitor's devtools permanently.
    public_explorer_api_url: str = Field(
        default="https://robinhoodchain.blockscout.com/api/v2",
        alias="PUBLIC_EXPLORER_API_URL",
    )

    @field_validator("public_client_rpc_urls")
    @classmethod
    def _no_credentials(cls, value: str) -> str:
        for url in [u.strip() for u in value.split(",") if u.strip()]:
            assert_keyless(url)
        return value

    @field_validator("public_explorer_api_url")
    @classmethod
    def _explorer_is_keyless(cls, value: str) -> str:
        return assert_keyless(value.strip())

    @property
    def client_rpc_urls(self) -> list[str]:
        return [u.strip() for u in self.public_client_rpc_urls.split(",") if u.strip()]

    @field_validator("agent_provider")
    @classmethod
    def _known_provider(cls, value: str) -> str:
        name = value.strip().lower()
        if name and name not in DEFAULT_MODELS:
            raise ValueError(
                f"AGENT_PROVIDER={value!r} is not one of {sorted(DEFAULT_MODELS)}"
            )
        return name

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def provider(self) -> str:
        """Explicit wins; otherwise infer from whichever key is present.

        Order matters when both keys are set and AGENT_PROVIDER is not:
        Anthropic first, because that is the documented our-models provider and
        silently switching a billed path on the basis of variable ordering
        would be the wrong kind of surprise.
        """
        if self.agent_provider:
            return self.agent_provider
        if self.anthropic_api_key:
            return "anthropic"
        if self.gemini_api_key:
            return "gemini"
        return "anthropic"

    @property
    def model(self) -> str:
        return self.agent_model.strip() or DEFAULT_MODELS[self.provider]

    @property
    def our_models_key(self) -> str:
        """The key for the selected provider — never the other one's."""
        return {
            "anthropic": self.anthropic_api_key,
            "gemini": self.gemini_api_key,
        }[self.provider]

    @property
    def our_models_enabled(self) -> bool:
        """No key means the our-models path is off — not that it runs unkeyed."""
        return bool(self.our_models_key)

    def assert_serveable(self) -> None:
        """Refuse to boot in a configuration that would fail silently later."""
        if not self.internal_job_secret.strip():
            raise RuntimeError(
                "INTERNAL_JOB_SECRET is unset. Every tool read goes to Next.js "
                "behind requireJobAuth, which fails closed — the agent would "
                "start and then 401 on every call."
            )
        if self.is_production and self.enable_mcp and not self.mcp_auth_token.strip():
            raise RuntimeError(
                "ENABLE_MCP is on but MCP_AUTH_TOKEN is unset in production. "
                "/mcp would be an open, unmetered surface onto the scan "
                "pipeline. Generate one with: openssl rand -hex 32"
            )
        if not self.client_rpc_urls:
            raise RuntimeError(
                "PUBLIC_CLIENT_RPC_URLS is empty. Client-locale tools would have "
                "no endpoint and would silently fall back to server execution, "
                "spending our RPC budget on free-tier traffic."
            )
        # Gated on `our_models_enabled`, never on one named key. Written as
        # `self.anthropic_api_key` this guard grew a hole the moment a second
        # provider landed: setting GEMINI_API_KEY in production would have
        # booted straight past it into exactly the state it exists to prevent.
        # A tripwire that names one instance of the thing it guards stops being
        # a tripwire as soon as there are two.
        if self.is_production and self.our_models_enabled and not METERING_IMPLEMENTED:
            raise RuntimeError(
                f"A provider key is set ({self.provider}) but metering is not "
                "implemented. /agent/chat has no caller identity and no quota, "
                "so this key would be spendable by anyone who can reach the "
                "site. Land the credit system and set METERING_IMPLEMENTED = "
                "True, or unset the key and leave our-models off."
            )


@lru_cache(maxsize=1)
def settings() -> Settings:
    return Settings()
