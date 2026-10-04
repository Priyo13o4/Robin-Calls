"""Citation-or-silence, enforced after generation rather than asked for before it.

The rule: every number the model states must appear in a tool result it
received during this turn. This is the one hallucination class that is
brand-fatal — RobinCalls sells a deterministic, re-derivable verdict, and an
invented score attached to that promise is worse than no chatbot.

It is a validator, not an instruction, because an instruction is a request and
this needs to be a guarantee. The prompts ask as well; that reduces how often
this fires, and does not replace it.

**Design bias: strip, do not rewrite.** A sentence carrying an unsupported
number is removed whole. Rewriting it would mean generating replacement text
that itself needs validating, and a partially-edited sentence can invert its
own meaning — dropping "not" from "liquidity is not locked" is a worse outcome
than dropping the sentence.

Deliberately narrow. It checks *numeric* claims, because those are what a
verdict is made of and what a reader will act on. It does not attempt to
validate prose claims; that would need a second model and would fail in both
directions.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

#: A number worth checking. Percentages, scores, dollar amounts, block heights,
#: counts. Deliberately catches thousands separators and decimals.
_NUMBER = re.compile(r"(?<![\w.])(\d[\d,]*(?:\.\d+)?)(?![\w])")

#: Sentence split that does not break on decimals, ellipses, or `0x…` hex.
#:
#: A NEWLINE is a boundary too, and leaving it out was a real defect rather than
#: a nicety. The rule only broke on ``[.!?]`` followed by a capital, so a
#: markdown block — a heading, then bullets starting with ``*`` or ``-`` — was
#: one enormous "sentence", and a single uncitable number deleted the whole
#: section. Observed live: an answer about proxy patterns ended at a bare
#: "### 4." because the paragraph under it mentioned EIP-2535. Stripping is
#: supposed to cost a claim, not a chapter.
_SENTENCE = re.compile(r"(?<=[.!?])\s+(?=[A-Z(\[])|\n+")

#: Standards, versions and list ordinals are NAMES that happen to be spelled
#: with digits — the same category as the ``0x…`` hex already scrubbed below,
#: and no more a measurement than "Route 66" is a distance.
#:
#: Leaving them in the number stream made the Robin Knight unable to say
#: "EIP-1167" or "ERC-4626" at all: ``_ALWAYS_ALLOWED`` happened to list 1967,
#: 20, 721 and 1155, so four standards were sayable and every other one was
#: censored. An allowlist of individual standards is a list that is wrong the
#: day the next one ships; matching the FORM is not.
_IDENTIFIER_FORMS = (
    # EIP-1167, ERC 4626, BIP32, SLIP-44
    re.compile(r"\b(?:eip|erc|bip|slip)[\s\-_]?\d+\b", re.IGNORECASE),
    # v3, V2, v0.8.28+commit.7893614a
    re.compile(r"\bv\d+(?:\.\d+)*(?:\+[\w.]+)?\b", re.IGNORECASE),
    # Solidity 0.8.28 / uint256 / bytes32 / int128 — type names and compilers
    re.compile(r"\b(?:uint|int|bytes)\d+\b", re.IGNORECASE),
    # Markdown structure: "### 4." headings and "3." list ordinals
    re.compile(r"(?m)^\s{0,3}#{1,6}\s*\d+[.)]?"),
    re.compile(r"(?m)^\s{0,3}\d+[.)]\s"),
)

#: Numbers that are not claims about the chain. Small integers appear in
#: ordinary prose ("two things to note", "one hop away") far more often than
#: they appear as findings, and flagging them would strip readable English
#: while catching nothing. A fabricated score is never in this set.
_UNREMARKABLE = {"0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "100"}

#: Years and the chain id read as numbers but are context, not measurements.
_ALWAYS_ALLOWED = {"4663", "1967", "20", "721", "1155"}


@dataclass
class Citations:
    """Every numeric token that appeared in this turn's tool results."""

    values: set[str] = field(default_factory=set)

    def add_result(self, payload: Any) -> None:
        """Harvest numbers from one tool result, at any nesting depth.

        Harvesting from the serialized JSON rather than walking typed fields is
        intentional: a new tool returning a new shape is covered the day it
        ships, with no registration step to forget. The cost is that this is
        permissive — a number appearing anywhere in any result satisfies a
        claim. That is the right bias. This validator exists to catch invention
        out of nothing, not to police which of several real numbers was quoted.
        """
        for token in _numbers_in(json.dumps(payload, default=str)):
            self.values.add(token)
            self.values.add(_canonical(token))

    def supports(self, token: str) -> bool:
        canonical = _canonical(token)
        if canonical in self.values or token in self.values:
            return True
        # A rounded quote of a supported number is still supported: a model
        # saying "about 72" of a score stored as 72.0, or "$1.2M" of 1234567.
        return any(_rounds_to(canonical, known) for known in self.values)


@dataclass
class Validation:
    text: str
    stripped: list[str]

    @property
    def clean(self) -> bool:
        return not self.stripped


def _canonical(token: str) -> str:
    value = token.replace(",", "")
    if "." in value:
        value = value.rstrip("0").rstrip(".")
    return value or "0"


def _rounds_to(claim: str, known: str) -> bool:
    try:
        a, b = float(claim), float(known)
    except ValueError:
        return False
    if a == b:
        return True
    if b == 0:
        return False
    # Within 1% covers honest rounding and unit-scaling in prose; it does not
    # cover a different number.
    return abs(a - b) / abs(b) <= 0.01


def _numbers_in(text: str) -> Iterable[str]:
    for match in _NUMBER.finditer(text):
        yield match.group(1)


def unsupported_numbers(sentence: str, citations: Citations) -> list[str]:
    found: list[str] = []
    # Hex strings (addresses, hashes) are identifiers, not measurements, and
    # their digits would otherwise read as claims.
    scrubbed = re.sub(r"0x[0-9a-fA-F]+", " ", sentence)
    for form in _IDENTIFIER_FORMS:
        scrubbed = form.sub(" ", scrubbed)
    for token in _numbers_in(scrubbed):
        canonical = _canonical(token)
        if canonical in _UNREMARKABLE or canonical in _ALWAYS_ALLOWED:
            continue
        if not citations.supports(token):
            found.append(token)
    return found


def _segments(text: str) -> list[tuple[str, str]]:
    """Split into (body, separator) pairs so the separator can be put back.

    ``re.split`` throws the delimiter away, which is fine when everything is
    rejoined with a space and wrong the moment the text is markdown.
    """
    out: list[tuple[str, str]] = []
    position = 0
    for match in _SENTENCE.finditer(text):
        out.append((text[position : match.start()], match.group(0)))
        position = match.end()
    out.append((text[position:], ""))
    return out


def validate(text: str, citations: Citations) -> Validation:
    """Strip sentences making numeric claims no tool result supports."""
    if not text.strip():
        return Validation(text=text, stripped=[])

    kept: list[str] = []
    stripped: list[str] = []

    # Each piece is carried with the whitespace that FOLLOWED it, and rejoined
    # with that whitespace intact. The old ``" ".join(...)`` normalised every
    # separator to a single space, which flattened headings and bullet lists
    # onto one line — a reply the validator had passed came out mangled anyway,
    # and now that newlines are boundaries it would mangle every list.
    for body, separator in _segments(text):
        bad = unsupported_numbers(body, citations)
        if bad:
            stripped.append(body.strip())
            continue
        kept.append(body + separator)

    result = "".join(kept).strip()

    if stripped and not result:
        # Everything failed. Refusing is correct: a reply assembled entirely
        # from invented numbers has no salvageable remainder, and returning
        # empty text would read as a system glitch rather than a refusal.
        result = (
            "I can't answer that from what the tools returned — the numbers I "
            "would need aren't in the record I was given. Try asking for a "
            "specific verdict or check, and I'll quote what's actually stored."
        )

    return Validation(text=result, stripped=stripped)
