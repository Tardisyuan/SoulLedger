"""`apps.realms.cosmology.COSMOLOGY` answers what the civilization branches it replaced answered (2026-11-14).

Each table's oracle is the old branch, copied as it stood before the registry (`d8faa436`), so a policy entry
that drifts from it is named by civilization and input. No database: every router is called the way
`apps.disposition.destination.allowed_realm_codes` calls it, with soul=None.
"""
import pytest

from apps.disposition.services import DispositionService as D
from apps.judgment.models import JudgmentMethod, Verdict, acquitted_to_rebirth, hears_again
from apps.ledger import readings
from apps.ledger.constants import REBIRTH_CAPABLE_CIVILIZATIONS
from apps.realms.cosmology import COSMOLOGY, outcome_of
from apps.souls.models import UNKNOWN_CIVILIZATION, Civilization

VERDICTS = [*Verdict, None]
# Every registered civilization, plus inputs the old code also met: the unmapped tenant's value, a bare string
# (a tenant's `known_civilization` is a plain str), an empty one and None.
CIVS = [*Civilization, UNKNOWN_CIVILIZATION, "CHINESE", "GREEK", "", None]


def _old_hears_again(civilization, verdict):
    if verdict == Verdict.RETRY:
        return True
    return verdict == Verdict.PURGATORY and civilization not in ("EUROPEAN", "GREEK")


def _old_acquitted_to_rebirth(civilization, verdict):
    return verdict == Verdict.PASSED and civilization == "CHINESE"


@pytest.mark.parametrize("civilization", CIVS, ids=repr)
@pytest.mark.parametrize("verdict", VERDICTS, ids=repr)
def test_outcome_matches_the_old_branches(civilization, verdict):
    assert hears_again(civilization, verdict) is _old_hears_again(civilization, verdict)
    assert acquitted_to_rebirth(civilization, verdict) is _old_acquitted_to_rebirth(civilization, verdict)
    # Exactly one of the three outcomes, and DESTINATION when it is neither of the other two.
    expected = ("REHEAR" if _old_hears_again(civilization, verdict)
                else "ACQUIT_TO_REBIRTH" if _old_acquitted_to_rebirth(civilization, verdict) else "DESTINATION")
    assert outcome_of(civilization, verdict) == expected


def test_rebirth_capable_is_the_old_set():
    assert REBIRTH_CAPABLE_CIVILIZATIONS == frozenset({Civilization.CHINESE, Civilization.GREEK})
    assert all(isinstance(c, Civilization) for c in REBIRTH_CAPABLE_CIVILIZATIONS)
    # Absence: the two terminal cosmologies are not in it.
    assert not {Civilization.EUROPEAN, Civilization.EGYPTIAN} & REBIRTH_CAPABLE_CIVILIZATIONS


def test_every_civilization_is_registered_once_under_its_own_key():
    assert set(COSMOLOGY) == set(Civilization)
    assert all(policy.civilization == civ for civ, policy in COSMOLOGY.items())
    assert UNKNOWN_CIVILIZATION not in COSMOLOGY


def test_shapes_are_four_distinct_names():
    shapes = {civ: policy.shape for civ, policy in COSMOLOGY.items()}
    assert shapes == {Civilization.CHINESE: "line", Civilization.EUROPEAN: "funnel",
                      Civilization.EGYPTIAN: "scale", Civilization.GREEK: "fork"}


READING_ARGS = [
    (0, 0, 0, 0),
    (120, 30, 4, 2),
    (10, 400, 1, 9),
]


@pytest.mark.parametrize("args", READING_ARGS)
@pytest.mark.parametrize("civilization,builder", [
    (Civilization.CHINESE, readings._chinese_reading),
    (Civilization.EGYPTIAN, readings._egyptian_reading),
    (Civilization.EUROPEAN, readings._european_reading),
    (Civilization.GREEK, readings._greek_reading),
])
def test_reading_is_the_old_builder(civilization, builder, args):
    assert COSMOLOGY[civilization].reading(*args) == builder(*args)
    assert readings.CIVILIZATION_READING[civilization](*args) == builder(*args)
    assert readings.get_civilization_reading(civilization, *args) == builder(*args)


def test_an_unregistered_civilization_still_gets_no_reading():
    assert readings.get_civilization_reading(UNKNOWN_CIVILIZATION, 1, 1, 1, 1)["kind"] == "UNAVAILABLE"


def _old_route(civilization, verdict, judgment_method, admitted, karma):
    """The if/elif chain of `DispositionService._route_to_realm`, with soul=None and judgment=None."""
    if civilization == Civilization.CHINESE:
        unoffset = None if verdict != Verdict.FAILED else admitted["unoffset_demerit"]
        return D._route_chinese(None, verdict, karma, unoffset, offence="")
    if civilization == Civilization.EUROPEAN:
        return D._route_european(None, verdict, admitted["demerit"], excluded=admitted["excluded"])
    if civilization == Civilization.EGYPTIAN:
        return D._route_egyptian(None, verdict, judgment_method, karma)
    if civilization == Civilization.GREEK:
        return D._route_greek(None, verdict)
    return ""


ROUTE_CASES = [
    # (karma, unoffset_demerit, demerit)
    (-500, 480.0, 600),
    (-40, 30.0, 60),
    (0, None, 0),
    (75, 0.0, 10),
]


@pytest.mark.parametrize("civilization", list(Civilization))
@pytest.mark.parametrize("verdict", list(Verdict))
@pytest.mark.parametrize("judgment_method", list(JudgmentMethod))
@pytest.mark.parametrize("karma,unoffset,demerit", ROUTE_CASES)
def test_route_is_the_old_branch(civilization, verdict, judgment_method, karma, unoffset, demerit):
    admitted = {"karma": karma, "unoffset_demerit": unoffset, "demerit": demerit, "excluded": ()}
    got = COSMOLOGY[civilization].route(None, verdict, judgment_method, None, admitted, karma)
    assert got == _old_route(civilization, verdict, judgment_method, admitted, karma)
