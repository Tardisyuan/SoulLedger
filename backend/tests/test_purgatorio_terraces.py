"""
The seven terraces of Mount Purgatory, and the seven capital sins that stand on
them.

Why this file exists
--------------------
The seven sins were in this database once already, as ``DEADLY_SIN`` statutes
carrying a ``dante_circle`` — a coordinate the *Commedia* does not have. Dante
layers hell on Aristotle's tripartition (Inf. XI.79-84, Virgil naming
*incontinenza / malizia / matta bestialitade*), and pride, envy and sloth get no
circle at all; five of the seven ``purgatorio_terrace`` values were wrong as
well, and one punishment — envy caged in iron — appears nowhere in the poem.
None of it was caught, because nothing compared the articles to a structure.

Now there is a structure to compare them to. These tests are that comparison,
and they are written to the two rules ``tests/test_seed_mythology.py`` states:

1. **The expectations are a second, hand-written copy.** Nothing here imports
   ``seed_mythology``'s tables. Importing them would make every assertion a
   tautology that stays green after somebody moves envy to the fifth terrace,
   which is exactly the edit these tests exist to catch.

2. **Failures name the row.** Set differences and per-terrace messages, never
   ``assert qs.count() == 7``.

And one more that the withdrawn corpus earned: **absence is asserted too.** A
terrace that carries its own penance is not enough — the fifth terrace carrying
the second's would satisfy that and be wrong, so each description is checked for
the six penances it must NOT contain.
"""
import io

import pytest
from django.core.management import call_command

from apps.judgment.models import Statute, StatuteCorpus
from apps.realms.models import Realm

# --------------------------------------------------------------------------
# What Dante's mountain looks like. Purgatorio X-XXVII, bottom to top, with the
# ordering Virgil explains in Purg. XVII: terraces 1-3 are love perverted
# (aimed at a neighbour's harm), terrace 4 is love defective, terraces 5-7 are
# love excessive. Sources are listed in
# docs/lore-verification/verify-christian-structure.md §3.3.
#
# `penance` is a distinctive phrase that must appear both in the realm's
# description and in the article's English text. It is short on purpose: the
# wording of the prose is free to improve, the fact that envy's eyes are sewn
# shut with wire is not.
# --------------------------------------------------------------------------
TERRACES = {
    1: {
        "realm_code": "EU_PURGATORY_T1_PRIDE",
        "statute_code": "EU-DS-T1",
        "sin_en": "Pride",
        "sin_zh": "傲慢",
        "latin": "Superbia",
        "penance": "great stone",
        "love_disorder": "perverted",
    },
    2: {
        "realm_code": "EU_PURGATORY_T2_ENVY",
        "statute_code": "EU-DS-T2",
        "sin_en": "Envy",
        "sin_zh": "嫉妒",
        "latin": "Invidia",
        "penance": "iron wire",
        "love_disorder": "perverted",
    },
    3: {
        "realm_code": "EU_PURGATORY_T3_WRATH",
        "statute_code": "EU-DS-T3",
        "sin_en": "Wrath",
        "sin_zh": "愤怒",
        "latin": "Ira",
        "penance": "smoke",
        "love_disorder": "perverted",
    },
    4: {
        "realm_code": "EU_PURGATORY_T4_SLOTH",
        "statute_code": "EU-DS-T4",
        "sin_en": "Sloth",
        "sin_zh": "懒惰",
        "latin": "Acedia",
        "penance": "runs without pause",
        "love_disorder": "defective",
    },
    5: {
        "realm_code": "EU_PURGATORY_T5_AVARICE",
        "statute_code": "EU-DS-T5",
        "sin_en": "Avarice",
        "sin_zh": "贪婪",
        "latin": "Avaritia",
        "penance": "face down",
        "love_disorder": "excessive",
    },
    6: {
        "realm_code": "EU_PURGATORY_T6_GLUTTONY",
        "statute_code": "EU-DS-T6",
        "sin_en": "Gluttony",
        "sin_zh": "暴食",
        "latin": "Gula",
        "penance": "fruit trees",
        "love_disorder": "excessive",
    },
    7: {
        "realm_code": "EU_PURGATORY_T7_LUST",
        "statute_code": "EU-DS-T7",
        "sin_en": "Lust",
        "sin_zh": "淫欲",
        "latin": "Luxuria",
        "penance": "wall of flame",
        "love_disorder": "excessive",
    },
}

MOUNTAIN_CODE = "EU_PURGATORY"

#: The withdrawn citation keys. They must not be re-used: `judgment/0012`
#: deliberately left any cited article live, so re-seeding under these codes
#: would rewrite the recorded grounds of a decided case.
WITHDRAWN_CODES = [f"EU-DS-{index:02d}" for index in range(1, 8)]


@pytest.fixture
def seeded(db):
    """A database with seed_mythology applied once."""
    out = io.StringIO()
    call_command("seed_mythology", stdout=out, stderr=out)
    return out.getvalue()


def _missing(expected, actual, what):
    absent = [item for item in expected if item not in actual]
    return absent, (
        f"seed_mythology left {len(absent)} of {len(expected)} {what} out of "
        f"the database: {absent}. Present: {sorted(set(actual) & set(expected))}"
    )


# --------------------------------------------------------------------------
# The seven realms
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_all_seven_terraces_exist(seeded):
    expected = [terrace["realm_code"] for terrace in TERRACES.values()]
    codes = set(
        Realm.objects.filter(civilization="EUROPEAN", realm_code__in=expected)
        .values_list("realm_code", flat=True)
    )
    absent, message = _missing(expected, codes, "terraces of Mount Purgatory")
    assert not absent, (
        f"{message}\nWithout the terrace there is no place in this system that "
        f"the corresponding capital sin belongs to, which is how all seven came "
        f"to be filed under circles of hell that three of them do not have."
    )


@pytest.mark.django_db
def test_terraces_carry_their_number_as_tier(seeded):
    """Terrace N sits at tier N, ascending in Dante's order.

    The order is the load-bearing fact: pride at the bottom and lust at the top
    is Dante's theory of disordered love (Purg. XVII) made into a geography, and
    a shuffled mountain is a different claim about what these sins are.
    """
    tiers = dict(
        Realm.objects.filter(
            realm_code__in=[t["realm_code"] for t in TERRACES.values()]
        ).values_list("realm_code", "tier")
    )
    wrong = {
        terrace["realm_code"]: (tiers.get(terrace["realm_code"]), number)
        for number, terrace in TERRACES.items()
        if tiers.get(terrace["realm_code"]) != number
    }
    assert not wrong, (
        f"Terraces seeded at the wrong tier (realm_code -> (found, expected)): "
        f"{wrong}. Bottom to top the mountain is pride, envy, wrath, sloth, "
        f"avarice, gluttony, lust (Purg. X-XXVII)."
    )


@pytest.mark.django_db
def test_each_terrace_is_named_for_its_own_sin(seeded):
    rows = dict(
        Realm.objects.filter(
            realm_code__in=[t["realm_code"] for t in TERRACES.values()]
        ).values_list("realm_code", "name_en")
    )
    wrong = [
        f"{terrace['realm_code']}: name_en={rows.get(terrace['realm_code'])!r}, "
        f"expected to name {terrace['sin_en']}"
        for terrace in TERRACES.values()
        if terrace["sin_en"].lower() not in (rows.get(terrace["realm_code"]) or "").lower()
    ]
    assert not wrong, (
        "A terrace whose code says one sin and whose name says another is the "
        "shape EU_HELL_2ND had for months (name_zh 贪食深渊 against name_en "
        "'Second Circle - Lust'):\n  " + "\n  ".join(wrong)
    )


@pytest.mark.django_db
def test_each_terrace_carries_its_penance_and_nobody_else_s(seeded):
    """The penance is checked for presence AND for absence.

    Presence alone is satisfied by a description that names every penance on
    the mountain, and by a fifth terrace that describes the second's. The
    withdrawn table failed exactly this way: envy's purgation was given as 「被冷
    水浸泡」, which is nobody's, while the sewn eyelids of Purg. XIII appeared
    nowhere at all.
    """
    descriptions = dict(
        Realm.objects.filter(
            realm_code__in=[t["realm_code"] for t in TERRACES.values()]
        ).values_list("realm_code", "description")
    )
    faults = []
    for number, terrace in TERRACES.items():
        description = descriptions.get(terrace["realm_code"]) or ""
        if terrace["penance"] not in description:
            faults.append(
                f"terrace {number} ({terrace['sin_en']}) does not describe its "
                f"own penance ({terrace['penance']!r}): {description!r}"
            )
        intruders = [
            f"terrace {other}'s {alien['penance']!r}"
            for other, alien in TERRACES.items()
            if other != number and alien["penance"] in description
        ]
        if intruders:
            faults.append(
                f"terrace {number} ({terrace['sin_en']}) describes "
                f"{', '.join(intruders)}"
            )
    assert not faults, "Penances are on the wrong terraces:\n  " + "\n  ".join(faults)


@pytest.mark.django_db
def test_the_terraces_are_sub_realms_of_the_mountain(seeded):
    """Dante's Purgatory is one mountain with parts, and the model says so.

    `Realm.parent_realm` has existed since realms/0001 with nothing in the seed
    data using it. Flattening the mountain into eight peers would lose the only
    statement that the terraces are stages of one ascent — and would leave the
    summit, where Lethe is, indistinguishable from the seven levels below it.
    """
    mountain = Realm.objects.filter(realm_code=MOUNTAIN_CODE).first()
    assert mountain is not None, (
        f"{MOUNTAIN_CODE} is gone. The terraces are what it contains, not what "
        f"it becomes: DispositionService routes every PURGATORY and RETRY "
        f"verdict to it and Lethe stands on it."
    )
    assert mountain.parent_realm_id is None, (
        f"{MOUNTAIN_CODE} was given a parent — the mountain is the top of this "
        f"structure, not a level inside something else."
    )

    parents = dict(
        Realm.objects.filter(
            realm_code__in=[t["realm_code"] for t in TERRACES.values()]
        ).values_list("realm_code", "parent_realm__realm_code")
    )
    orphaned = {
        code: parents.get(code)
        for code in (t["realm_code"] for t in TERRACES.values())
        if parents.get(code) != MOUNTAIN_CODE
    }
    assert not orphaned, (
        f"Terraces not attached to {MOUNTAIN_CODE} (realm_code -> parent "
        f"found): {orphaned}"
    )


@pytest.mark.django_db
def test_the_terraces_are_remediable_and_temporary(seeded):
    """Purgatory is not hell with a nicer name.

    Every soul on a terrace is already saved and the pain ends when the sin is
    purged — the semantic difference from the nine circles, where `is_eternal`
    is True. And no terrace resets memory: Lethe is at the summit, above the
    seventh (Purg. XXVIII, XXXI), not on the way up. All eleven European realms
    once carried LETHE, which was wrong for the circles and would be wrong here.
    """
    rows = Realm.objects.filter(
        realm_code__in=[t["realm_code"] for t in TERRACES.values()]
    ).values_list("realm_code", "realm_type", "is_eternal", "memory_reset_mechanism")
    faults = []
    for code, realm_type, is_eternal, memory_reset in rows:
        if realm_type != "PURGATORY":
            faults.append(f"{code}: realm_type={realm_type}, expected PURGATORY")
        if is_eternal:
            faults.append(f"{code}: is_eternal=True — a terrace is expiable")
        if memory_reset == "LETHE":
            faults.append(
                f"{code}: memory_reset_mechanism=LETHE — Lethe is in the "
                f"Earthly Paradise at the summit, not on the terraces"
            )
    assert not faults, "\n  ".join(["Terraces misdescribed:", *faults])


# --------------------------------------------------------------------------
# The seven articles
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_seven_articles_one_per_terrace(seeded):
    expected = [terrace["statute_code"] for terrace in TERRACES.values()]
    codes = set(
        Statute.objects.filter(corpus=StatuteCorpus.DEADLY_SIN)
        .values_list("code", flat=True)
    )
    absent, message = _missing(expected, codes, "capital-sin articles")
    assert not absent, message
    assert codes == set(expected), (
        f"The DEADLY_SIN corpus holds articles this file does not know about: "
        f"{sorted(codes - set(expected))}. Seven sins, seven terraces, seven "
        f"articles — an eighth is either a duplicate or a new claim."
    )


@pytest.mark.django_db
def test_the_withdrawn_codes_are_not_reused(seeded):
    """EU-DS-01..07 stay retired, tombstones and all.

    judgment/0012 refused to retire any withdrawn article a judgment had
    actually cited, so a live EU-DS-07 carrying the invented iron cage may exist
    on a deployed database. Seeding a corrected article under that same code
    would silently rewrite the recorded grounds of a decided case — `_upsert`
    matches on `code` — so the new corpus uses new keys.
    """
    reused = sorted(
        Statute.all_objects.filter(code__in=WITHDRAWN_CODES).values_list("code", flat=True)
    )
    assert reused == [], (
        f"seed_mythology wrote the withdrawn citation keys {reused}. The "
        f"terrace articles are EU-DS-T1..T7."
    )


@pytest.mark.django_db
def test_each_article_agrees_with_its_own_terrace(seeded):
    """ordinal == payload terrace == the tier of the realm the payload names.

    Three independent statements of the same number, so a sin moved on one side
    and not the other fails here instead of producing a database in which the
    article says terrace 2 and the realm it points at is the fifth.
    """
    faults = []
    realm_tiers = dict(Realm.objects.values_list("realm_code", "tier"))
    for number, terrace in TERRACES.items():
        statute = Statute.objects.filter(code=terrace["statute_code"]).first()
        if statute is None:
            faults.append(f"{terrace['statute_code']} is not seeded")
            continue
        payload = statute.payload_json or {}
        if statute.ordinal != number:
            faults.append(
                f"{statute.code}: ordinal={statute.ordinal}, expected {number}"
            )
        if payload.get("purgatorio_terrace") != number:
            faults.append(
                f"{statute.code}: payload purgatorio_terrace="
                f"{payload.get('purgatorio_terrace')!r}, expected {number}"
            )
        named_realm = payload.get("terrace_realm_code")
        if named_realm != terrace["realm_code"]:
            faults.append(
                f"{statute.code}: points at realm {named_realm!r}, expected "
                f"{terrace['realm_code']!r}"
            )
        elif realm_tiers.get(named_realm) != number:
            faults.append(
                f"{statute.code}: realm {named_realm} sits at tier "
                f"{realm_tiers.get(named_realm)!r}, not {number}"
            )
        if payload.get("latin") != terrace["latin"]:
            faults.append(
                f"{statute.code}: latin={payload.get('latin')!r}, expected "
                f"{terrace['latin']!r}"
            )
        if payload.get("love_disorder") != terrace["love_disorder"]:
            faults.append(
                f"{statute.code}: love_disorder={payload.get('love_disorder')!r}, "
                f"expected {terrace['love_disorder']!r} (Purg. XVII)"
            )
        if terrace["sin_zh"] != statute.title_zh:
            faults.append(
                f"{statute.code}: title_zh={statute.title_zh!r}, expected "
                f"{terrace['sin_zh']!r}"
            )
        if terrace["penance"] not in (statute.text_en or ""):
            faults.append(
                f"{statute.code}: text_en does not describe {terrace['penance']!r}"
            )
    assert not faults, "Articles disagree with their terraces:\n  " + "\n  ".join(faults)


@pytest.mark.django_db
def test_no_seeded_article_carries_a_dante_circle(seeded):
    """`dante_circle` is retired, and not only from the seven.

    It was never a coordinate in Dante: pride, envy and sloth have no circle,
    and the four that appear to line up do so because "incontinence" and those
    four sins are adjacent vocabularies. Checked across every corpus, because
    the failure mode is somebody reintroducing the field on a fresh table rather
    than on this one.
    """
    offenders = sorted(
        code
        for code, payload in Statute.all_objects.values_list("code", "payload_json")
        if isinstance(payload, dict) and "dante_circle" in payload
    )
    assert offenders == [], (
        f"Statutes carrying a `dante_circle`: {offenders}. Dante's hell is not "
        f"stratified by the seven capital sins (Inf. XI.79-84); the terrace is "
        f"the coordinate that exists."
    )


@pytest.mark.django_db
def test_every_article_carries_its_provenance_and_its_caveats(seeded):
    """Source is never blank, and the caveats are still attached.

    The wording of a note is deliberately not asserted — improving it is free,
    deleting it is not. That is the same discipline
    tests/test_seed_mythology.py applies to the assessors' source notes.
    """
    faults = []
    for statute in Statute.objects.filter(corpus=StatuteCorpus.DEADLY_SIN):
        if not statute.source:
            faults.append(f"{statute.code}: no source")
        if not statute.source_notes:
            faults.append(f"{statute.code}: no source_notes")
        if "Gregor" in statute.source and "NOT Gregory" not in statute.source:
            faults.append(
                f"{statute.code}: source credits Gregory the Great for the "
                f"ordering. His seven (Moralia XXXI.xlv.87) have tristitia, no "
                f"acedia, and superbia as their root rather than one of them."
            )
    assert not faults, "\n  ".join(["Provenance is missing:", *faults])


@pytest.mark.django_db
def test_sloth_still_says_the_hell_reading_is_disputed(seeded):
    """The one open scholarly question in this corpus stays marked open.

    Whether the accidiosi sunk beneath the Styx (Inf. VII-VIII) are acedia is
    disputed — Dante presents them as anger turned inward. The terrace is not in
    doubt; the circle is, and the withdrawn EU-DS-05 resolved it by asserting
    circle 3, which is gluttony's.
    """
    statute = Statute.objects.get(code=TERRACES[4]["statute_code"])
    notes = " ".join(statute.source_notes or [])
    assert "DISPUTED" in notes or "disputed" in notes, (
        f"The sloth article no longer records that its relation to the Inferno "
        f"is contested. Notes found: {statute.source_notes!r}"
    )


# --------------------------------------------------------------------------
# What this change deliberately did not do
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_no_verdict_is_routed_to_a_terrace(seeded):
    """The terraces are reference data, and that is a decision, not an oversight.

    A terrace is chosen by *which* sin. Nothing in a Judgment records that — the
    router has a verdict and a karma number — so routing to a terrace would have
    to pick one by karma magnitude, rebuilding the severity ladder that made
    "seven sins over nine circles" look plausible in the first place. If a route
    is ever added it should be added on purpose, and this test is what makes
    that a decision instead of a drift.
    """
    from apps.disposition.services import DispositionService

    routable = {
        DispositionService.CHINESE_PURGATORY,
        DispositionService.CHINESE_HEAVEN,
        DispositionService.EU_HEAVEN,
        DispositionService.EU_PURGATORY,
        DispositionService.EG_AARU,
        DispositionService.EG_ANNIHILATION,
        DispositionService.EG_DUAT_ENTRY,
        *DispositionService.CHINESE_HELL_TIERS.values(),
        *DispositionService.EU_HELL_CIRCLES.values(),
    }
    routed = sorted(
        terrace["realm_code"]
        for terrace in TERRACES.values()
        if terrace["realm_code"] in routable
    )
    assert routed == [], (
        f"DispositionService now sends souls to {routed}. That is a behaviour "
        f"change: purgatorial suffering is remedial and terrace-specific, and "
        f"the router has no sin to select on. Update this test with the reason "
        f"if the change is intended."
    )


@pytest.mark.django_db
def test_the_mountain_is_still_the_european_purgatory_destination(seeded):
    from apps.disposition.services import DispositionService

    assert DispositionService.EU_PURGATORY == MOUNTAIN_CODE
    assert Realm.objects.filter(realm_code=MOUNTAIN_CODE).exists(), (
        "The realm every European PURGATORY/RETRY verdict routes to is gone; "
        "those dispositions would be written with destination_realm=None."
    )


@pytest.mark.django_db
def test_reseeding_leaves_the_mountain_alone(seeded):
    """Second run creates nothing — including no second set of terraces, and no
    repeat of the parent-realm link."""
    before = (
        Realm.objects.count(),
        Statute.objects.count(),
        sorted(
            Realm.objects.filter(parent_realm__realm_code=MOUNTAIN_CODE)
            .values_list("realm_code", flat=True)
        ),
    )
    out = io.StringIO()
    call_command("seed_mythology", stdout=out, stderr=out)
    output = out.getvalue()
    after = (
        Realm.objects.count(),
        Statute.objects.count(),
        sorted(
            Realm.objects.filter(parent_realm__realm_code=MOUNTAIN_CODE)
            .values_list("realm_code", flat=True)
        ),
    )
    assert after == before, f"Second run changed the mountain: {before} -> {after}"
    assert "created=0" in output, f"Second run reported creations:\n{output}"
    assert "parent_realm ->" not in output, (
        f"Second run re-linked parents that were already linked — the pass is "
        f"not idempotent:\n{output}"
    )


# --------------------------------------------------------------------------
# The migration
# --------------------------------------------------------------------------


@pytest.mark.django_db
class TestTerraceMigration:
    """realms/0014 puts the terraces on databases that already have a cosmology.

    A fresh database never runs its body — the guard sees an empty realm table
    and returns, and `seed_mythology` writes everything including the prose. An
    existing one gets the identifying columns here and the descriptions from the
    next `seed_mythology --update`, which is the division realms/0012 and 0013
    both use.
    """

    @pytest.fixture
    def migration(self):
        from importlib import import_module

        return import_module("apps.realms.migrations.0014_purgatorio_terraces")

    @pytest.fixture
    def registry(self):
        from django.apps import apps as django_apps

        return django_apps

    def test_it_creates_the_seven_and_attaches_them(self, migration, registry, seeded):
        codes = [terrace["realm_code"] for terrace in TERRACES.values()]
        Realm.all_objects.filter(realm_code__in=codes).delete()
        assert not Realm.all_objects.filter(realm_code__in=codes).exists()

        migration.forwards(registry, None)

        rebuilt = dict(
            Realm.all_objects.filter(realm_code__in=codes).values_list(
                "realm_code", "parent_realm__realm_code"
            )
        )
        assert set(rebuilt) == set(codes), (
            f"Migration created {sorted(rebuilt)}, expected {sorted(codes)}"
        )
        assert set(rebuilt.values()) == {MOUNTAIN_CODE}, (
            f"Terraces created without a parent: {rebuilt}"
        )
        tiers = dict(
            Realm.all_objects.filter(realm_code__in=codes).values_list(
                "realm_code", "tier"
            )
        )
        assert tiers == {
            terrace["realm_code"]: number for number, terrace in TERRACES.items()
        }, f"Migration seeded the terraces out of order: {tiers}"

    def test_it_reverses(self, migration, registry, seeded):
        codes = [terrace["realm_code"] for terrace in TERRACES.values()]
        migration.backwards(registry, None)
        left = sorted(
            Realm.all_objects.filter(realm_code__in=codes).values_list(
                "realm_code", flat=True
            )
        )
        assert left == [], f"backwards left terraces behind: {left}"
        # The mountain is untouched — the reverse removes what 0014 added and
        # nothing 0013's world already had.
        assert Realm.all_objects.filter(realm_code=MOUNTAIN_CODE).exists()

    def test_it_round_trips(self, migration, registry, seeded):
        codes = [terrace["realm_code"] for terrace in TERRACES.values()]
        migration.backwards(registry, None)
        migration.forwards(registry, None)
        parents = dict(
            Realm.all_objects.filter(realm_code__in=codes).values_list(
                "realm_code", "parent_realm__realm_code"
            )
        )
        assert set(parents) == set(codes)
        assert set(parents.values()) == {MOUNTAIN_CODE}

    def test_running_it_twice_creates_nothing(self, migration, registry, seeded):
        before = Realm.all_objects.count()
        migration.forwards(registry, None)
        assert Realm.all_objects.count() == before

    def test_it_writes_nothing_to_an_empty_database(self, migration, registry, db):
        """The guard. A migration that half-seeds ahead of `seed_mythology`
        hands it untenanted rows it did not create, and makes `--dry-run`
        against a fresh database report a plan that is not the one a real run
        would take. realms/0012 learned this the hard way."""
        assert Realm.all_objects.count() == 0
        migration.forwards(registry, None)
        assert Realm.all_objects.count() == 0


def test_realms_0014_round_trip(migration_round_trip):
    """forward -> reverse -> forward, compared as rows, through real `migrate`.

    The class above calls the migration's functions directly against the current
    registry, which is fast and says nothing about whether `manage.py migrate
    realms 0013` actually works. This runs the graph. See
    tests/migration_roundtrip.py for why "the reverse ran" is not the assertion
    that matters — realms/0012 shipped a reverse that ran cleanly and destroyed
    five postings.
    """
    from tests.migration_roundtrip import snapshot_rows

    terrace_codes = [terrace["realm_code"] for terrace in TERRACES.values()]

    def seed(state):
        tenant = state.get_model("tenants", "Tenant")
        realm = state.get_model("realms", "Realm")
        owner = tenant._base_manager.create(
            code="EU_HEAVEN_HELL", display_name="European Afterlife"
        )
        # The mountain, and one row that is not it — the migration takes its
        # tenant from a European sibling, so a second European realm proves it
        # is reading the civilization rather than the code.
        for code, realm_type in ((MOUNTAIN_CODE, "PURGATORY"), ("EU_HEAVEN", "BLISS")):
            realm._base_manager.create(
                realm_code=code,
                civilization="EUROPEAN",
                realm_type=realm_type,
                tier=1,
                name_local=code,
                name_zh=code,
                name_en=code,
                name_egy=code,
                memory_reset_mechanism="LETHE",
                is_eternal=False,
                tenant=owner,
            )

    def snapshot(state):
        realm = state.get_model("realms", "Realm")
        return snapshot_rows(
            realm._base_manager.select_related("parent_realm", "tenant"),
            key="realm_code",
            fields={
                "tier": "tier",
                "realm_type": "realm_type",
                "name_en": "name_en",
                "memory_reset_mechanism": "memory_reset_mechanism",
                "parent": lambda r: (
                    r.parent_realm.realm_code if r.parent_realm_id else None
                ),
                "tenant": lambda r: r.tenant.code if r.tenant_id else None,
            },
            prefix="realm:",
        )

    def check_forward(state):
        rows = snapshot(state)
        for number, terrace in TERRACES.items():
            row = rows.get(f"realm:{terrace['realm_code']}")
            assert row is not None, f"{terrace['realm_code']} was not created"
            assert row["tier"] == number, (
                f"{terrace['realm_code']} landed at tier {row['tier']}, not {number}"
            )
            assert row["parent"] == MOUNTAIN_CODE, (
                f"{terrace['realm_code']} was created unparented: {row}"
            )
            assert row["tenant"] == "EU_HEAVEN_HELL", (
                f"{terrace['realm_code']} did not inherit a European tenant: {row}"
            )
            assert row["memory_reset_mechanism"] != "LETHE", (
                f"{terrace['realm_code']} copied the mountain's LETHE; Lethe is "
                f"at the summit, above the seventh terrace"
            )
        # The mountain is not modified by the forward pass.
        assert rows[f"realm:{MOUNTAIN_CODE}"]["parent"] is None
        assert rows[f"realm:{MOUNTAIN_CODE}"]["memory_reset_mechanism"] == "LETHE"

    def check_reverse(state):
        rows = snapshot(state)
        left = sorted(code for code in terrace_codes if f"realm:{code}" in rows)
        assert left == [], f"the reverse left terraces behind: {left}"
        assert f"realm:{MOUNTAIN_CODE}" in rows, (
            "the reverse deleted EU_PURGATORY — it removes what 0014 added, "
            "and 0013's world already had the mountain"
        )

    migration_round_trip(
        before=("realms", "0013_correct_mythological_positions"),
        after=("realms", "0014_purgatorio_terraces"),
        seed=seed,
        snapshot=snapshot,
        check_forward=check_forward,
        check_reverse=check_reverse,
    )
