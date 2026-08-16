"""
The Earthly Paradise at the summit of Mount Purgatory, and the fact that
nowhere else in the European cosmology touches memory.

Why this file exists
--------------------
``memory_reset_mechanism="LETHE"`` was applied to all eleven original European
realms — the nine circles of hell and heaven included — because it was treated
as a property of the *civilization* rather than of a place. For the circles that
asserts the opposite of what the *Inferno* is: Dante's damned keep their
memories, and the poem is largely made of them. Farinata says so in mechanical
terms (Inf. X.100-108) — the damned see the distant future and are blind to the
present, so memory of the world is the one link to it they have left.

And the river itself stood on ``EU_PURGATORY``, the whole mountain, which since
``realms/0014`` has seven terraces hanging off it — so Lethe was on every
terrace a soul crosses while it still needs the memory of the life it is doing
penance for. Dante puts the water at the summit, in the Earthly Paradise above
the seventh terrace: Matelda keeps the two streams (Purg. XXVIII), Dante is
drawn through Lethe after confessing (XXXI), and drinks Eunoè last of all
(XXXIII).

The rules these tests are written to are the ones ``tests/test_seed_mythology``
and ``tests/test_purgatorio_terraces`` state:

1. **The expectations are a second, hand-written copy.** Nothing here imports
   the seed tables; importing them would make every assertion a tautology that
   survives moving Lethe back onto the mountain.
2. **Failures name the row.**
3. **Absence is asserted as well as presence.** "The summit has Lethe on it"
   stays green while the mountain also has Lethe on it, and "the summit exists"
   stays green while a circle still says LETHE — so both negatives are checked
   explicitly.
"""
import io

import pytest
from django.core.management import call_command

from apps.actors.models import Actor
from apps.realms.models import Realm

MOUNTAIN_CODE = "EU_PURGATORY"
SUMMIT_CODE = "EU_EARTHLY_PARADISE"

#: The seven terraces, by tier. Repeated by hand rather than imported from
#: tests/test_purgatorio_terraces.py: what is asserted below is that the summit
#: is *above all of them*, and a shared constant would let a future edit move
#: both sides at once.
TERRACE_TIERS = {
    "EU_PURGATORY_T1_PRIDE": 1,
    "EU_PURGATORY_T2_ENVY": 2,
    "EU_PURGATORY_T3_WRATH": 3,
    "EU_PURGATORY_T4_SLOTH": 4,
    "EU_PURGATORY_T5_AVARICE": 5,
    "EU_PURGATORY_T6_GLUTTONY": 6,
    "EU_PURGATORY_T7_LUST": 7,
}

#: Nine circles and heaven. Every one of these carried LETHE and must not.
NO_LETHE_HERE = [
    "EU_HEAVEN",
    "EU_HELL_1ST", "EU_HELL_2ND", "EU_HELL_3RD", "EU_HELL_4TH", "EU_HELL_5TH",
    "EU_HELL_6TH", "EU_HELL_7TH", "EU_HELL_8TH", "EU_HELL_9TH",
]

#: The two streams of the Earthly Paradise, as (role, realm_code). Both
#: CONDUIT: `ActorRole` names an actor's function in a soul's transit and has no
#: vocabulary for the direction of an effect, so "erases" and "restores" are not
#: a role distinction — and Matelda states the pair in one sentence (Purg.
#: XXVIII).
RIVERS = {
    "Lethe": ("CONDUIT", SUMMIT_CODE),
    "Eunoe": ("CONDUIT", SUMMIT_CODE),
}


@pytest.fixture
def seeded(db):
    """A database with seed_mythology applied once."""
    out = io.StringIO()
    call_command("seed_mythology", stdout=out, stderr=out)
    return out.getvalue()


# --------------------------------------------------------------------------
# 1. There is no Lethe in hell, and none in heaven
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_no_circle_of_hell_and_not_heaven_resets_memory(seeded):
    """The nine circles and heaven say NONE, and the failure names the row.

    Not `!= "LETHE"` alone: a row silently switched to MENGPO or to blank would
    satisfy that and would be a different wrong claim, so the expected value is
    asserted positively too.
    """
    rows = dict(
        Realm.objects.filter(realm_code__in=NO_LETHE_HERE)
        .values_list("realm_code", "memory_reset_mechanism")
    )
    missing = [code for code in NO_LETHE_HERE if code not in rows]
    assert not missing, f"seed_mythology did not seed {missing}"

    faults = [
        f"{code}: memory_reset_mechanism={rows[code]!r}, expected 'NONE'"
        for code in NO_LETHE_HERE
        if rows[code] != "NONE"
    ]
    assert not faults, "\n  ".join([
        "Realms that reset memory and should not:",
        *faults,
        "Dante's damned keep their memories — Francesca recounts the book and "
        "the kiss (Inf. V), Ulysses his last voyage (XXVI), Ugolino "
        "the tower (XXXIII) — and Farinata gives the reason (Inf. X.100-108). "
        "The blessed remember too (Piccarda, Par. III; Cacciaguida, Par. "
        "XV-XVII), and reach heaven having crossed Lethe two realms earlier.",
    ])


@pytest.mark.django_db
def test_the_mountain_still_resets_memory(seeded):
    """EU_PURGATORY keeps LETHE, and that is a decision worth a red test.

    The mountain is not a level, it is the whole ascent, and the ascent ends in
    the water: a soul admitted here leaves by being drawn through Lethe and
    Eunoè at the summit and by no other exit. Clearing this row along with the
    circles would be the tidy sweep, and it would make the destination every
    European PURGATORY/RETRY verdict routes to say that no memory reset happens
    on a mountain whose own description names both rivers. If that is ever
    reconsidered, it should be reconsidered on purpose.
    """
    mountain = Realm.objects.filter(realm_code=MOUNTAIN_CODE).first()
    assert mountain is not None, f"{MOUNTAIN_CODE} is gone"
    assert mountain.memory_reset_mechanism == "LETHE", (
        f"{MOUNTAIN_CODE}: memory_reset_mechanism="
        f"{mountain.memory_reset_mechanism!r}. The seven terraces say NONE "
        f"because a soul on a terrace has not reached the water; the mountain "
        f"says LETHE because every soul that finishes the climb does."
    )


# --------------------------------------------------------------------------
# 2. The summit
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_the_summit_exists(seeded):
    assert Realm.objects.filter(realm_code=SUMMIT_CODE).exists(), (
        f"{SUMMIT_CODE} is not seeded. Without it Lethe has nowhere to stand "
        f"except the whole mountain, which is where it was, and which puts the "
        f"river on all seven terraces."
    )


@pytest.mark.django_db
def test_the_summit_is_above_every_terrace_and_on_the_same_mountain(seeded):
    """Two separate statements, both required.

    `tier` says the summit is above the seven; `parent_realm` says it is on the
    same mountain rather than beside it. A row with only the first would sort
    correctly and belong nowhere; a row with only the second would be
    indistinguishable from an eighth terrace.
    """
    summit = Realm.objects.filter(realm_code=SUMMIT_CODE).first()
    assert summit is not None, f"{SUMMIT_CODE} is not seeded"

    tiers = dict(
        Realm.objects.filter(realm_code__in=TERRACE_TIERS)
        .values_list("realm_code", "tier")
    )
    assert tiers == TERRACE_TIERS, (
        f"The terraces are not where this test expects them: {tiers}. "
        f"The summit's tier is only meaningful relative to theirs."
    )
    not_below = sorted(code for code, tier in tiers.items() if tier >= summit.tier)
    assert not not_below, (
        f"{SUMMIT_CODE} sits at tier {summit.tier}, which is not above "
        f"{not_below}. Purg. XXVIII opens above the seventh terrace: the "
        f"summit is reached by finishing the mountain, not by climbing one "
        f"more level of it."
    )

    parent = summit.parent_realm.realm_code if summit.parent_realm_id else None
    assert parent == MOUNTAIN_CODE, (
        f"{SUMMIT_CODE}.parent_realm is {parent!r}, expected {MOUNTAIN_CODE!r}. "
        f"The Earthly Paradise is the top of Mount Purgatory, not a twelfth "
        f"European realm standing next to it."
    )


@pytest.mark.django_db
def test_the_summit_is_purgatorial_temporary_and_where_the_water_is(seeded):
    summit = Realm.objects.get(realm_code=SUMMIT_CODE)
    faults = []
    if summit.realm_type != "PURGATORY":
        faults.append(
            f"realm_type={summit.realm_type!r}, expected 'PURGATORY' — this is "
            f"part of Mount Purgatory. BLISS would claim it is the beatitude "
            f"(that is EU_HEAVEN); NEUTRAL would file Eden beside the ferry "
            f"crossing as another waypoint."
        )
    if summit.is_eternal:
        faults.append("is_eternal=True — nobody stays; the soul rises to the stars")
    if summit.memory_reset_mechanism != "LETHE":
        faults.append(
            f"memory_reset_mechanism={summit.memory_reset_mechanism!r}, "
            f"expected 'LETHE' — this is the one place in the European "
            f"cosmology where the water actually is (Purg. XXVIII, XXXI)"
        )
    assert not faults, "\n  ".join([f"{SUMMIT_CODE} misdescribed:", *faults])


# --------------------------------------------------------------------------
# 3. The two rivers
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_both_rivers_stand_at_the_summit(seeded):
    """Lethe AND Eunoè, both CONDUIT, both on the summit.

    Eunoè is the half that was missing, and her absence was not cosmetic: she
    is Dante's own invention (no classical source has the river, and the name is
    his), so a system that seeds Lethe alone is asserting the *Greek* river of
    forgetting under a Christian address. The pair is what makes the placement
    Dante's.
    """
    rows = {
        actor.name: (
            actor.role,
            actor.realm.realm_code if actor.realm_id else None,
        )
        for actor in Actor.objects.filter(
            civilization="EUROPEAN", name__in=RIVERS
        ).select_related("realm")
    }
    absent = sorted(set(RIVERS) - set(rows))
    assert not absent, (
        f"Not seeded: {absent}. Dante's two streams are a pair — Matelda "
        f"describes them in one sentence (Purg. XXVIII), Lethe takes "
        f"away the memory of sin (XXXI) and Eunoè gives back the memory of "
        f"good done (XXXIII), and a soul goes through both before it can rise."
    )
    wrong = {
        name: rows[name] for name, expected in RIVERS.items() if rows[name] != expected
    }
    assert not wrong, (
        f"Rivers misplaced or mis-roled (name -> (role, realm) found): {wrong}. "
        f"Expected {RIVERS}."
    )


@pytest.mark.django_db
def test_no_river_is_left_standing_on_the_whole_mountain(seeded):
    """The absence half of the test above.

    "Lethe is at the summit" stays green on a database where a second Lethe row
    still stands on EU_PURGATORY, and "the summit has two rivers" stays green
    if the mountain has them too. The mountain must have neither: putting a
    river on the container is what placed it on all seven terraces.
    """
    on_the_mountain = sorted(
        Actor.all_objects.filter(
            civilization="EUROPEAN",
            realm__realm_code=MOUNTAIN_CODE,
            name__in=RIVERS,
        ).values_list("name", flat=True)
    )
    assert on_the_mountain == [], (
        f"{on_the_mountain} still stand on {MOUNTAIN_CODE}, the whole mountain. "
        f"The water is at the summit, above the seventh terrace — on the "
        f"mountain row it is on every terrace as well, including the ones a "
        f"soul crosses while it still needs the memory it is doing penance for."
    )


@pytest.mark.django_db
def test_lethe_no_longer_describes_virgils_river(seeded):
    """The row's realm was Dante's and its meaning was Virgil's.

    Virgil's Lethe (Aen. 6.703ff) is drunk by souls about to be reborn, to
    forget an entire past life; Dante's takes away the memory of sin and his
    Purgatory has no rebirth in it at all. The description used to say souls
    drink to forget their past lives, which is the wrong poem for the realm the
    same row names. Both halves are checked: the Virgilian claim must be gone,
    and the Dantean one must be there, because a description emptied of both
    would satisfy a bare `not in`.
    """
    lethe = Actor.objects.get(civilization="EUROPEAN", name="Lethe")
    description = lethe.description or ""

    for phrase in ("forget their past lives", "forget its past life"):
        assert phrase not in description, (
            f"Lethe's description still says {phrase!r}: that is Virgil's "
            f"river, drunk before reincarnation, and this row stands in "
            f"{SUMMIT_CODE} where Dante has no reincarnation to forget. "
            f"Description: {description!r}"
        )
    assert "memory of their sins" in description, (
        f"Lethe's description no longer says what Dante's Lethe removes — the "
        f"memory of sin, and only that. Description: {description!r}"
    )
    assert "does not model" not in description, (
        f"Lethe's description still says this system does not model Eunoè. It "
        f"does; she stands in the same realm. Description: {description!r}"
    )


# --------------------------------------------------------------------------
# 4. What this deliberately did not do
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_the_summit_is_not_a_disposition_destination(seeded):
    """A soul reaches the summit by finishing the climb, not by being sentenced.

    Same decision the seven terraces record, and recorded the same way so that
    adding a route is a decision rather than a drift.
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
    assert SUMMIT_CODE not in routable, (
        f"DispositionService now routes souls to {SUMMIT_CODE}. The mountain "
        f"is the destination; the summit is where the climb ends. Update this "
        f"test with the reason if the change is intended."
    )
    assert DispositionService.EU_PURGATORY == MOUNTAIN_CODE


@pytest.mark.django_db
def test_reseeding_changes_nothing(seeded):
    before = (Realm.objects.count(), Actor.objects.count())
    out = io.StringIO()
    call_command("seed_mythology", stdout=out, stderr=out)
    output = out.getvalue()
    after = (Realm.objects.count(), Actor.objects.count())
    assert after == before, f"Second run changed row counts: {before} -> {after}"
    assert "created=0" in output, f"Second run reported creations:\n{output}"
    assert "parent_realm ->" not in output, (
        f"Second run re-linked a parent that was already linked:\n{output}"
    )


# --------------------------------------------------------------------------
# 5. The migration
# --------------------------------------------------------------------------


@pytest.mark.django_db
class TestEarthlyParadiseMigration:
    """realms/0016 against the current registry — fast, and not the whole story.

    `test_realms_0016_round_trip` below runs the real graph. This class is the
    cheap half: it calls the migration's own functions so a fault in them is
    reported against the function rather than against `migrate`.
    """

    @pytest.fixture
    def migration(self):
        from importlib import import_module

        return import_module("apps.realms.migrations.0016_earthly_paradise")

    @pytest.fixture
    def registry(self):
        from django.apps import apps as django_apps

        return django_apps

    def _undo_by_hand(self):
        """Put the database back in 0015's shape without using `backwards`.

        `backwards` is what the round-trip test exercises. Using it to build the
        starting state for the forward test would make one function's bug hide
        the other's.
        """
        mountain = Realm.all_objects.get(realm_code=MOUNTAIN_CODE)
        Actor.all_objects.filter(
            civilization="EUROPEAN", name="Lethe"
        ).update(realm=mountain)
        Realm.all_objects.filter(realm_code=SUMMIT_CODE).delete()
        Realm.all_objects.filter(realm_code__in=NO_LETHE_HERE).update(
            memory_reset_mechanism="LETHE"
        )

    def test_it_creates_the_summit_moves_lethe_and_clears_the_circles(
        self, migration, registry, seeded
    ):
        self._undo_by_hand()
        assert not Realm.all_objects.filter(realm_code=SUMMIT_CODE).exists()

        migration.forwards(registry, None)

        summit = Realm.all_objects.filter(realm_code=SUMMIT_CODE).first()
        assert summit is not None, "the migration did not create the summit"
        assert summit.tier == 8, f"summit created at tier {summit.tier}, not 8"
        assert summit.parent_realm.realm_code == MOUNTAIN_CODE, (
            f"summit created unparented or under {summit.parent_realm!r}"
        )
        assert summit.tenant is not None, (
            "summit created untenanted while its European siblings have a tenant"
        )
        assert summit.memory_reset_mechanism == "LETHE"

        lethe = Actor.all_objects.get(civilization="EUROPEAN", name="Lethe")
        assert lethe.realm.realm_code == SUMMIT_CODE, (
            f"Lethe was left on {lethe.realm.realm_code if lethe.realm_id else None}"
        )

        left = dict(
            Realm.all_objects.filter(
                realm_code__in=NO_LETHE_HERE, memory_reset_mechanism="LETHE"
            ).values_list("realm_code", "memory_reset_mechanism")
        )
        assert left == {}, f"realms still resetting memory after forwards: {left}"
        # And the mountain is untouched.
        assert Realm.all_objects.get(
            realm_code=MOUNTAIN_CODE
        ).memory_reset_mechanism == "LETHE"

    def test_it_reverses(self, migration, registry, seeded):
        migration.backwards(registry, None)

        assert not Realm.all_objects.filter(realm_code=SUMMIT_CODE).exists(), (
            "backwards left the summit behind"
        )
        lethe = Actor.all_objects.get(civilization="EUROPEAN", name="Lethe")
        assert lethe.realm_id is not None, (
            "backwards deleted the summit before moving Lethe off it — "
            "Actor.realm is SET_NULL, so the posting is simply gone. This is "
            "the realms/0012 failure mode, and it exits 0."
        )
        assert lethe.realm.realm_code == MOUNTAIN_CODE
        still_none = sorted(
            Realm.all_objects.filter(
                realm_code__in=NO_LETHE_HERE, memory_reset_mechanism="NONE"
            ).values_list("realm_code", flat=True)
        )
        assert still_none == [], (
            f"backwards did not restore LETHE on {still_none}"
        )
        assert Realm.all_objects.filter(realm_code=MOUNTAIN_CODE).exists()

    def test_it_round_trips(self, migration, registry, seeded):
        migration.backwards(registry, None)
        migration.forwards(registry, None)

        summit = Realm.all_objects.filter(realm_code=SUMMIT_CODE).first()
        assert summit is not None and summit.tier == 8
        assert summit.parent_realm.realm_code == MOUNTAIN_CODE
        lethe = Actor.all_objects.get(civilization="EUROPEAN", name="Lethe")
        assert lethe.realm.realm_code == SUMMIT_CODE

    def test_running_it_twice_creates_nothing(self, migration, registry, seeded):
        before = Realm.all_objects.count()
        migration.forwards(registry, None)
        assert Realm.all_objects.count() == before

    def test_it_writes_nothing_to_an_empty_database(self, migration, registry, db):
        """The guard. A migration that half-seeds ahead of `seed_mythology`
        hands it untenanted rows it did not create, and makes `--dry-run`
        against a fresh database report a plan no real run would take."""
        assert Realm.all_objects.count() == 0
        migration.forwards(registry, None)
        assert Realm.all_objects.count() == 0


def test_realms_0016_round_trip(migration_round_trip):
    """forward -> reverse -> forward through real `migrate`, compared as rows.

    The class above calls the migration's functions against the current
    registry, which says nothing about whether `manage.py migrate realms 0015`
    works. This runs the graph. See tests/migration_roundtrip.py for why "the
    reverse ran" is not the assertion that matters.
    """
    from tests.migration_roundtrip import snapshot_rows

    def seed(state):
        tenant = state.get_model("tenants", "Tenant")
        realm = state.get_model("realms", "Realm")
        actor = state.get_model("actors", "Actor")
        owner = tenant._base_manager.create(
            code="EU_HEAVEN_HELL", display_name="European Afterlife"
        )
        # The world at 0015: the mountain, heaven and a circle, all carrying
        # LETHE, with the river standing on the mountain.
        rows = {}
        for code, realm_type, tier in (
            (MOUNTAIN_CODE, "PURGATORY", 1),
            ("EU_HEAVEN", "BLISS", 1),
            ("EU_HELL_1ST", "HELL", 1),
        ):
            rows[code] = realm._base_manager.create(
                realm_code=code,
                civilization="EUROPEAN",
                realm_type=realm_type,
                tier=tier,
                name_local=code,
                name_zh=code,
                name_en=code,
                name_egy=code,
                memory_reset_mechanism="LETHE",
                is_eternal=False,
                tenant=owner,
            )
        actor._base_manager.create(
            name="Lethe",
            civilization="EUROPEAN",
            role="CONDUIT",
            realm=rows[MOUNTAIN_CODE],
            tenant=owner,
        )

    def snapshot(state):
        realm = state.get_model("realms", "Realm")
        actor = state.get_model("actors", "Actor")
        realms = snapshot_rows(
            realm._base_manager.select_related("parent_realm", "tenant"),
            key="realm_code",
            fields={
                "tier": "tier",
                "realm_type": "realm_type",
                "memory_reset_mechanism": "memory_reset_mechanism",
                "parent": lambda r: (
                    r.parent_realm.realm_code if r.parent_realm_id else None
                ),
                "tenant": lambda r: r.tenant.code if r.tenant_id else None,
            },
            prefix="realm:",
        )
        actors = snapshot_rows(
            actor._base_manager.select_related("realm"),
            key="name",
            fields={
                "role": "role",
                "realm": lambda a: a.realm.realm_code if a.realm_id else None,
            },
            prefix="actor:",
        )
        return {**realms, **actors}

    def check_forward(state):
        rows = snapshot(state)
        summit = rows.get(f"realm:{SUMMIT_CODE}")
        assert summit is not None, f"{SUMMIT_CODE} was not created"
        assert summit["tier"] == 8, f"summit landed at tier {summit['tier']}"
        assert summit["parent"] == MOUNTAIN_CODE, f"summit unparented: {summit}"
        assert summit["tenant"] == "EU_HEAVEN_HELL", (
            f"summit did not inherit a European tenant: {summit}"
        )
        assert summit["memory_reset_mechanism"] == "LETHE"

        assert rows["actor:Lethe"]["realm"] == SUMMIT_CODE, (
            f"Lethe was not moved to the summit: {rows['actor:Lethe']}"
        )
        for code in ("EU_HEAVEN", "EU_HELL_1ST"):
            assert rows[f"realm:{code}"]["memory_reset_mechanism"] == "NONE", (
                f"{code} still resets memory: {rows[f'realm:{code}']}"
            )
        # The mountain keeps its own mechanism and its own (absent) parent.
        assert rows[f"realm:{MOUNTAIN_CODE}"]["memory_reset_mechanism"] == "LETHE"
        assert rows[f"realm:{MOUNTAIN_CODE}"]["parent"] is None

    def check_reverse(state):
        rows = snapshot(state)
        assert f"realm:{SUMMIT_CODE}" not in rows, "the reverse left the summit behind"
        assert rows["actor:Lethe"]["realm"] == MOUNTAIN_CODE, (
            f"the reverse did not put Lethe back on the mountain: "
            f"{rows['actor:Lethe']}. Deleting the summit first would SET_NULL "
            f"this posting and still exit 0."
        )
        assert f"realm:{MOUNTAIN_CODE}" in rows, "the reverse deleted the mountain"

    migration_round_trip(
        before=("realms", "0015_rename_devourer_to_annihilation"),
        after=("realms", "0016_earthly_paradise"),
        seed=seed,
        snapshot=snapshot,
        check_forward=check_forward,
        check_reverse=check_reverse,
    )
