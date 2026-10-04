"""Diagnostics carry shape, never content.

Conversations are deliberately not stored — the browser holds every transcript,
for our-models and BYOK alike. The risk this file guards is that we rebuild
that store by accident, one convenient field at a time, in a log. Every test
below is about the boundary rather than the numbers.
"""

from __future__ import annotations

import pytest

from app.telemetry import TelemetryLeak, TurnDiagnostics, _assert_clean, emit, set_sink


def turn(**overrides) -> TurnDiagnostics:
    diag = TurnDiagnostics(
        surface="chat",
        persona="interrogator",
        prompt_version="1",
        model="claude-sonnet-5",
        trace_id="abc123",
    )
    for key, value in overrides.items():
        setattr(diag, key, value)
    return diag


def test_a_normal_record_is_clean() -> None:
    diag = turn(input_tokens=1_400, cache_read_tokens=1_200, stripped_claims=0)
    diag.record_tool("get_verdict", "found")
    diag.record_tool("lookup_deployer", "empty")
    record = diag.as_record()
    _assert_clean(record)
    assert record["toolCalls"] == {"get_verdict": 1, "lookup_deployer": 1}
    assert record["toolOutcomes"] == {"empty": 1, "found": 1}
    assert record["cacheHit"] is True


def test_an_address_anywhere_in_the_record_is_refused() -> None:
    """Which address someone asked about is a statement about that person.

    A tool argument is the obvious way this leaks — someone adds `args` to the
    record "just for debugging" and the log becomes a browsing history.
    """
    diag = turn()
    diag.tool_calls["get_verdict:0x" + "a" * 40] = 1
    with pytest.raises(TelemetryLeak, match="address"):
        _assert_clean(diag.as_record())


def test_message_length_text_is_refused() -> None:
    diag = turn(persona="x" * 400)
    with pytest.raises(TelemetryLeak, match="chars"):
        _assert_clean(diag.as_record())


def test_a_nested_address_is_caught() -> None:
    """The scan is over the serialized record, so nesting depth is irrelevant."""
    record = turn().as_record()
    record["debug"] = {"context": [{"token": "0x" + "f" * 40}]}
    with pytest.raises(TelemetryLeak):
        _assert_clean(record)


def test_the_record_contains_no_transcript_fields() -> None:
    """A structural check: nothing message-shaped is even in the schema."""
    record = turn().as_record()
    forbidden = {"messages", "content", "text", "prompt", "question", "answer", "args",
                 "arguments", "value", "result", "wallet", "address", "ip", "apiKey"}
    assert not (forbidden & set(record)), f"content-shaped field(s): {forbidden & set(record)}"


def test_a_leak_drops_the_line_instead_of_failing_the_turn() -> None:
    """`emit` must never raise into a user's conversation.

    A diagnostics bug taking down chat would invert the entire point. The
    record is dropped and logged; losing one line beats logging content.
    """
    emitted: list[dict] = []
    set_sink(emitted.append)
    try:
        diag = turn()
        diag.tool_calls["0x" + "b" * 40] = 1
        emit(diag)  # must not raise
        assert emitted == [], "a leaking record must not reach the sink"
    finally:
        set_sink(lambda record: None)


def test_a_clean_record_reaches_the_sink() -> None:
    emitted: list[dict] = []
    set_sink(emitted.append)
    try:
        emit(turn(output_tokens=120))
        assert len(emitted) == 1
        assert emitted[0]["event"] == "agent.turn"
        assert emitted[0]["outputTokens"] == 120
    finally:
        set_sink(lambda record: None)


def test_trace_ids_can_be_switched_off(monkeypatch: pytest.MonkeyPatch) -> None:
    """Included by default because it is how you debug one report — but it is
    joinable to a scan, so it is pseudonymous and must be droppable."""
    assert "traceId" in turn().as_record()
    monkeypatch.setenv("AGENT_TELEMETRY_TRACE_IDS", "0")
    assert "traceId" not in turn().as_record()


def test_provenance_rejections_are_counted_by_reason() -> None:
    """Two different operational problems that must not be one number."""
    diag = turn()
    diag.record_provenance_rejection("stale")
    diag.record_provenance_rejection("stale")
    diag.record_provenance_rejection("wrong_chain")
    assert diag.as_record()["provenanceRejections"] == {"stale": 2, "wrong_chain": 1}


def test_the_cache_signal_survives_to_the_record() -> None:
    """The §16 validation gate: caching that silently is not happening looks
    exactly like caching that is."""
    assert turn(cache_read_tokens=0, input_tokens=2_000).as_record()["cacheHit"] is False
    assert turn(cache_read_tokens=1_800).as_record()["cacheHit"] is True
