"""The civilization-to-tenant mapping, as both ends declare it.

Why this file exists
--------------------
`4782633` closed the seam where the frontend declared *which civilizations
exist* and drifted from the backend enum. This is the other half of the same
join: which tenant code each civilization lives under. `Soul.civilization` is
derived from the soul's tenant through `TENANT_CIVILIZATION` and from nothing
else, so a frontend that maps a civilization to the wrong code does not get a
wrong colour — it gets a tenant that holds no such soul.

The backend keeps one direction and derives the other:

    TENANT_CIVILIZATION = {"CN_DIYU": CHINESE, ...}
    CIVILIZATION_TENANT = {civ: code for code, civ in TENANT_CIVILIZATION.items()}

The frontend hand-writes both. `CIVILIZATION_CODES` and
`TENANT_CODE_TO_CIVILIZATION` are two literal objects that happen to be
inverses today, with nothing requiring them to stay that way — the shape
`f62fdaa` found five times over in the colour tokens, where the cost was a
fully modelled civilization rendering as a logged-out session.

So there are three claims here: each frontend map against the backend map that
answers the same question, and the two frontend maps against each other.

The third *is* implied by the first two, and it was written down here claiming
otherwise until the claim was tested. While the backend derives its reverse map,
two frontend objects that both agree with it are inverses by construction, and
no mutation makes the third assertion fail alone — every attempt fires one of
the first two alongside it. It is kept anyway, for a smaller reason than the one
originally given: it names the frontend-internal failure directly, so a divergence
between the twins reports as "these two are no longer inverses" rather than only
as "this one disagrees with the backend". And the implication is a property of
the backend deriving rather than authoring, which is a thing that could change.

Why the frontend is read as text, and why nothing here keeps a list
-------------------------------------------------------------------
Same reasons as `test_frontend_civilization_members.py` beside it: pytest has
no TypeScript toolchain, Jest cannot reach the enum, and a parse that stops
matching raises rather than comparing nothing. The expectations are asked of
`TENANT_CIVILIZATION` itself — a forgotten list being the failure under test,
this side must not own one.
"""
import re
from pathlib import Path

import pytest

from apps.souls.models import CIVILIZATION_TENANT, TENANT_CIVILIZATION

REPO_ROOT = Path(__file__).resolve().parents[2]
CIVILIZATIONS_TS = REPO_ROOT / "frontend" / "src" / "config" / "civilizations.ts"


def _ts_object(source: str, name: str) -> dict[str, str]:
    """The `KEY: "value"` pairs of one exported object literal.

    Raises rather than returning `{}` when the object cannot be found or holds
    no pairs. A cross-end test that silently compares two empty dicts is the
    failure mode these files exist to avoid, and it passes.
    """
    match = re.search(
        rf"export const {name}\s*(?::[^=]+)?=\s*\{{(.*?)\n\}}",
        source,
        re.S,
    )
    if match is None:
        raise AssertionError(
            f"{name} was not found in {CIVILIZATIONS_TS.name}. It was renamed, "
            f"reshaped, or moved — fix this parser rather than deleting the "
            f"assertions it feeds."
        )
    pairs = dict(re.findall(r'(\w+)\s*:\s*"([^"]+)"', match.group(1)))
    if not pairs:
        raise AssertionError(f"{name} parsed to zero entries; the pattern has rotted.")
    return pairs


@pytest.fixture(scope="module")
def source() -> str:
    return CIVILIZATIONS_TS.read_text()


def test_the_frontend_maps_each_civilization_to_the_tenant_it_lives_in(source):
    """CIVILIZATION_CODES against the backend's derived civilization -> code."""
    frontend = _ts_object(source, "CIVILIZATION_CODES")
    backend = {civ.value: code for civ, code in CIVILIZATION_TENANT.items()}

    assert frontend == backend, (
        "CIVILIZATION_CODES and apps/souls/models.py::CIVILIZATION_TENANT "
        "disagree. Soul.civilization is derived from the tenant through this "
        "map and from nothing else, so a wrong code here does not mislabel a "
        "soul — it points at a tenant that has none."
    )


def test_the_frontend_maps_each_tenant_back_to_its_civilization(source):
    """TENANT_CODE_TO_CIVILIZATION against the backend's authored code -> civ."""
    frontend = _ts_object(source, "TENANT_CODE_TO_CIVILIZATION")
    backend = {code: civ.value for code, civ in TENANT_CIVILIZATION.items()}

    assert frontend == backend, (
        "TENANT_CODE_TO_CIVILIZATION and apps/souls/models.py::"
        "TENANT_CIVILIZATION disagree. This is the direction the backend "
        "authors; the other one it derives."
    )


def test_the_two_frontend_maps_are_still_inverses_of_each_other(source):
    """Implied by the two above, and kept for what it says rather than what it
    catches.

    The backend cannot get this wrong: it writes one direction and computes the
    other. That is also why this assertion cannot fail alone — anything that
    breaks the frontend pair breaks at least one of them against the backend
    too, which was measured rather than assumed after the opposite was written
    here first.

    What it buys is the message. A fifth civilization landing in one object and
    not its twin reports as two maps that stopped being inverses, which is where
    the edit was, instead of only as a disagreement with an enum nobody touched.
    """
    forward = _ts_object(source, "CIVILIZATION_CODES")
    reverse = _ts_object(source, "TENANT_CODE_TO_CIVILIZATION")

    assert {code: civ for civ, code in forward.items()} == reverse, (
        "CIVILIZATION_CODES and TENANT_CODE_TO_CIVILIZATION are no longer "
        "inverses. The backend derives its reverse map from its forward one "
        "for exactly this reason; these two are written out twice."
    )
