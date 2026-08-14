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
# standard ordering; the now-deleted populate_chinese_actors carried a third
# "correction" that rewrote rows after the fact). The standard ordering won.
# This mapping is spelled out here rather than derived from TEN_KINGS' index so
# that a reader can check it against a source, and so that reordering TEN_KINGS
# cannot silently redefine what the test asserts.
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

# court number -> the realm that court *is*. The court used to live only in the
# king's title, because there were eight Chinese hell realms for ten courts and
# five of them held two or three kings each; the realm a soul was sent to could
# not say which court had sent it. Spelled out rather than built with an
# f-string so a reader can check the codes against seed_mythology's
# CHINESE_REALMS by eye, and so a typo in one table cannot be reproduced by the
# other.
TEN_COURT_REALMS = {
    1: "DY_COURT_01_QINGUANG",
    2: "DY_COURT_02_CHUJIANG",
    3: "DY_COURT_03_SONGDI",
    4: "DY_COURT_04_WUGUAN",
    5: "DY_COURT_05_YANLUO",
    6: "DY_COURT_06_BIANCHENG",
    7: "DY_COURT_07_TAISHAN",
    8: "DY_COURT_08_DUSHI",
    9: "DY_COURT_09_PINGDENG",
    10: "DY_COURT_10_ZHUANLUN",
}

# Realms that used to sit among the Chinese hells and must not come back. They
# are 小地狱 (a sword-tree grove, an ice pit, a copper cauldron) — punishments
# administered inside a court, not courts. realms/0012 retires them.
RETIRED_SUB_HELLS = ["DY_07_JIAN", "DY_08_HAN", "DY_09_YANG"]

# Named judicial personnel who are not one of the ten kings, as
# (role, title_zh, realm_code). Each is depended on by something outside the
# seed: 魏征 opens the 申诉审判流程 appeal template in apps/workflow/services.py,
# 崔府君 and 魏征 hold 四大判官 org units in apps/org's init_organizations, and
# 地藏 is the Chinese overseer named in apps/perm/migrations/0015. The only
# thing that ever created them was a `populate_chinese_actors` command that
# raised AttributeError on invocation (bare `run()`, no `Command` class), so no
# database could actually have them. Folding them into seed_mythology is what
# these two checks protect.
JUDICIAL_PERSONNEL = {
    "魏征": ("JUDGE", "察查司正堂", "DY_COURT_05_YANLUO"),
    "崔府君": ("JUDGE", "崔判官", "DY_COURT_05_YANLUO"),
    "地藏王菩萨": ("OVERSEER", "地藏王菩萨", "DY_COURT_01_QINGUANG"),
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

# Realms the Chinese and Egyptian sides cannot work without. 阎罗殿 is
# DY_COURT_05_YANLUO since the ten courts became ten realms; it was DY_10_YAMA
# back when the code's number was the realm's position in the seed list rather
# than the court its king presides over.
CHINESE_CORE_REALMS = ["DY_00_PURGATORY", "DY_COURT_05_YANLUO"]
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
    with each other, and populate_chinese_actors (since deleted) "fixed" the
    result at runtime. Without an assertion, the next person to touch a seed
    table can quietly reintroduce any of those.
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


# --------------------------------------------------------------------------
# The courts as places
#
# The four checks below are the realm-side half of the court numbering. The
# tests above pin which court each king *presides over*; these pin which realm
# each court *is*, and that the two agree. They are separate assertions because
# they used to have separate answers: the titles said 阎罗王 sits in the fifth
# court while the realm he was attached to was called 第十殿 / "Tenth Court
# Yama", and there were only eleven Chinese realms for ten courts plus a
# heaven, a palace and a purgatory — so five realms held two or three kings
# each and three of the eleven were named after punishments rather than courts.
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_the_ten_courts_are_exactly_the_ten_chinese_hell_realms(seeded):
    """One realm per court, no more and no fewer.

    The old data had eight HELL realms for ten courts. Any fix that adds courts
    without removing the leftovers, or that reintroduces a punishment-named
    realm (剑树狱/寒冰狱/烊铜狱) beside them, fails here rather than quietly
    leaving the Chinese hells over-populated again.
    """
    found = sorted(
        Realm.objects.filter(civilization="CHINESE", realm_type="HELL")
        .values_list("realm_code", flat=True)
    )
    expected = sorted(TEN_COURT_REALMS.values())
    assert found == expected, (
        "The Chinese HELL realms are not the ten courts. "
        f"Expected exactly {expected}, found {found}. Extra: "
        f"{sorted(set(found) - set(expected))}. Missing: "
        f"{sorted(set(expected) - set(found))}."
    )


@pytest.mark.django_db
def test_each_court_realm_carries_its_court_number_as_its_tier(seeded):
    """`tier` is the court number — the same number as in the code and the name.

    `tier` used to mean two things at once on these rows: the court's position
    and the karma bucket `DispositionService` routed into. That is why
    DY_03_QISHI, tier 3, was displayed as "Seventh Court Qishi" and nothing
    complained. The bucket now lives in DispositionService.CHINESE_HELL_TIERS
    and `tier` means one thing.
    """
    realms = {
        r.realm_code: r
        for r in Realm.objects.filter(civilization="CHINESE", realm_type="HELL")
    }
    wrong = {
        code: {"expected_tier": court, "found_tier": realms[code].tier,
               "found_name_local": realms[code].name_local}
        for court, code in TEN_COURT_REALMS.items()
        if code in realms
        and (realms[code].tier != court
             or realms[code].name_local != f"第{'一二三四五六七八九十'[court - 1]}殿")
    }
    assert not wrong, (
        "Court realms whose tier or 殿号 does not match their court number. "
        f"tier must equal the NN in DY_COURT_NN_*: {wrong}"
    )


@pytest.mark.django_db
def test_each_king_sits_in_his_own_court_realm(seeded):
    """King N is in DY_COURT_NN, and no realm holds two kings.

    This is the assertion that would have caught the original defect directly:
    秦广王 and 楚江王 both pointed at DY_03_QISHI, and 阎罗王 and 平等王 both at
    DY_10_YAMA, so "which court is this soul in" had no answer from the realm
    alone.
    """
    seated = {
        name: code
        for name, code in Actor.objects.filter(
            civilization="CHINESE", name__in=TEN_KINGS
        ).values_list("name", "realm__realm_code")
    }
    misseated = {
        name: {"expected": TEN_COURT_REALMS[court], "found": seated.get(name)}
        for name, (court, _title) in COURT_NUMBERS.items()
        if seated.get(name) != TEN_COURT_REALMS[court]
    }
    assert not misseated, (
        f"Kings seated in the wrong court realm: {misseated}"
    )

    shared = {
        code: sorted(n for n, c in seated.items() if c == code)
        for code in set(seated.values())
    }
    doubled = {code: names for code, names in shared.items() if len(names) > 1}
    assert not doubled, (
        f"One realm holding more than one king — the defect this replaced: {doubled}"
    )


@pytest.mark.django_db
def test_court_realm_display_names_match_their_king_title(seeded):
    """A court's name and its king's title are the same string.

    Two tables carry the court number in prose — Realm.name_zh/name_en and
    Actor.title_zh/title_en — and they drifted apart once already. Asserting
    equality rather than two independent expectations means a rename has to
    happen in both places or fail here.
    """
    realms = {
        r.realm_code: r
        for r in Realm.objects.filter(civilization="CHINESE", realm_type="HELL")
    }
    kings = {
        a.name: a
        for a in Actor.objects.filter(civilization="CHINESE", name__in=TEN_KINGS)
    }
    mismatched = {}
    for name, (court, _title) in COURT_NUMBERS.items():
        realm, king = realms.get(TEN_COURT_REALMS[court]), kings.get(name)
        if realm is None or king is None:
            continue
        if realm.name_zh != king.title_zh or realm.name_en != king.title_en:
            mismatched[name] = {
                "realm": (realm.name_zh, realm.name_en),
                "actor_title": (king.title_zh, king.title_en),
            }
    assert not mismatched, (
        f"Court realm names disagree with their king's title: {mismatched}"
    )


@pytest.mark.django_db
def test_retired_sub_hells_are_not_seeded(seeded):
    """剑树狱 / 寒冰狱 / 烊铜狱 do not come back as realms.

    They are 小地狱 — instruments used inside a court — and were realms only
    because the courts were not. realms/0012 tombstones them on existing
    databases; this is the fresh-database half, and it also guards against
    someone re-adding them to CHINESE_REALMS to "restore" the old ladder.
    """
    resurrected = sorted(
        Realm.all_objects.filter(realm_code__in=RETIRED_SUB_HELLS)
        .values_list("realm_code", flat=True)
    )
    assert not resurrected, (
        f"Retired 小地狱 seeded as realms again: {resurrected}. They belong "
        f"inside a court, not beside one."
    )


@pytest.mark.django_db
def test_named_judicial_personnel_present(seeded):
    """魏征, 崔府君 and 地藏王菩萨 are seeded alongside the ten kings.

    Three parts of the app already assume these rows exist — the appeal
    workflow template, the 四大判官 org units, and the per-civilization overseer
    role — but the only thing that created them was a management command that
    raised AttributeError the moment it was invoked.
    """
    names = set(
        Actor.objects.filter(civilization="CHINESE", name__in=JUDICIAL_PERSONNEL)
        .values_list("name", flat=True)
    )
    absent, message = _missing(list(JUDICIAL_PERSONNEL), names, "Chinese judicial personnel")
    assert not absent, message


@pytest.mark.django_db
def test_named_judicial_personnel_carry_their_role_title_and_realm(seeded):
    """Each is cast correctly and attached to the realm it holds office in.

    The realm assertion is the one that matters most: the deleted command
    resolved realms by display string (``name_zh='阎罗殿'``), which silently
    degraded to ``realm=None`` whenever a name was edited. These match on
    realm_code.
    """
    found = {
        name: (role, title_zh, realm_code)
        for name, role, title_zh, realm_code in Actor.objects.filter(
            civilization="CHINESE", name__in=JUDICIAL_PERSONNEL
        ).values_list("name", "role", "title_zh", "realm__realm_code")
    }
    wrong = {
        name: {"expected": expected, "found": found.get(name)}
        for name, expected in JUDICIAL_PERSONNEL.items()
        if found.get(name) != expected
    }
    assert not wrong, (
        f"Chinese judicial personnel seeded with the wrong (role, title_zh, "
        f"realm_code): {wrong}"
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
def test_every_realm_disposition_routing_can_return_actually_exists(seeded):
    """Every realm_code DispositionService can hand back resolves to a realm.

    `create_from_judgment` does ``Realm.objects.filter(realm_code=...).first()``
    and stores whatever comes back, so a code that matches nothing does not
    raise — it produces a disposition with ``destination_realm=None``, a soul
    judged and sentenced to nowhere. Nothing else in the suite would notice: the
    routing tests compare codes to the same constants the router reads, so they
    agree with a typo just as happily as with a correct code.

    This is the check that keeps the routing table and the seed table honest
    with each other, and it is why the ten courts renaming had to touch both.
    """
    from apps.disposition.services import DispositionService

    routable = {
        DispositionService.CHINESE_PURGATORY,
        DispositionService.CHINESE_HEAVEN,
        DispositionService.EU_HEAVEN,
        DispositionService.EU_PURGATORY,
        DispositionService.EG_AARU,
        DispositionService.EG_DEVOURER,
        DispositionService.EG_DUAT_ENTRY,
        *DispositionService.CHINESE_HELL_TIERS.values(),
        *DispositionService.EU_HELL_CIRCLES.values(),
    }
    seeded_codes = set(Realm.objects.values_list("realm_code", flat=True))
    absent, message = _missing(sorted(routable), seeded_codes, "routable realms")
    assert not absent, (
        f"{message}\nDispositionService can route a soul to these codes but no "
        f"seeded realm answers to them, so the disposition would be written "
        f"with destination_realm=None."
    )


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
    for code in ("DY_COURT_05_YANLUO", *DANTE_NINE_CIRCLES, "EG_AARU"):
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
