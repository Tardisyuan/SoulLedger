"""
Seed-completeness tests for `manage.py seed_mythology`.

These are the reason the command exists. Until now the three civilizations'
reference data lived only in a hand-run script, so "does a fresh database have
a cosmology in it?" had no answer anybody could check. These tests give it one.

Two rules govern how the assertions below are written:

1. **The expected codes are spelled out here, not imported from the command.**
   Importing the command's own tables would make every assertion a tautology —
   the test would pass just as happily after somebody deleted 转轮王 from the
   seed data, because the expectation would vanish along with the row. The
   lists below are an independent second copy on purpose. When the canon grows,
   both sides get updated, and that friction is the point.

2. **Failures name the missing code.** No `assert count > 0`, no
   `assert qs.exists()`. Each check computes a set difference and puts the
   missing codes in the message, so a red test says *which* hall of Diyu or
   circle of Hell went missing rather than "expected 10, got 9".
"""
import io

import pytest
from django.core.management import call_command

from apps.actors.models import Actor
from apps.realms.models import Realm
from apps.tenants.models import Tenant

# --------------------------------------------------------------------------
# What a seeded database must contain. Hand-maintained on purpose — see the
# module docstring.
# --------------------------------------------------------------------------

# 十殿阎罗 — the ten kings of Diyu, in the order they are usually recited.
TEN_KINGS = [
    "秦广王",
    "楚江王",
    "宋帝王",
    "五官王",
    "阎罗王",
    "卞城王",
    "泰山王",
    "都市王",
    "平等王",
    "转轮王",
]

# Dante's nine circles of Hell.
DANTE_NINE_CIRCLES = [
    "EU_HELL_1ST",
    "EU_HELL_2ND",
    "EU_HELL_3RD",
    "EU_HELL_4TH",
    "EU_HELL_5TH",
    "EU_HELL_6TH",
    "EU_HELL_7TH",
    "EU_HELL_8TH",
    "EU_HELL_9TH",
]

# The Egyptian weighing-of-the-heart cast, plus the two realms the verdict
# sends a soul to: paradise, or Ammit.
EGYPTIAN_WEIGHING_ACTORS = ["Ma'at", "Anubis", "Ammit", "Thoth", "Osiris"]
EGYPTIAN_VERDICT_REALMS = ["EG_AARU", "EG_DEVOURER"]

# Realms the Chinese and Egyptian sides cannot work without.
CHINESE_CORE_REALMS = ["DY_00_PURGATORY", "DY_10_YAMA"]
EGYPTIAN_CORE_REALMS = ["EG_DUAT_ENTRY", "EG_HALL_TWO_TRUTHS", *EGYPTIAN_VERDICT_REALMS]

TENANT_CODES = ["CN_DIYU", "EU_HEAVEN_HELL", "EG_DUAT"]


def _seed(**kwargs):
    """Run the command, returning its stdout so tests can assert on the summary."""
    out = io.StringIO()
    call_command("seed_mythology", stdout=out, stderr=out, **kwargs)
    return out.getvalue()


def _missing(expected, actual, what):
    """Build an assertion message naming exactly which codes are absent."""
    absent = [item for item in expected if item not in actual]
    return absent, (
        f"seed_mythology left {len(absent)} of {len(expected)} {what} out of the "
        f"database: {absent}. Present: {sorted(actual & set(expected))}"
    )


@pytest.fixture
def seeded(db):
    """A database with seed_mythology applied once."""
    return _seed()


# --------------------------------------------------------------------------
# Completeness
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_ten_kings_of_diyu_all_present(seeded):
    """All ten courts of Diyu exist as CHINESE Actors (秦广王 … 转轮王)."""
    names = set(
        Actor.objects.filter(civilization="CHINESE", name__in=TEN_KINGS)
        .values_list("name", flat=True)
    )
    absent, message = _missing(TEN_KINGS, names, "十殿阎罗 actors")
    assert not absent, message


@pytest.mark.django_db
def test_dante_nine_circles_all_present(seeded):
    """All nine circles of Dante's Inferno exist as EUROPEAN Realms."""
    codes = set(
        Realm.objects.filter(civilization="EUROPEAN", realm_code__in=DANTE_NINE_CIRCLES)
        .values_list("realm_code", flat=True)
    )
    absent, message = _missing(DANTE_NINE_CIRCLES, codes, "Dante circle realms")
    assert not absent, message


@pytest.mark.django_db
def test_dante_circles_carry_their_tier(seeded):
    """Circle N sits at tier N — the ordering is what makes them circles."""
    tiers = dict(
        Realm.objects.filter(realm_code__in=DANTE_NINE_CIRCLES)
        .values_list("realm_code", "tier")
    )
    wrong = {
        code: tiers.get(code)
        for index, code in enumerate(DANTE_NINE_CIRCLES, start=1)
        if tiers.get(code) != index
    }
    assert not wrong, (
        f"Dante circles seeded at the wrong tier (code -> tier found, expected "
        f"1..9 in order): {wrong}"
    )


@pytest.mark.django_db
def test_egyptian_weighing_actors_all_present(seeded):
    """The Hall of Two Truths cast exists: Ma'at, Anubis, Ammit, Thoth, Osiris."""
    names = set(
        Actor.objects.filter(civilization="EGYPTIAN", name__in=EGYPTIAN_WEIGHING_ACTORS)
        .values_list("name", flat=True)
    )
    absent, message = _missing(EGYPTIAN_WEIGHING_ACTORS, names, "Egyptian weighing actors")
    assert not absent, message


@pytest.mark.django_db
def test_egyptian_realms_all_present(seeded):
    """Duat entry, the Hall, and both verdict destinations exist as Realms."""
    codes = set(
        Realm.objects.filter(civilization="EGYPTIAN", realm_code__in=EGYPTIAN_CORE_REALMS)
        .values_list("realm_code", flat=True)
    )
    absent, message = _missing(EGYPTIAN_CORE_REALMS, codes, "Egyptian realms")
    assert not absent, message


@pytest.mark.django_db
def test_chinese_core_realms_present(seeded):
    codes = set(
        Realm.objects.filter(civilization="CHINESE", realm_code__in=CHINESE_CORE_REALMS)
        .values_list("realm_code", flat=True)
    )
    absent, message = _missing(CHINESE_CORE_REALMS, codes, "Chinese realms")
    assert not absent, message


@pytest.mark.django_db
def test_all_three_tenants_seeded(seeded):
    codes = set(Tenant.objects.filter(code__in=TENANT_CODES).values_list("code", flat=True))
    absent, message = _missing(TENANT_CODES, codes, "tenants")
    assert not absent, message


@pytest.mark.django_db
def test_every_seeded_row_belongs_to_a_tenant(seeded):
    """No row is left tenant-less.

    The original script defined the tenant lookup helpers and then never called
    them, so every realm and actor it wrote had tenant=NULL — invisible to
    tenant-scoped queries and, because the actor uniqueness constraint includes
    tenant, not even protected from duplicates (NULL != NULL in Postgres).
    """
    orphan_realms = sorted(
        Realm.objects.filter(tenant__isnull=True).values_list("realm_code", flat=True)
    )
    orphan_actors = sorted(
        Actor.objects.filter(tenant__isnull=True).values_list("name", flat=True)
    )
    assert not orphan_realms, f"Realms seeded without a tenant: {orphan_realms}"
    assert not orphan_actors, f"Actors seeded without a tenant: {orphan_actors}"


@pytest.mark.django_db
def test_actors_are_attached_to_a_realm(seeded):
    """Every seeded actor resolves its realm FK.

    A typo in a realm_code inside the command's actor table degrades silently
    to realm=None. This is the check that turns that into a failure.
    """
    detached = sorted(
        Actor.objects.filter(realm__isnull=True).values_list("name", flat=True)
    )
    assert not detached, (
        f"Actors seeded with no realm — their realm_code in seed_mythology "
        f"matches nothing in the realm table: {detached}"
    )


@pytest.mark.django_db
def test_actor_civilization_matches_its_realm(seeded):
    """An actor never lands in another civilization's realm.

    The old name-keyword civilization guess filed Ma'at, Pluto and Lethe under
    CHINESE while attaching them to Egyptian and European realms.
    """
    rows = Actor.objects.filter(realm__isnull=False).values_list(
        "name", "civilization", "realm__realm_code", "realm__civilization"
    )
    crossed = sorted(
        f"{name} ({actor_civ} actor in {realm_code}/{realm_civ} realm)"
        for name, actor_civ, realm_code, realm_civ in rows
        if actor_civ != realm_civ
    )
    assert not crossed, f"Actors seeded into another civilization's realm: {crossed}"


# --------------------------------------------------------------------------
# Idempotency
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_second_run_adds_no_rows(seeded):
    """Re-running the command is a no-op: no new rows, no error."""
    before = (
        Tenant.objects.count(),
        Realm.objects.count(),
        Actor.objects.count(),
    )
    output = _seed()
    after = (
        Tenant.objects.count(),
        Realm.objects.count(),
        Actor.objects.count(),
    )
    assert after == before, (
        f"Second seed_mythology run changed row counts "
        f"(tenants, realms, actors): {before} -> {after}"
    )
    assert "created=0" in output, (
        f"Second run reported creations in its summary — it is not idempotent.\n{output}"
    )


@pytest.mark.django_db
def test_second_run_with_update_adds_no_rows(seeded):
    """--update reconciles in place; it must not insert a parallel set of rows."""
    before = (Realm.objects.count(), Actor.objects.count())
    _seed(update=True)
    after = (Realm.objects.count(), Actor.objects.count())
    assert after == before, (
        f"seed_mythology --update inserted rows instead of updating "
        f"(realms, actors): {before} -> {after}"
    )


@pytest.mark.django_db
def test_third_run_leaves_identical_rows(seeded):
    """Row identity is stable across runs — no delete-and-recreate churn."""
    before = set(Realm.objects.values_list("id", flat=True)) | set(
        Actor.objects.values_list("id", flat=True)
    )
    _seed()
    after = set(Realm.objects.values_list("id", flat=True)) | set(
        Actor.objects.values_list("id", flat=True)
    )
    assert after == before, (
        f"Re-running replaced rows rather than matching them. "
        f"Vanished: {sorted(str(i) for i in before - after)}; "
        f"new: {sorted(str(i) for i in after - before)}"
    )


# --------------------------------------------------------------------------
# Flags
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_dry_run_writes_nothing(db):
    output = _seed(dry_run=True)
    assert Realm.objects.count() == 0, "--dry-run wrote realms to the database"
    assert Actor.objects.count() == 0, "--dry-run wrote actors to the database"
    assert Tenant.objects.count() == 0, "--dry-run wrote tenants to the database"
    # It still has to *say* what it would have done, or it is useless.
    for code in ("DY_10_YAMA", *DANTE_NINE_CIRCLES, "EG_AARU"):
        assert code in output, f"--dry-run output never mentions {code}:\n{output}"


@pytest.mark.django_db
def test_single_civilization_seeds_only_that_civilization(db):
    _seed(civilization="chinese")

    chinese_names = set(
        Actor.objects.filter(civilization="CHINESE").values_list("name", flat=True)
    )
    absent, message = _missing(TEN_KINGS, chinese_names, "十殿阎罗 actors")
    assert not absent, message

    leaked = sorted(
        Realm.objects.exclude(civilization="CHINESE").values_list("realm_code", flat=True)
    )
    assert not leaked, f"--civilization=chinese also seeded non-Chinese realms: {leaked}"
    assert set(Tenant.objects.values_list("code", flat=True)) == {"CN_DIYU"}, (
        "--civilization=chinese created tenants for the other civilizations"
    )
