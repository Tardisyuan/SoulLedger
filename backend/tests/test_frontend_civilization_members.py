"""The civilization the payload carries, as both ends declare it.

Why this file exists
--------------------
``ef7df3d`` fixed a blank Greek panel whose cause was not a missing branch: the
panel's ``switch`` *was* exhaustive, over a union the frontend declared itself,
and the union was missing the member the backend had started sending. ``tsc``
cannot see that class of defect — a hand-written union is a claim about the
wire, and the compiler only ever checks the code against the claim.

``packages/core/src/api/souls.ts`` carried the same shape in two more places. Both
were hand-written three-member unions, ``"CHINESE" | "EUROPEAN" | "EGYPTIAN"``,
written when ``Civilization`` had three members; ``GREEK`` (tenant ``GR_HADES``)
has been the fourth since. A comparison against ``"GREEK"`` on a value typed by
either of them is a comparison ``tsc`` believes can never be true.

The fix was to stop declaring the set there at all — both fields now read
``CivilizationOption``, derived from ``packages/core/src/config/civilizations.ts``'s
``CIVILIZATION_OPTIONS``, which ``f62fdaa`` established as the frontend's one
list. That leaves exactly one seam this side has to hold: that list against the
enum, plus the fact that ``souls.ts`` still derives rather than re-enumerating.

Why it lives here and not next to the reading kinds
---------------------------------------------------
``apps/ledger/test_readings.py::TestFrontendMemberListsAgree`` is the same
genre and was the obvious host, but it is about one reading's members and is
already 616 lines against this repository's 500-line rule — the rule its own
docstring says it was split out to honour. This is a different seam (the souls
payload's civilization column, not a ledger reading's discriminator), so it
gets its own file rather than pushing that one further over.

Why the frontend is read as text
--------------------------------
The reason ``tests/test_workflow_preset_node_types.py`` and
``apps/ledger/test_readings.py`` already give: pytest has no TypeScript
toolchain and Jest cannot reach the backend enum. If either module is
reformatted so a pattern below stops matching, the parse raises instead of
quietly comparing nothing — a cross-end test that stops finding what it
compares is worse than no cross-end test.

Nothing here keeps a list of civilizations. The expectations are asked of
``Civilization`` itself, for the reason ``_backend_reading_kinds`` gives: a
forgotten list is the whole failure under test, so this side must not own one.
"""
import re
from pathlib import Path

from apps.souls.models import UNKNOWN_CIVILIZATION, Civilization

REPO_ROOT = Path(__file__).resolve().parents[2]
CIVILIZATIONS_TS = REPO_ROOT / "packages" / "core" / "src" / "config" / "civilizations.ts"
SOULS_TS = REPO_ROOT / "packages" / "core" / "src" / "api" / "souls.ts"


def _ts_const_members(path: Path, name: str) -> list[str]:
    """Pull `export const NAME = ["A", "B"] as const;` out of a TS module."""
    source = path.read_text()
    match = re.search(
        rf"export const {name} = \[(?P<body>.*?)\] as const;", source, re.DOTALL
    )
    if match is None:
        raise AssertionError(
            f"{name} is no longer declared as `export const {name} = [...] as const;` "
            f"in {path}. Fix this pattern; do not delete the comparison."
        )
    members = re.findall(r'"([A-Z_]+)"', match.group("body"))
    if not members:
        raise AssertionError(f"{name} parsed to an empty list in {path}")
    return members


def _ts_field_type(path: Path, interface: str, field: str) -> str:
    """The declared type of one field of one TS interface, whitespace-collapsed."""
    source = path.read_text()
    block = re.search(
        rf"(?:export )?interface {interface} \{{(?P<body>.*?)\n\}}", source, re.DOTALL
    )
    if block is None:
        raise AssertionError(
            f"`interface {interface}` is no longer declared in {path}. Fix this "
            f"pattern; do not delete the comparison."
        )
    declaration = re.search(rf"\n  {field}\??: (?P<type>[^;\n]+);", block.group("body"))
    if declaration is None:
        raise AssertionError(
            f"`{field}` is no longer a direct field of `{interface}` in {path}. "
            f"Fix this pattern; do not delete the comparison."
        )
    return " ".join(declaration.group("type").split())


class TestFrontendCivilizationMembersAgree:
    """The set the frontend can name, against the set the backend can send."""

    def test_the_frontend_option_list_holds_every_civilization(self):
        members = _ts_const_members(CIVILIZATIONS_TS, "CIVILIZATION_OPTIONS")
        assert len(members) == len(set(members)), f"duplicate members in {CIVILIZATIONS_TS}"
        # Sets, not lists: the list's own comment says its order is the order of
        # the dropdown, which is a frontend decision and not this side's to pin
        # to the enum's declaration order.
        assert set(members) == set(Civilization.values), (
            "CIVILIZATION_OPTIONS and apps/souls/models.py::Civilization have "
            "diverged. A member only the backend knows is a value the payload "
            "carries that no dropdown offers, no guard admits and no union "
            "types — the shape that put Greek souls under European routing. A "
            "member only the frontend knows is an option that selects nothing."
        )

    def test_the_write_side_union_is_derived_from_that_list(self):
        """`SoulInput.civilization` — what the browser is allowed to send.

        Asserted as derivation rather than as members, because a second
        hand-written copy is the defect: `CIVILIZATION_OPTIONS` already exists
        and `f62fdaa` found the set enumerated by hand in five places, one of
        which (`TenantContext.tsx`'s literal whitelist) is why Greek rendered
        at 240°. A copy that happens to agree today is not the same thing as
        no copy.
        """
        assert _ts_field_type(SOULS_TS, "SoulInput", "civilization") == "CivilizationOption", (
            "SoulInput.civilization no longer reads `CivilizationOption`. If it "
            "has been written out as a literal union again, that union is a "
            "fourth hand-maintained copy of the civilization set, and nothing "
            "on the TypeScript side can see it fall behind the backend: a "
            "`civ === \"GREEK\"` comparison against a union that omits GREEK is "
            "a comparison tsc believes can never be true."
        )

    def test_the_read_side_union_is_that_list_plus_the_unknown_report(self):
        """`Soul.civilization` — what the payload can actually carry.

        The read side admits one value the write side must not: UNKNOWN, which
        `Soul.civilization` returns for a tenant that is missing or unmapped.
        It is a misconfiguration report, not a cosmology, and it is not a
        `Civilization` member (`apps/souls/tests.py` asserts that directly), so
        it is spelled out beside the derived list rather than folded into it —
        which is also why the two unions cannot simply be the same type.
        """
        assert UNKNOWN_CIVILIZATION not in Civilization.values, (
            "UNKNOWN has become a Civilization member. If that is intended it "
            "belongs in CIVILIZATION_OPTIONS and this test is wrong; until "
            "then, the frontend spelling below assumes it is not one."
        )
        expected = f'CivilizationOption | "{UNKNOWN_CIVILIZATION}"'
        assert _ts_field_type(SOULS_TS, "SoulBase", "civilization") == expected, (
            f"SoulBase.civilization no longer reads `{expected}`. Either it has "
            "been re-enumerated by hand (see the write-side test), or the "
            "distinction between the civilizations and the backend's "
            "unrecognised-tenant report has been lost — dropping UNKNOWN makes "
            "a real payload value untypeable, and adding it to "
            "CIVILIZATION_OPTIONS puts a misconfiguration in the dropdown."
        )
