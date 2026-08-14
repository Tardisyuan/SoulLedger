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
# The index is the court: TEN_KINGS[0] holds 第一殿, TEN_KINGS[9] holds 第十殿.
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

# The court number each king's title must carry. Three files in this repo used
# to disagree about this (seed_chinese_data.py called 阎罗王 十殿阎王 and swapped
# 平等王/转轮王; init_organizations and apps/workflow/services.py used the
# standard ordering; populate_chinese_actors carried a third "correction" that
# rewrote rows after the fact). The standard ordering won. This mapping is
# spelled out here rather than derived from TEN_KINGS' index so that a reader
# can check it against a source, and so that reordering TEN_KINGS cannot
# silently redefine what the test asserts.
COURT_NUMBERS = {
    "秦广王": (1, "第一殿秦广王"),
    "楚江王": (2, "第二殿楚江王"),
    "宋帝王": (3, "第三殿宋帝王"),
    "五官王": (4, "第四殿五官王"),
    "阎罗王": (5, "第五殿阎罗王"),
    "卞城王": (6, "第六殿卞城王"),
    "泰山王": (7, "第七殿泰山王"),
    "都市王": (8, "第八殿都市王"),
    "平等王": (9, "第九殿平等王"),
    "转轮王": (10, "第十殿转轮王"),
}

# The Greco-Roman cast `manage.py consolidate_eu_pantheon` audits for. Hades,
# not Pluto: Pluto is the same god's Roman name and that command merges the
# pair into Hades, so seeding Pluto would manufacture the duplicate the merge
# exists to remove. Kept in sync by hand with
# consolidate_eu_pantheon.GRECO_ROMAN_EXPECTED — see rule 1 in the docstring.
GRECO_ROMAN_CAST = {
    "Hades": "OVERSEER",
    "Minos": "JUDGE",
    "Aeacus": "JUDGE",
    "Rhadamanthus": "JUDGE",
    "Charon": "CONDUIT",
    "Cerberus": "GUARDIAN",
}

# Norse is out of this system entirely (no judgment concept: destination
# depends on manner of death, not on a verdict). No seed path may create them.
NORSE_NAMES = ["Odin", "Freya", "Hel", "Valkyries"]

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
def test_ten_kings_carry_their_canonical_court_number(seeded):
    """Each king's title names the court he actually presides over.

    This is the check that pins the 十殿阎罗 ordering. Four files used to hold
    four opinions about which king sits where — the two seed paths disagreed
    with apps/org's init_organizations, with apps/workflow/services.py, and
    with each other, and populate_chinese_actors "fixed" the result at runtime.
    Without an assertion, the next person to touch a seed table can quietly
    reintroduce any of those.
    """
    titles = dict(
        Actor.objects.filter(civilization="CHINESE", name__in=TEN_KINGS)
        .values_list("name", "title_zh")
    )
    wrong = {
        name: {"expected": expected_title, "found": titles.get(name)}
        for name, (_court, expected_title) in COURT_NUMBERS.items()
        if titles.get(name) != expected_title
    }
    assert not wrong, (
        "Ten Kings seeded with the wrong court number in title_zh. The canonical "
        "十殿阎罗 ordering is 秦广/楚江/宋帝/五官/阎罗/卞城/泰山/都市/平等/转轮 "
        f"(阎罗王=5, 平等王=9, 转轮王=10). Mismatches: {wrong}"
    )


@pytest.mark.django_db
def test_ten_kings_court_numbers_are_a_permutation_of_one_to_ten(seeded):
    """No court is seeded twice and none is skipped.

    The old data had two kings claiming 第十殿 (阎罗王 as 十殿阎王 and 平等王)
    and nobody at 第五殿. Checking each title individually would not catch that
    class of error if the expectation table itself were edited wrong, so the
    shape of the whole set gets its own assertion.
    """
    seeded_titles = dict(
        Actor.objects.filter(civilization="CHINESE", name__in=TEN_KINGS)
        .values_list("name", "title_zh")
    )
    prefixes = [f"第{n}殿" for n in "一二三四五六七八九十"]
    courts_found = {}
    for name, title in seeded_titles.items():
        for index, prefix in enumerate(prefixes, start=1):
            if title.startswith(prefix):
                courts_found.setdefault(index, []).append(name)
                break

    duplicated = {court: names for court, names in courts_found.items() if len(names) > 1}
    missing = sorted(set(range(1, 11)) - set(courts_found))
    assert not duplicated and not missing, (
        f"The ten courts are not a 1..10 bijection. Courts claimed by more than "
        f"one king: {duplicated}. Courts nobody holds: {missing}. "
        f"Seeded titles: {seeded_titles}"
    )


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
def test_seeded_realms_use_only_the_memory_reset_vocabulary(seeded):
    """Every seeded realm's memory_reset_mechanism is a real enum value.

    Deliberately checks the *rows*, not the field declaration. Django does not
    validate `choices` on `.create()`, so a seed table is free to write any
    string it likes into a column that has a perfectly correct `choices=` list;
    apps/disposition/tests.py::MemoryResetVocabularyTest compares the two
    fields' declarations and would stay green throughout.

    That gap is how "LETIES" — a misspelling of LETHE (忘川) — reached the
    database and survived long enough to need disposition/0009 to rewrite it.
    The seed tables held the literal in eleven EU realm rows, so a fresh seed
    after that migration would have written the old spelling straight back in.
    """
    from apps.disposition.models import MemoryResetMechanism

    allowed = set(MemoryResetMechanism.values)
    offenders = sorted(
        set(
            Realm.objects.exclude(memory_reset_mechanism__in=allowed)
            .exclude(memory_reset_mechanism="")
            .values_list("memory_reset_mechanism", "realm_code")
        )
    )
    assert not offenders, (
        f"seed_mythology wrote memory_reset_mechanism values that are not in "
        f"MemoryResetMechanism {sorted(allowed)} — (value, realm_code): {offenders}"
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
def test_greco_roman_cast_present_with_correct_roles(seeded):
    """Hades, the three judges, Charon and Cerberus all exist, correctly cast.

    `consolidate_eu_pantheon` keeps Christian + Greco-Roman as the two European
    judgment systems and audits this exact roster. The seed used to create only
    Charon, Minos, Cerberus and Pluto, so on a fresh database that audit
    reported Hades, Aeacus and Rhadamanthus MISSING — the audit could not pass
    on any database this project ships.
    """
    found = dict(
        Actor.objects.filter(civilization="EUROPEAN", name__in=GRECO_ROMAN_CAST)
        .values_list("name", "role")
    )
    absent = [name for name in GRECO_ROMAN_CAST if name not in found]
    miscast = {
        name: {"expected": expected, "found": found[name]}
        for name, expected in GRECO_ROMAN_CAST.items()
        if name in found and found[name] != expected
    }
    assert not absent and not miscast, (
        f"Greco-Roman cast incomplete or miscast. Not seeded at all: {absent}. "
        f"Seeded with the wrong role: {miscast}. "
        f"consolidate_eu_pantheon audits exactly these six."
    )


@pytest.mark.django_db
def test_hades_is_the_sole_european_overseer(seeded):
    """One overseer per pantheon, and on the Greco-Roman side it is Hades.

    Pluto is Hades' Roman name. Seeding both would put two OVERSEERs in one
    tenant and hand `consolidate_eu_pantheon`'s merge step a duplicate to clean
    up on every fresh database — so Pluto is deliberately not seeded, and this
    asserts it stays that way.
    """
    overseers = sorted(
        Actor.objects.filter(civilization="EUROPEAN", role="OVERSEER")
        .values_list("name", flat=True)
    )
    assert "Hades" in overseers, (
        f"Hades is not seeded as a EUROPEAN OVERSEER. Overseers found: {overseers}"
    )
    assert "Pluto" not in overseers, (
        f"Pluto was seeded alongside Hades — same god, two OVERSEER rows. "
        f"consolidate_eu_pantheon would soft-delete one of them on every fresh "
        f"database. Overseers found: {overseers}"
    )


@pytest.mark.django_db
def test_no_norse_actors_are_seeded(seeded):
    """Norse is out of this system — no seed path may put it back.

    Norse mythology has no judgment step (destination follows manner of death,
    not a verdict), so it cannot be one of this product's judgment systems.
    The earlier decision demoted these rows and kept them; the current one
    removes them. A seed path re-creating them is how that would silently undo
    itself.
    """
    present = sorted(
        Actor.all_objects.filter(name__in=NORSE_NAMES).values_list("name", flat=True)
    )
    assert not present, (
        f"seed_mythology created Norse actors that are supposed to be out of "
        f"this system: {present}. Remove them from the seed tables; use "
        f"`manage.py consolidate_eu_pantheon --purge-norse` for rows that "
        f"already exist in a database."
    )


@pytest.mark.django_db
def test_consolidate_eu_pantheon_audit_is_clean_after_seeding(seeded):
    """A freshly seeded database passes the EU consolidation audit.

    End-to-end check of the two commands together, which is where the gap
    actually showed: `seed_mythology` and `consolidate_eu_pantheon` each looked
    fine on their own, but the second one's Step 2 audit reported every
    Greco-Roman name MISSING against a database the first one had just filled.
    """
    out = io.StringIO()
    call_command("consolidate_eu_pantheon", stdout=out, stderr=out)
    output = out.getvalue()

    missing_lines = [line.strip() for line in output.splitlines() if "MISSING" in line]
    assert not missing_lines, (
        "consolidate_eu_pantheon still reports missing actors against a "
        "freshly seeded database:\n" + "\n".join(missing_lines)
        + f"\n\nFull output:\n{output}"
    )
    assert "Hades is sole OVERSEER" in output, (
        f"The audit did not report a clean pass, so the assertion above may be "
        f"passing because the audit never ran.\n{output}"
    )


@pytest.mark.django_db
def test_consolidate_eu_pantheon_finds_nothing_to_merge_after_seeding(seeded):
    """Seeding does not hand the merge step work to do.

    If both Pluto and Hades were seeded, this command would soft-delete one of
    them every time a fresh database was set up, with the survivor decided by
    insertion order. Nothing to merge is the correct post-seed state.
    """
    out = io.StringIO()
    call_command("consolidate_eu_pantheon", stdout=out, stderr=out)
    output = out.getvalue()
    assert "nothing to merge" in output, (
        f"consolidate_eu_pantheon found a Pluto/Hades merge to perform on a "
        f"freshly seeded database — seeding created both names.\n{output}"
    )
    assert "Nothing to do" in output, (
        f"consolidate_eu_pantheon has changes queued against a freshly seeded "
        f"database; seed and consolidation disagree about the target state.\n{output}"
    )


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
