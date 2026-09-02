"""The statute enums, as both ends declare them.

WHY THIS FILE EXISTS. `packages/core/src/api/judgment.ts` declared

    export type StatuteCorpus = "HELL_LAW" | "NEGATIVE_CONFESSION" | "DEADLY_SIN";

while `apps.judgment.models.StatuteCorpus` had five members. GONGGUOGE and
INFERNO had landed months earlier and this union was not touched. Nothing
failed anywhere:

  * TypeScript cannot catch it. The value arrives from JSON as `string` and is
    asserted into the union at the API boundary, so a runtime `"INFERNO"` is
    never compared to the declared members. `tsc` was green throughout.
  * The badge cannot catch it either — it renders. `DomainEnum` resolves the
    member through `judgment.statute_corpus`, and the three message bundles
    were short the same two keys, so what a reader saw where a rulebook's name
    belongs was the word "unrecognized".

That is this repository's recurring shape one level over from the civilization
maps: `Record<string, string>` on one side of a language boundary, an
authoritative enum on the other, and a sentence in a comment doing the work of
a mechanism. A comment cannot fail.

DIRECTION. Django owns the enum — it is what the column validates against and
what `Statute.clean` enforces — so every assertion here reads the Python
members and compares the TypeScript and the bundles to them, never the reverse.
The repair for a failure is to add the member to the frontend, not to delete it
from the model.

NOTHING HERE KEEPS ITS OWN COPY of the member list. A hand-written list would
be a third declaration to drift, and it would drift silently in exactly the way
the second one did.
"""
import json
import re
from pathlib import Path

import pytest

from apps.judgment.models import StatuteCorpus, StatutePolarity

REPO_ROOT = Path(__file__).resolve().parents[2]
JUDGMENT_TS = REPO_ROOT / "packages" / "core" / "src" / "api" / "judgment.ts"
MESSAGES = REPO_ROOT / "frontend" / "messages"
LOCALES = ("en", "zh-Hans", "egy")

ENUMS = (
    ("StatuteCorpus", "statute_corpus", StatuteCorpus),
    ("StatutePolarity", "statute_polarity", StatutePolarity),
)


def _ts_union(type_name: str) -> set[str]:
    """The members of an exported string-literal union, read out of the source.

    Raises rather than returning an empty set when the declaration cannot be
    found. A cross-end test that silently compares the backend against nothing
    is the failure this file exists to prevent, and it passes.
    """
    source = JUDGMENT_TS.read_text(encoding="utf-8")
    match = re.search(
        rf"^export type {type_name}\s*=\s*(.*?);", source, re.MULTILINE | re.DOTALL
    )
    if match is None:
        raise AssertionError(
            f"Could not find `export type {type_name} = ...;` in {JUDGMENT_TS}. "
            "Fix this parser; do not delete the comparison."
        )
    members = set(re.findall(r'"([^"]+)"', match.group(1)))
    if not members:
        raise AssertionError(
            f"`{type_name}` parsed to zero members. The declaration shape "
            f"changed: {match.group(1)!r}"
        )
    return members


def _bundle_keys(locale: str, namespace: str) -> set[str]:
    data = json.loads((MESSAGES / f"{locale}.json").read_text(encoding="utf-8"))
    try:
        return set(data["judgment"][namespace])
    except KeyError as exc:
        raise AssertionError(
            f"messages/{locale}.json has no judgment.{namespace} block ({exc}). "
            "Every statute badge in JudgmentGroundsPanel resolves through it."
        ) from exc


class TestTheParserIsLookingAtSomething:
    """If these break, every assertion below compares the model to nothing."""

    def test_the_typescript_file_is_where_this_expects(self):
        assert JUDGMENT_TS.exists(), JUDGMENT_TS

    @pytest.mark.parametrize("type_name,_ns,_enum", ENUMS)
    def test_each_union_parses_to_something(self, type_name, _ns, _enum):
        assert _ts_union(type_name)

    @pytest.mark.parametrize("locale", LOCALES)
    def test_each_bundle_carries_both_namespaces(self, locale):
        assert _bundle_keys(locale, "statute_corpus")
        assert _bundle_keys(locale, "statute_polarity")

    def test_the_model_has_more_than_one_member_to_get_wrong(self):
        # A one-member enum would make set equality pass for trivial reasons.
        assert len(StatuteCorpus.choices) > 1
        assert len(StatutePolarity.choices) > 1


@pytest.mark.parametrize("type_name,namespace,enum", ENUMS)
def test_the_typescript_union_lists_every_member_django_defines(
    type_name, namespace, enum
):
    """The declaration that drifted, held to the model.

    Asserted as set EQUALITY rather than as a subset in either direction. A
    missing member renders as "unrecognized" where a name belongs; an extra one
    is a member no row can ever carry, and a union that permits it lets a
    caller narrow on a case the API cannot produce.
    """
    declared = _ts_union(type_name)
    known = {member.value for member in enum}

    assert declared == known, (
        f"packages/core/src/api/judgment.ts's `{type_name}` disagrees with "
        f"apps.judgment.models.{type_name}. Missing from the frontend: "
        f"{sorted(known - declared)}; declared but not a member: "
        f"{sorted(declared - known)}. Django owns this enum — add the member "
        f"to the union, to judgment.{namespace} in all three message bundles, "
        f"and, for a polarity, to POLARITY_TONE in JudgmentGroundsPanel."
    )


@pytest.mark.parametrize("locale", LOCALES)
@pytest.mark.parametrize("type_name,namespace,enum", ENUMS)
def test_every_member_has_a_name_in_every_bundle(
    type_name, namespace, enum, locale
):
    """The half `tsc` cannot reach.

    Updating the union and forgetting the bundles swaps one silent failure for
    another: the types line up and the screen still says "unrecognized". Three
    bundles are checked separately rather than through the existing key-set
    alignment test, because that one compares the bundles TO EACH OTHER and
    stays green when all three are missing the same key — which is exactly what
    happened to GONGGUOGE and INFERNO.
    """
    declared = _bundle_keys(locale, namespace)
    known = {member.value for member in enum}

    assert declared == known, (
        f"messages/{locale}.json judgment.{namespace} disagrees with "
        f"apps.judgment.models.{type_name}. Missing: {sorted(known - declared)}; "
        f"extra: {sorted(declared - known)}. A missing key renders the badge as "
        f"'unrecognized' in that locale only."
    )


def test_the_empty_corpus_still_has_a_name():
    """HELL_LAW is empty and its VALUE is kept on purpose.

    `StatuteCorpus`'s own docstring records why: rows soft-deleted by
    judgment/0012, and any it refused to touch because a judgment had already
    cited them, still carry it. A stored value that has left the enum no longer
    renders — so the corpus with no articles is precisely the one whose label
    must exist.
    """
    assert "HELL_LAW" in {member.value for member in StatuteCorpus}
    for locale in LOCALES:
        assert _bundle_keys(locale, "statute_corpus") >= {"HELL_LAW"}
