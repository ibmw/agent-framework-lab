"""The table the judge editor's rubric line is held to.

`apps/web/src/lib/rubric.ts` says, while an author types, which reserved terms the rubric
names — the terms `rubric_names_an_arm` refuses at publication. It has to name exactly the
terms the gate would: a line that misses one lets the author meet it only at Publish, and a
line that names one the gate lets through is a refusal the lab never makes.

So `fixtures/rubric_mentions.json` is written from this side and read from both:

- `reserved_terms` and `rubrics` are what the gate itself answers, rubric by rubric, and
  `apps/web/src/lib/rubric.test.ts` holds `namedTerms` to `named`;
- `assigned`, `word` and `cased` enumerate the two things `_mentions` leaves to Python's
  `re` — which characters `[\\w-]` holds, and which characters `re.IGNORECASE` treats as one —
  over every code point Python's Unicode database assigns, so the web suite can prove its
  pattern reproduces both everywhere rather than at the handful of characters anyone thought
  of.

The web suite reads `_mentions`' own pattern out of `judge_capabilities.py`, so a change to
the pattern fails there; a change to the reserved terms fails here on any Python. The
character tables are compared only on a Python whose Unicode database is the fixture's
`unicode_version` — the repository pins no Python, and another database assigns and cases other
characters — and are skipped, naming both versions, anywhere else. The 55 rubric rows use only
characters both Unicode 15 and 16 assign alike, and run on every Python. When the Unicode
version the lab runs on moves, regenerate on that Python: `uv run python
apps/api/tests/test_rubric_mentions.py`, then `pnpm exec biome format --write
apps/api/tests/fixtures/rubric_mentions.json`; never by hand.
"""

from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path
from typing import Any

import pytest

from capability_lab.application.judge_capabilities import (
    judge_capability_issues,
    reserved_rubric_terms,
)
from judge_factories import publishable_judge

FIXTURE = Path(__file__).parent / "fixtures" / "rubric_mentions.json"

# Each rubric is inner text only: a rubric with surrounding whitespace is refused at the write
# (`require_text`), so the gate never sees one.
RUBRICS: tuple[str, ...] = (
    # A term standing alone, and inside something longer on either side.
    "Prefer the fake arm.",
    "fake",
    "The agent is fake-friendly.",
    "A pre-fake answer.",
    "A faker answer, an unfake one, a fake_arm, fake2 and 2fake.",
    "The fakery ends here, and so does the fake.",
    # Punctuation that is not a word character on either side.
    "(fake) [fake] {fake} 'fake' \"fake\" fake, fake; fake: fake! fake?",
    "Fake's reply, fake\u2019s reply.",
    "fake\u2014or not; fake\u2013maybe; fake\u2010ish; fake/other; fake.",
    "a\tfake\nb",
    "fake\u00a0arm",
    # Case, including the characters Python folds onto ASCII letters.
    "FAKE and Fake and fAkE.",
    "FA\u212aE",
    "OPENAI-AGENT\u017f",
    "GPT-5-M\u0130N\u0130",
    "gpt-5-m\u0131n\u0131",
    "openA\u0131",
    # Unicode word characters beside a term.
    "fake\u00e9 and \u00e9fake",
    "fake\u0301",
    "fake\u00b2",
    "fake\u0663",
    "fake\u2163",
    "\U0001d400fake",
    "fake\U0001d7d9",
    "\ufb01fake",
    "\u4e2dfake\u4e2d",
    "\u4e2d fake \u4e2d",
    # Hyphenated terms, and a hyphen that makes a term part of a longer one.
    "gpt-5-mini",
    "GPT-5-MINI.",
    "gpt-5-mini-2",
    "gpt-5-minis",
    "gpt-5",
    "gpt 5 mini",
    "the pydantic-ai arm",
    "the pydantic-ai-arm",
    "Pydantic AI",
    "pydantic ai",
    "Pydantic  AI",
    "Pydantic\nAI",
    "PydanticAI",
    "Pydantic-AI",
    "Pydantic AIs",
    "the openai-agents framework",
    "OpenAI Agents SDK",
    "openai agents sdk.",
    "OpenAI Agents SDKs",
    "openai.com",
    "OpenAI's model",
    "openaiagents",
    # Terms that contain other terms.
    "the deterministic fake arm",
    "the deterministic-fake arm",
    "nondeterministic",
    "deterministically",
    "Deterministic.",
    # A rubric that names nothing.
    "Score whether the order ships to the confirmed address.",
)

NAMES_AN_ARM = (
    "the rubric names {term}, and a judge is shown no such thing: the brief carries what the "
    "arm did, never what ran it"
)


def _named(rubric: str) -> list[str]:
    """The reserved terms the gate names in this rubric, in the order it names them."""
    prefix, suffix = NAMES_AN_ARM.split("{term}")
    return [
        issue.message.removeprefix(prefix).removesuffix(suffix)
        for issue in judge_capability_issues(publishable_judge(rubric=rubric))
        if issue.code == "rubric_names_an_arm"
    ]


def _ranges(points: list[int]) -> list[list[int]]:
    """Consecutive code points folded into inclusive `[first, last]` ranges."""
    ranges: list[list[int]] = []
    for point in points:
        if ranges and ranges[-1][1] == point - 1:
            ranges[-1][1] = point
        else:
            ranges.append([point, point])
    return ranges


def _code_points() -> list[int]:
    """Every code point a Python string can hold on its own and the database assigns."""
    return [
        point
        for point in range(0x110000)
        if not 0xD800 <= point <= 0xDFFF and unicodedata.category(chr(point)) != "Cn"
    ]


def _is_cased(character: str) -> bool:
    return (
        character.lower() != character
        or character.upper() != character
        or character.casefold() != character
        or character.title() != character
    )


def _case_classes(points: list[int]) -> list[list[int]]:
    """Every cased code point, grouped by what `re.IGNORECASE` matches it to.

    Pairwise over the cased points, because that is what the engine answers — not what a
    case-mapping table says it ought to — and the answer is not symmetric by construction.
    Grouped into classes and checked to be classes: a relation that failed to be one would
    not be describable here, and the fixture would say so rather than approximate it.
    """
    cased = [point for point in points if _is_cased(chr(point))]
    matches: dict[int, set[int]] = {}
    for point in cased:
        pattern = re.compile(re.escape(chr(point)), re.IGNORECASE)
        matches[point] = {other for other in cased if pattern.fullmatch(chr(other))}
    classes: list[list[int]] = []
    seen: set[int] = set()
    for point in cased:
        if point in seen:
            continue
        members = matches[point]
        if any(matches[member] != members for member in members):
            raise AssertionError(f"re.IGNORECASE is not an equivalence at U+{point:04X}")
        classes.append(sorted(members))
        seen |= members
    return classes


def build_tables() -> dict[str, Any]:
    points = _code_points()
    word = re.compile(r"[\w-]")
    return {
        "_comment": (
            "What the rubric-anonymity gate answers, for the judge editor to be held to. "
            "`rubrics` are judge_capability_issues' own answers over `reserved_terms`; "
            "`assigned`, `word` and `cased` enumerate, over every code point Python's "
            "Unicode database assigns, the `[\\w-]` class and the re.IGNORECASE classes "
            "`_mentions` relies on. test_rubric_mentions.py holds all of it to the backend; "
            "apps/web/src/lib/rubric.test.ts holds namedTerms and mentionPattern to it. "
            "Regenerate with `uv run python apps/api/tests/test_rubric_mentions.py`, then "
            "format it with Biome; never by hand."
        ),
        "unicode_version": unicodedata.unidata_version,
        "reserved_terms": list(reserved_rubric_terms()),
        "rubrics": [{"rubric": rubric, "named": _named(rubric)} for rubric in RUBRICS],
        "assigned": _ranges(points),
        "word": _ranges([point for point in points if word.fullmatch(chr(point))]),
        "cased": _case_classes(points),
    }


def _write(tables: dict[str, Any]) -> None:
    """Plain JSON; Biome then gives it the repository's layout (see the module docstring)."""
    FIXTURE.write_text(json.dumps(tables, indent=2) + "\n", encoding="utf-8")


# Absent only while the script below is writing it for the first time.
_TABLES: dict[str, Any] = (
    json.loads(FIXTURE.read_text(encoding="utf-8")) if FIXTURE.exists() else {"rubrics": []}
)


def test_the_table_answers_for_the_terms_the_lab_reserves_now() -> None:
    # A framework proven since the table was written is a term the editor would not name.
    assert _TABLES["reserved_terms"] == list(reserved_rubric_terms())
    # A sweep over a set that silently became empty reports as passing (ADR 0023).
    assert len(_TABLES["rubrics"]) == len(RUBRICS)
    assert any(row["named"] for row in _TABLES["rubrics"])
    assert any(not row["named"] for row in _TABLES["rubrics"])


@pytest.mark.parametrize("row", _TABLES["rubrics"], ids=lambda row: repr(row["rubric"][:40]))
def test_every_rubric_names_what_the_gate_refuses_it_for(row: dict[str, Any]) -> None:
    findings = [
        issue.message
        for issue in judge_capability_issues(publishable_judge(rubric=row["rubric"]))
        if issue.code == "rubric_names_an_arm"
    ]

    assert findings == [NAMES_AN_ARM.format(term=term) for term in row["named"]]


_THIS_UNICODE = pytest.mark.skipif(
    _TABLES.get("unicode_version") != unicodedata.unidata_version,
    reason=(
        f"the character tables were enumerated on Unicode {_TABLES.get('unicode_version')} and "
        f"this Python's database is Unicode {unicodedata.unidata_version}; they are compared "
        "only on the Python that wrote them (the rubric rows run on every Python)"
    ),
)
"""The repository does not pin a Python, so the tables are held to the one that wrote them.

A Python on another Unicode database assigns and cases different characters, and would read
every table as wrong. When the Unicode version the lab runs on moves, regenerate the fixture on
that Python (module docstring) and the web suite re-proves the mirror against the new tables."""


@_THIS_UNICODE
def test_the_character_tables_are_this_pythons_own() -> None:
    """The tables are exactly what this Python's `re` and Unicode database answer."""
    tables = build_tables()

    assert _TABLES["unicode_version"] == tables["unicode_version"]
    assert _TABLES["assigned"] == tables["assigned"]
    assert _TABLES["word"] == tables["word"]
    assert _TABLES["cased"] == tables["cased"]


@_THIS_UNICODE
def test_no_uncased_character_matches_a_cased_one_without_regard_to_case() -> None:
    """What makes `cased` the whole of re.IGNORECASE rather than the part that was looked at."""
    cased = {point for group in _TABLES["cased"] for point in group}
    uncased = "".join(chr(point) for point in _code_points() if point not in cased)

    for point in cased:
        assert re.search(re.escape(chr(point)), uncased, re.IGNORECASE) is None


if __name__ == "__main__":
    _write(build_tables())
