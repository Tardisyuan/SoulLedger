"""The annihilation realm_code is one string, and both sides must spell it.

Why this file exists
--------------------
`79dee57` corrected what the Egyptian annihilation realm *claims* — Ammit does
not live in a hell, being devoured by her is the second death — and
deliberately did not rename its `realm_code`, saying so in the commit:

    the code string is a live identifier in three places, including a hardcoded
    check in SoulLifecycleTimeline that is the frontend's only signal for
    annihilation. Renaming it here alone would stop that rendering silently.

"Silently" is the operative word. The frontend read
`terminalDisposition?.realm_code === "EG_DEVOURER"`, and a backend-only rename
would have made that comparison false for every soul, forever, without failing
a single test on either side: the frontend's own tests construct their fixtures
with whatever string the component compares against, so they agree with the
component by construction and cannot notice that the *backend* stopped
producing it. There was no assertion anywhere that the two sides used the same
string, because there was nowhere for such an assertion to live — a Jest test
cannot import Python and a pytest test does not run TypeScript.

So this file is that nowhere. It reads the frontend module as text and compares
it with the backend constant. It is deliberately in the backend suite rather
than the frontend one: the code is a backend identifier, the backend is where
it is minted, and pytest can read a `.ts` file far more cheaply than Jest can
read `services.py`.

What "would really fail" means here
-----------------------------------
Every assertion below was checked by breaking it:

* changing only `DispositionService.EG_ANNIHILATION` reddens
  `test_the_two_sides_spell_the_same_code` naming both values;
* changing only `ANNIHILATION_REALM_CODE` reddens the same test;
* re-inlining the literal in `SoulLifecycleTimeline.tsx` reddens
  `test_the_timeline_reads_the_constant_and_spells_no_code_itself`, which is
  what stops the shared constant from decaying into decoration that nothing
  reads;
* renaming the seed row without the constant reddens
  `test_the_seeded_realm_answers_to_the_code`.

The pair of files this reads are load-bearing text, not just modules. If
`realmCodes.ts` is ever reformatted so that `ANNIHILATION_REALM_CODE` is no
longer assigned a quoted literal, `_frontend_constant` raises rather than
returning None — a contract test that quietly stops finding the thing it
compares is worse than no contract test.
"""
import re
from pathlib import Path

import pytest

from apps.disposition.services import DispositionService

# backend/tests/test_annihilation_realm_code.py -> backend/tests -> backend ->
# repo root. Derived from this file's location, never from a hardcoded absolute
# path — see the header of tests/test_production.py for what that cost once.
REPO_ROOT = Path(__file__).resolve().parents[2]
REALM_CODES_TS = REPO_ROOT / "frontend" / "src" / "lib" / "realmCodes.ts"
TIMELINE_TSX = (
    REPO_ROOT / "frontend" / "src" / "components" / "souls" / "SoulLifecycleTimeline.tsx"
)
MESSAGE_BUNDLES = [
    REPO_ROOT / "packages" / "core" / "messages" / name
    for name in ("en.json", "zh-Hans.json", "egy.json")
]

#: `export const ANNIHILATION_REALM_CODE = "EG_ANNIHILATION" as const;`
#: The trailing `as const` is optional in the pattern so a maintainer dropping
#: it does not fail the test for the wrong reason.
_CONSTANT = re.compile(
    r'export\s+const\s+ANNIHILATION_REALM_CODE\s*(?::[^=]+)?=\s*["\']([^"\']+)["\']'
)

#: Any realm_code-shaped literal: two-or-more uppercase segments joined by
#: underscores, in quotes. Used to prove the timeline spells none of them.
_REALM_CODE_LITERAL = re.compile(r'["\']((?:EG|EU|DY)_[A-Z0-9_]+)["\']')


def _read(path: Path) -> str:
    if not path.exists():
        raise AssertionError(
            f"{path.relative_to(REPO_ROOT)} is missing. This test compares the "
            f"frontend's annihilation realm_code against "
            f"DispositionService.EG_ANNIHILATION; if the frontend module moved, "
            f"move the path in this file with it rather than deleting the "
            f"comparison."
        )
    return path.read_text(encoding="utf-8")


def _frontend_constant() -> str:
    source = _read(REALM_CODES_TS)
    match = _CONSTANT.search(source)
    if match is None:
        raise AssertionError(
            f"no `export const ANNIHILATION_REALM_CODE = \"...\"` found in "
            f"{REALM_CODES_TS.relative_to(REPO_ROOT)}. This test parses that "
            f"file as text (pytest has no TypeScript toolchain), so the "
            f"declaration has to stay a plain quoted literal. Failing loudly "
            f"rather than skipping: a contract test that stops finding what it "
            f"compares is worse than none."
        )
    return match.group(1)


def test_the_two_sides_spell_the_same_code():
    """The one assertion this file exists for.

    Change either side alone and this goes red naming both values. Change them
    together and it stays green — which is the only way the rename was allowed
    to happen at all.
    """
    frontend = _frontend_constant()
    backend = DispositionService.EG_ANNIHILATION
    assert frontend == backend, (
        f"the annihilation realm_code disagrees across the wire:\n"
        f"  backend  DispositionService.EG_ANNIHILATION = {backend!r}\n"
        f"  frontend ANNIHILATION_REALM_CODE            = {frontend!r}\n"
        f"A soul routed to {backend!r} would be rendered as an ordinary "
        f"disposition to a destination, silently, because the frontend's only "
        f"annihilation signal is this string comparison. Change both or "
        f"neither."
    )


def test_the_timeline_reads_the_constant_and_spells_no_code_itself():
    """The shared constant only helps if the component actually uses it.

    Nothing stops someone re-inlining `=== "EG_ANNIHILATION"` next to the
    import, at which point `realmCodes.ts` becomes decoration and the test
    above compares two things neither of which the UI reads. So: the timeline
    must import the constant, and must contain no realm_code literal at all.
    """
    source = _read(TIMELINE_TSX)
    rel = TIMELINE_TSX.relative_to(REPO_ROOT)

    assert "ANNIHILATION_REALM_CODE" in source, (
        f"{rel} no longer mentions ANNIHILATION_REALM_CODE. If the annihilation "
        f"branch moved, move this assertion to wherever it went; if it was "
        f"deleted, delete this test deliberately."
    )
    assert re.search(
        r'import\s*\{[^}]*\bANNIHILATION_REALM_CODE\b[^}]*\}\s*from\s*["\'][^"\']*realmCodes["\']',
        source,
    ), f"{rel} mentions ANNIHILATION_REALM_CODE without importing it from realmCodes"

    inlined = sorted(set(_REALM_CODE_LITERAL.findall(source)))
    assert inlined == [], (
        f"{rel} spells realm_code literal(s) {inlined} itself. Realm codes are "
        f"backend identifiers; a literal here is exactly the shape that made "
        f"the EG_DEVOURER rename a coordinated-deploy problem. Put it in "
        f"src/lib/realmCodes.ts and compare it here."
    )


def test_the_message_bundles_are_keyed_by_the_live_code():
    """The realms page looks up `realms.names.${realm.realm_code}`.

    A bundle still keyed by the old code does not crash — `t()` falls through
    to `realm.name_en` — so this drift is invisible in use. Assert both
    directions: the new key is present, and the old one is gone rather than
    sitting beside it looking authoritative.
    """
    import json

    code = DispositionService.EG_ANNIHILATION
    missing, stale = [], []
    for path in MESSAGE_BUNDLES:
        bundle = json.loads(_read(path))
        realms = bundle.get("realms", {})
        for section in ("codes", "names"):
            entries = realms.get(section, {})
            if code not in entries:
                missing.append(f"{path.name}:realms.{section}.{code}")
            if "EG_DEVOURER" in entries:
                stale.append(f"{path.name}:realms.{section}.EG_DEVOURER")

    assert missing == [], f"message bundles with no entry for the live code: {missing}"
    assert stale == [], (
        f"message bundles still carrying the pre-rename key: {stale}. It "
        f"resolves for nothing and reads as if it did."
    )


@pytest.mark.django_db
def test_the_seeded_realm_answers_to_the_code():
    """`seed_mythology` must produce a row the router can actually find.

    `DispositionService.create_from_judgment` does
    `Realm.objects.filter(realm_code=...).first()` and tolerates a miss by
    writing `destination_realm=None`, so a constant that names no row degrades
    to a disposition with no destination rather than to an error.
    """
    import io

    from django.core.management import call_command

    from apps.realms.models import Realm

    call_command("seed_mythology", "--civilization=egyptian", stdout=io.StringIO())

    code = DispositionService.EG_ANNIHILATION
    assert Realm.all_objects.filter(realm_code=code).exists(), (
        f"seed_mythology seeded no realm with realm_code={code!r}, so every "
        f"failed Egyptian heart-weighing would be disposed with "
        f"destination_realm=None"
    )
    assert not Realm.all_objects.filter(realm_code="EG_DEVOURER").exists(), (
        "the pre-rename code is still seeded — the rename would have produced "
        "two rows for one outcome"
    )


def test_the_router_sends_a_failed_heart_to_the_code():
    """The constant is not merely defined; it is what routing returns.

    Without this, the constant and the frontend could agree on a string that
    `_route_egyptian` no longer produces — the two sides consistent with each
    other and both wrong.
    """
    from apps.judgment.models import JudgmentMethod, Verdict

    for method in (JudgmentMethod.HEART_WEIGHING, JudgmentMethod.STANDARD):
        assert (
            DispositionService._route_egyptian(None, Verdict.FAILED, method, 0)
            == DispositionService.EG_ANNIHILATION
        ), f"a FAILED {method} verdict no longer routes to the annihilation code"


def test_realms_0015_round_trip(migration_round_trip):
    """forward -> reverse -> forward through real `migrate`, compared as rows.

    The rename is in place, so the assertion that matters is that the row keeps
    its identity: same primary key, same foreign keys pointing at it, only the
    code changing. A reverse that deleted and recreated the row would pass "the
    reverse ran" and would orphan every disposition recorded against it, which
    is the failure mode tests/migration_roundtrip.py exists for.

    `Reincarnation.target_realm` is seeded here on purpose even though the
    router never produces one for an annihilated soul: it is a CharField, it
    does not follow a rename, and a migration that forgot it would leave a
    string matching no realm. Seeded, it is the column that proves the
    migration's second statement runs in both directions.
    """
    from tests.migration_roundtrip import snapshot_rows

    def seed(state):
        tenant_model = state.get_model("tenants", "Tenant")
        realm_model = state.get_model("realms", "Realm")
        soul_model = state.get_model("souls", "Soul")
        actor_model = state.get_model("actors", "Actor")
        reincarnation_model = state.get_model("reincarnation", "Reincarnation")

        tenant = tenant_model._base_manager.create(
            code="EG_DUAT", display_name="Egyptian Duat"
        )
        devourer = realm_model._base_manager.create(
            realm_code="EG_DEVOURER",
            civilization="EGYPTIAN",
            name_local="第二次死亡",
            name_zh="湮灭",
            name_en="Second Death (annihilation by Ammit)",
            realm_type="HELL",
            tier=10,
            is_eternal=True,
            tenant=tenant,
        )
        # A second Egyptian realm, so the empty-database guard is satisfied by
        # the civilization rather than by this row alone — and so a migration
        # that renamed every Egyptian realm instead of one would show up.
        realm_model._base_manager.create(
            realm_code="EG_AARU",
            civilization="EGYPTIAN",
            name_local="阿鲁之地",
            name_en="Field of Reeds (Aaru)",
            realm_type="BLISS",
            tier=1,
            tenant=tenant,
        )
        # An FK pointing at the renamed row. It must still point at it
        # afterwards — that is what "renamed in place" buys.
        actor_model._base_manager.create(
            name="Ammit",
            civilization="EGYPTIAN",
            role="EXECUTOR",
            realm=devourer,
            tenant=tenant,
        )
        soul = soul_model._base_manager.create(name="被吞噬者", tenant=tenant)
        reincarnation_model._base_manager.create(
            soul=soul, target_realm="EG_DEVOURER", cycle_count=1, tenant=tenant
        )
        # A row naming a realm this migration must NOT touch.
        reincarnation_model._base_manager.create(
            soul=soul, target_realm="EG_AARU", cycle_count=2, tenant=tenant
        )

    def snapshot(state):
        realm_model = state.get_model("realms", "Realm")
        actor_model = state.get_model("actors", "Actor")
        reincarnation_model = state.get_model("reincarnation", "Reincarnation")

        rows = snapshot_rows(
            realm_model._base_manager.filter(civilization="EGYPTIAN"),
            # Keyed on the primary key, not the code — keying on the column the
            # migration rewrites would make every row look "absent then
            # present" and hide a delete-and-recreate behind the same diff.
            key=lambda r: str(r.pk),
            fields={"realm_code": "realm_code", "name_en": "name_en", "tier": "tier"},
            prefix="realm:",
        )
        rows.update(
            snapshot_rows(
                actor_model._base_manager.filter(civilization="EGYPTIAN"),
                key="name",
                fields={
                    "realm_pk": lambda a: str(a.realm_id) if a.realm_id else None,
                    "realm_code": lambda a: a.realm.realm_code if a.realm_id else None,
                },
                prefix="actor:",
            )
        )
        rows.update(
            snapshot_rows(
                reincarnation_model._base_manager.all(),
                key=lambda r: str(r.cycle_count),
                fields={"target_realm": "target_realm"},
                prefix="reincarnation:cycle",
            )
        )
        return rows

    def check_forward(state):
        rows = snapshot(state)
        codes = {v["realm_code"] for k, v in rows.items() if k.startswith("realm:")}
        assert codes == {"EG_ANNIHILATION", "EG_AARU"}, (
            f"forward left the Egyptian realms as {sorted(codes)}"
        )
        assert rows["actor:Ammit"]["realm_code"] == "EG_ANNIHILATION", (
            "Ammit's realm FK did not follow the rename — the row was replaced "
            "rather than renamed"
        )
        assert rows["reincarnation:cycle1"]["target_realm"] == "EG_ANNIHILATION"
        assert rows["reincarnation:cycle2"]["target_realm"] == "EG_AARU", (
            "forward rewrote a target_realm naming a realm it does not own"
        )

    def check_reverse(state):
        rows = snapshot(state)
        codes = {v["realm_code"] for k, v in rows.items() if k.startswith("realm:")}
        assert codes == {"EG_DEVOURER", "EG_AARU"}, (
            f"reverse left the Egyptian realms as {sorted(codes)}"
        )
        assert rows["reincarnation:cycle1"]["target_realm"] == "EG_DEVOURER"

    migration_round_trip(
        before=("realms", "0014_purgatorio_terraces"),
        after=("realms", "0015_rename_devourer_to_annihilation"),
        seed=seed,
        snapshot=snapshot,
        check_forward=check_forward,
        check_reverse=check_reverse,
    )
