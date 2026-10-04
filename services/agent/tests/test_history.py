"""Transcript trimming.

The bug worth preventing here is not "the conversation got long". It is the
*fix* for that going wrong: a naive front-trim splits a `tool_use` from its
`tool_result`, the Messages API rejects the request outright, and the symptom
only appears on long conversations that used tools — which is to say, in
production and not in anyone's manual test.
"""

from __future__ import annotations

from app.history import Trimmed, approx_tokens, trim


def user(text: str) -> dict:
    return {"role": "user", "content": text}


def assistant(text: str) -> dict:
    return {"role": "assistant", "content": [{"type": "text", "text": text}]}


def assistant_tool_use(call_id: str, name: str) -> dict:
    return {
        "role": "assistant",
        "content": [{"type": "tool_use", "id": call_id, "name": name, "input": {}}],
    }


def tool_result(call_id: str, payload: str) -> dict:
    return {
        "role": "user",
        "content": [{"type": "tool_result", "tool_use_id": call_id, "content": payload}],
    }


def test_a_short_transcript_is_returned_untouched() -> None:
    messages = [user("hi"), assistant("hello")]
    result = trim(messages, max_tokens=10_000)
    assert result.messages is messages
    assert not result.was_trimmed


def test_an_empty_transcript_is_handled() -> None:
    assert trim([], max_tokens=100) == Trimmed(messages=[], dropped=0, approx_tokens=0)


def test_the_oldest_turns_are_dropped_first() -> None:
    messages = [
        user("first " + "x" * 3_000),
        assistant("a1"),
        user("second"),
        assistant("a2"),
    ]
    result = trim(messages, max_tokens=200)
    assert result.was_trimmed
    assert result.messages[0]["content"] == "second"


def test_a_tool_use_is_never_split_from_its_result() -> None:
    """The whole reason this module exists. An orphan block is a hard 400."""
    messages = [
        user("old question " + "x" * 6_000),
        assistant_tool_use("tu_1", "get_verdict"),
        tool_result("tu_1", "{}"),
        assistant("answered"),
        user("new question"),
        assistant_tool_use("tu_2", "get_verdict"),
        tool_result("tu_2", "{}"),
    ]
    result = trim(messages, max_tokens=200)

    # The first surviving message must be a plain user turn — never an
    # assistant tool_use (its result would be the orphan) and never a
    # tool_result (its tool_use would be gone).
    first = result.messages[0]
    assert first["role"] == "user"
    assert isinstance(first["content"], str)

    # And every surviving tool_result still has its tool_use in the transcript.
    used = {
        b["id"]
        for m in result.messages
        if isinstance(m.get("content"), list)
        for b in m["content"]
        if isinstance(b, dict) and b.get("type") == "tool_use"
    }
    resulted = {
        b["tool_use_id"]
        for m in result.messages
        if isinstance(m.get("content"), list)
        for b in m["content"]
        if isinstance(b, dict) and b.get("type") == "tool_result"
    }
    assert resulted <= used, f"orphaned tool_result(s): {sorted(resulted - used)}"


def test_it_never_cuts_below_the_last_complete_turn() -> None:
    """One enormous tool result is irreducible — and must stay whole.

    Truncating it would hand the model a partial verdict that still looks
    complete, which is worse than the provider rejecting the request.
    """
    messages = [
        user("q1"),
        assistant("a1"),
        user("q2"),
        assistant_tool_use("tu_1", "get_verdict_evidence"),
        tool_result("tu_1", "y" * 200_000),
    ]
    result = trim(messages, max_tokens=100)
    assert result.messages[0]["content"] == "q2"
    assert len(result.messages[-1]["content"][0]["content"]) == 200_000


def test_a_transcript_with_no_turn_boundary_is_passed_through() -> None:
    """Malformed input: the provider's own error beats one we invented."""
    messages = [tool_result("tu_1", "z" * 50_000)]
    result = trim(messages, max_tokens=10)
    assert result.messages == messages
    assert not result.was_trimmed


def test_token_estimation_counts_structured_content() -> None:
    """Tool results are lists, not strings — len() on them would read as ~2."""
    assert approx_tokens([tool_result("tu_1", "q" * 3_000)]) > 900
