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

# --------------------------------------------------------------------------
# WHERE EACH ACTOR STANDS, NOT JUST WHAT IT IS.
#
# Every placement table below carries (role, realm_code), and that second
# column is the whole reason these tables were rewritten on 2026-08-15. Until
# then this file and consolidate_eu_pantheon.GRECO_ROMAN_EXPECTED both locked
# the role and said nothing about the realm, and role is the column that
# happened to be right. Fourteen actors stood somewhere no source puts them and
# every check in the repo reported OK:
#
#   Minos in Dante's ninth circle, with a description of the work his Minos
#   does at the entrance to the second; Aeacus and Rhadamanthus in the ninth
#   circle of a poem neither of them appears in; Charon in Purgatory, whose
#   boatman is an angel; Cerberus in Limbo; Hades in Limbo; Michael judging;
#   Satan judging; Horus guarding a gate; Isis, Nephthys and Ra in the Field of
#   Reeds, which is where the acquitted go after the judgment they attend;
#   Ammit in a realm named after her; Ma'at on the bench that applies her own
#   feather; 孟婆 serving the broth of forgetting to souls not yet tried.
#
# A check that verifies one column of a two-column fact goes green at exactly
# the rate the other column goes wrong. These tables are the fix, and the
# mutation check is: move any one actor to a realm it does not belong in and
# both this file and `manage.py consolidate_eu_pantheon` must go red naming who,
# where they should be, and where they actually are.
# --------------------------------------------------------------------------

# The Greco-Roman cast `manage.py consolidate_eu_pantheon` audits for, as
# (role, realm_code). Hades, not Pluto: same god, and that command merges the
# pair into Hades, so seeding Pluto would manufacture the duplicate the merge
# exists to remove. Kept in sync by hand with
# consolidate_eu_pantheon.GRECO_ROMAN_EXPECTED — see rule 1 in the docstring.
#
# The sources, one per row:
#   Hades        EU_PLATO_MEADOW  overseer of the Greek judgment ground. The one
#                                 engineering placement of the six — no house of
#                                 Hades is modelled, and Limbo was not one.
#   Minos        EU_HELL_2ND      Dante, Inferno V.4-15.
#   Aeacus       EU_PLATO_MEADOW  Plato, Gorgias 524a (those from Europe).
#   Rhadamanthus EU_PLATO_MEADOW  Plato, Gorgias 524a (those from Asia).
#   Charon       EU_ACHERON       Virgil, Aeneid 6.295-297; Dante, Inferno III.
#   Cerberus     EU_HELL_3RD      Dante, Inferno VI.
GRECO_ROMAN_CAST = {
    "Hades": ("OVERSEER", "EU_PLATO_MEADOW"),
    "Minos": ("JUDGE", "EU_HELL_2ND"),
    "Aeacus": ("JUDGE", "EU_PLATO_MEADOW"),
    "Rhadamanthus": ("JUDGE", "EU_PLATO_MEADOW"),
    "Charon": ("CONDUIT", "EU_ACHERON"),
    "Cerberus": ("GUARDIAN", "EU_HELL_3RD"),
}

# The two Greek places, added because the Greek cast had none. All eleven
# European realms were Christian or Dantean while seven of the eleven European
# actors are Greek, so every Greek figure had been filed into whichever Dantean
# row looked nearest — which is how five of six ended up misplaced at once.
GREEK_REALMS = ["EU_ACHERON", "EU_PLATO_MEADOW"]

# The Christian cast, as (role, realm_code). Christ is the row that did not
# exist: `grep -i 'christ\|jesus\|基督\|耶稣'` matched nothing anywhere in this
# repo while John 5:22, the Nicene Creed and CCC 1021-1041 all name him as the
# one who judges the living and the dead. The JUDGE role had gone to Michael
# (soul-weighing is medieval iconography borrowed from Egyptian psychostasia,
# not doctrine; his liturgical office is *signifer sanctus Michael repraesentet
# eas in lucem sanctam*, which is CONDUIT) and to Satan (the accuser of Rev
# 12:10, and in Dante an instrument of punishment frozen in Cocytus — neither
# is a judge).
CHRISTIAN_CAST = {
    "Christ": ("JUDGE", "EU_HEAVEN"),
    "God": ("OVERSEER", "EU_HEAVEN"),
    "Michael": ("CONDUIT", "EU_HEAVEN"),
    "Gabriel": ("CONDUIT", "EU_HEAVEN"),
    "Satan": ("EXECUTOR", "EU_HELL_9TH"),
}

# The Egyptian principals — the weighing-scene cast, as (role, realm_code).
# Every one of them is in the Hall, because the Papyrus of Ani plates III-IV
# and the Hunefer papyrus (BM EA 9901/3) draw one scene in one room: Anubis
# works the balance, Thoth records and reports, Ammit waits beside the scales,
# Horus leads the vindicated forward, Osiris receives him with Isis and
# Nephthys behind the throne, and Ra heads the row of twelve gods above.
#
# Two roles here are the least-wrong value rather than the right one, and the
# assertion is deliberately made on them anyway. ActorRole has no term for "works
# the instrument" (Anubis, left JUDGE) or "is the standard" (Ma'at, demoted to
# GUARDIAN because her feather is the counterweight in the pan and JUDGE seated
# the measure among the people applying it). Locking the compromise is what
# makes it visible when someone revisits it.
EGYPTIAN_PRINCIPALS_PLACED = {
    "Osiris": ("JUDGE", "EG_HALL_TWO_TRUTHS"),
    "Anubis": ("JUDGE", "EG_HALL_TWO_TRUTHS"),
    "Thoth": ("JUDGE", "EG_HALL_TWO_TRUTHS"),
    "Ma'at": ("GUARDIAN", "EG_HALL_TWO_TRUTHS"),
    "Ammit": ("EXECUTOR", "EG_HALL_TWO_TRUTHS"),
    "Horus": ("CONDUIT", "EG_HALL_TWO_TRUTHS"),
    "Isis": ("CONDUIT", "EG_HALL_TWO_TRUTHS"),
    "Nephthys": ("CONDUIT", "EG_HALL_TWO_TRUTHS"),
    "Ra": ("OVERSEER", "EG_HALL_TWO_TRUTHS"),
}

# A realm that must never be seeded again. "Amtyat" is not an Egyptian place —
# absent from Budge's Book of the Dead glossary, from Egyptian Heaven and Hell
# II, from UCL Digital Egypt, from museum records and from search. It is most
# likely Am-Tuat (the title of a book, the Amduat) or Amentet ("the West")
# turned into a border realm. realms/0013 tombstones it on existing databases;
# this list is what stops the seed table re-creating it on fresh ones.
UNATTESTED_REALMS = ["EG_AM_TYAT"]

# The Chinese cast who are not one of the ten kings and not one of the three
# named judicial personnel, as (role, realm_code). 孟婆 is the reason this table
# exists: she was in DY_00_PURGATORY, pouring the broth of forgetting into souls
# that had not been tried yet, while DY_COURT_10_ZHUANLUN's own description said
# the broth is drunk after sentence. 《玉历宝钞》 puts her 醧忘台 「居第十殿，冥王
# 殿前六桥之外」.
#
# 牛头/马面 stay in the holding pen deliberately. 《玉历》 names them at the fifth
# court 「牛头、马面，押赴高台」, but escort duty is not confined to one court and
# that is the only place the text happens to mention them; the description
# carries the reference instead. 钟馗 likewise keeps a posting the sources do
# not give him — he appears nowhere in 《玉历宝钞》 at all — and his description
# says so.
CHINESE_ATTENDANTS = {
    "孟婆": ("CONDUIT", "DY_COURT_10_ZHUANLUN"),
    "牛头": ("GUARDIAN", "DY_00_PURGATORY"),
    "马面": ("GUARDIAN", "DY_00_PURGATORY"),
    "白无常": ("CONDUIT", "DY_00_PURGATORY"),
    "黑无常": ("CONDUIT", "DY_00_PURGATORY"),
    "判官": ("JUDGE", "DY_COURT_05_YANLUO"),
    "钟馗": ("EXECUTOR", "DY_COURT_05_YANLUO"),
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
EGYPTIAN_VERDICT_REALMS = ["EG_AARU", "EG_ANNIHILATION"]

# The Forty-Two Assessors of Ma'at, Book of the Dead chapter 125 part B, in the
# order of the Papyrus of Nebseni (Budge's transliteration; BM EA 9900 sheet
# 30). The index in this list is the assessor's position in the bench:
# FORTY_TWO_ASSESSORS[0] is the first addressed, FORTY_TWO_ASSESSORS[41] the
# last. Spelled out here rather than imported from seed_mythology, per rule 1 in
# the module docstring — and here the rule earns its keep twice over, because
# this is a roster the repo has already got wrong once. The block this replaced
# held 33 names that were not assessors at all (major deities, the four sons of
# Horus, personified concepts) assembled from a stray sentence about "nine great
# judges"; an imported expectation would have ratified whatever the seed table
# happened to say, which is exactly how that list survived.
FORTY_TWO_ASSESSORS = [
    "Usekht-nemmat",
    "Hept-shet",
    "Fenti",
    "Am-khaibetu",
    "Neha-hau",
    "Rerti",
    "Maati-f-em-tes",
    "Neba-per-em-khetkhet",
    "Set-kesu",
    "Uatch-nes",
    "Qerti",
    "Hetch-abehu",
    "Am-senf",
    "Am-beseku",
    "Neb-Maat",
    "Thenemi",
    "Aati",
    "Tutu-f",
    "Uamemti",
    "Maa-an-f",
    "Heri-seru",
    "Khemi",
    "Shet-kheru",
    "Nekhen",
    "Ser-kheru",
    "Basti",
    "Hra-f-ha-f",
    "Ta-ret",
    "Kenemti",
    "An-hetep-f",
    "Neb-hrau",
    "Serekhi",
    "Neb-abui",
    "Nefer-Tem",
    "Tem-sep",
    "Ari-em-ab-f",
    "Ahi-mu",
    "Utu-rekhit",
    "Neheb-nefert",
    "Neheb-kau",
    "Tcheser-tep",
    "An-a-f",
]

# Every Egyptian actor that is NOT one of the Forty-Two. `Set` is seeded only by
# backend/scripts/populate_egyptian_actors.py, never by the command, but it is
# listed here so that a future decision to fold Set into the command cannot
# silently create a name clash with the bench.
EGYPTIAN_PRINCIPALS = [
    "Osiris", "Anubis", "Thoth", "Ma'at", "Ammit",
    "Horus", "Isis", "Nephthys", "Ra", "Set",
]

# Two assessor names sit one vowel away from a major deity who is not currently
# seeded: #34 Nefer-Tem beside Nefertem, #26 Basti beside Bastet. If either
# deity is ever added to EGYPTIAN_ACTORS under these exact spellings, the
# seeder's (civilization, name) match key would fold the deity into the
# assessor's row instead of creating a second one — the same class of bug that
# 'Ra' and 'Maat' caused in the deleted 33-name list, but silent, because a
# merge produces no duplicate for fix_actor_civilization to find.
ASSESSOR_NAMES_RESERVED_AGAINST_DEITIES = {
    "Nefer-Tem": 34,
    "Basti": 26,
}

# Assessors whose source entry is flagged as uncertain or incomplete, and which
# must therefore still be carrying that flag in the data. The prose of each note
# is deliberately NOT asserted — only that a note is present — so that improving
# the wording is free but deleting the caveat is not. #8's home place is empty
# because the text gives none ("who comest forth as [thou] goest back"), which
# is a fact about the text and not a gap to be filled in.
ASSESSORS_WITH_SOURCE_CAVEATS = {
    8: "no home place in the text",
    32: "confession clause partly unreadable in the scan",
    37: "name reading is Budge's own query",
    38: "home place is Budge's own query, second witness disagrees",
    39: "home place is Budge's own query, second witness disagrees",
}

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


def _placement_faults(civilization, expected, what):
    """Compare a {name: (role, realm_code)} table against the database.

    Returns a message when anything is absent, miscast or standing in the wrong
    realm, and None when every row matches. Role and realm are reported
    separately, so a row that is wrong in both columns says so twice instead of
    hiding the second fault behind the first — and every line names the actor,
    the realm the source puts it in, and the realm it is actually in, because a
    failure that says only "wrong realm" sends the reader back to the seed table
    to find out what right looks like.
    """
    found = {
        name: (role, realm_code)
        for name, role, realm_code in Actor.objects.filter(
            civilization=civilization, name__in=expected
        ).values_list("name", "role", "realm__realm_code")
    }

    absent = [name for name in expected if name not in found]
    miscast = [
        f"{name}: role={found[name][0]}, expected {role}"
        for name, (role, _) in expected.items()
        if name in found and found[name][0] != role
    ]
    misplaced = [
        f"{name}: belongs in {realm_code}, found in "
        f"{found[name][1] or 'no realm at all'}"
        for name, (_, realm_code) in expected.items()
        if name in found and found[name][1] != realm_code
    ]

    if not (absent or miscast or misplaced):
        return None
    return (
        f"{what} is wrong in a seeded database.\n"
        f"  Not seeded at all: {absent}\n"
        f"  Wrong role: {miscast}\n"
        f"  Wrong realm: {misplaced}\n"
        f"The realm half of this check is the one that matters: role alone was "
        f"all this file locked until 2026-08-15, and fourteen actors stood "
        f"somewhere no source puts them the whole time it was green."
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
def test_chinese_attendants_carry_their_role_and_realm(seeded):
    """The non-king Chinese cast stands where it stands, 孟婆 above all.

    孟婆 was in DY_00_PURGATORY, serving the broth of forgetting to souls that
    had not been tried yet — which would have every soul face its court with no
    memory of the life being judged. 《玉历宝钞》「孟婆神」 puts her 醧忘台 「居第
    十殿，冥王殿前六桥之外」 and has the broth drunk after sentence, on the way to
    the next life. DY_COURT_10_ZHUANLUN's own realm description already said so,
    so the two tables described the same act two incompatible ways and nothing
    compared them.

    牛头/马面 and 钟馗 are pinned here at postings that are admitted compromises
    rather than sourced facts — the escort pair are named at the fifth court but
    work across all ten, and 钟馗 appears nowhere in 《玉历宝钞》 at all. Pinning a
    compromise is the point: it stays visible, and moving it becomes a decision
    rather than a drift.
    """
    fault = _placement_faults(
        "CHINESE", CHINESE_ATTENDANTS, "The Chinese attendant cast"
    )
    assert fault is None, fault


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
def test_the_weighing_cast_all_stands_in_the_hall(seeded):
    """One scene, one room — and six of the nine used to be somewhere else.

    Budge's Papyrus of Ani plates III-IV and the British Museum's Hunefer
    papyrus (BM EA 9901/3) draw the same procedure with the same cast in one
    hall: Anubis tests the tongue of the balance, Thoth stands behind him with
    reed-pen and palette and records the result, Ammit waits beside the scales,
    the Ennead ratifies, Horus takes the vindicated by the hand and leads him
    forward, and Osiris receives him enthroned with Isis and Nephthys behind
    him, under a row of twelve gods headed by Ra.

    Horus had been a GUARDIAN at the gate of the Duat, a post no source gives
    him. Isis, Nephthys and Ra were in the Field of Reeds, which is where the
    acquitted go *after* the judgment these three attend. Ammit was in a realm
    named after her. Ma'at was on the bench, when her feather is what goes into
    the pan.
    """
    fault = _placement_faults(
        "EGYPTIAN", EGYPTIAN_PRINCIPALS_PLACED, "The Egyptian weighing cast"
    )
    assert fault is None, fault


@pytest.mark.django_db
def test_no_unattested_realm_is_seeded(seeded):
    """A realm nobody could find a source for does not come back.

    `EG_AM_TYAT` / "Path of Amtyat" survived in the seed table because nothing
    ever asked where it came from. It is not in Budge's Book of the Dead
    glossary, not in Egyptian Heaven and Hell II, not in UCL Digital Egypt, not
    in any museum record and not in general search; the likely origins are
    Am-Tuat (the *title of a book*, the Amduat) and Amentet ("the West"), i.e.
    a book or a direction turned into a border realm.

    Checked through `all_objects`, so a row soft-deleted by realms/0013 and then
    re-created by an edited seed table is still caught — `Realm.objects` would
    hide the tombstone and see only the fresh row.
    """
    resurrected = sorted(
        Realm.all_objects.filter(realm_code__in=UNATTESTED_REALMS, is_deleted=False)
        .values_list("realm_code", flat=True)
    )
    assert not resurrected, (
        f"Unattested realms are alive in a freshly seeded database: "
        f"{resurrected}. realms/0013 retired them and the seed table must not "
        f"put them back. If a source has since been found, replace this list "
        f"entry with the citation rather than deleting the check."
    )


# --------------------------------------------------------------------------
# The Forty-Two Assessors of Ma'at
#
# BD chapter 125 seats a bench of 42 beside the weighing, each addressed by
# name, each with a home town, each paired with one clause of the negative
# confession. The repo carried a fake version of this roster for a long time —
# 33 major deities and personified concepts padded out to look like a list — so
# these checks are written to fail loudly on both of the ways it can go wrong
# again: a name that is not an assessor getting in, and the bench losing its
# order.
# --------------------------------------------------------------------------


def _assessors():
    """Every seeded Egyptian actor that claims a place in the bench of 42."""
    return {
        actor.name: actor
        for actor in Actor.objects.filter(civilization="EGYPTIAN")
        if isinstance(actor.powers_json, dict)
        and actor.powers_json.get("assessor_index") is not None
    }


@pytest.mark.django_db
def test_forty_two_assessors_all_present(seeded):
    """All 42 assessors of BD chapter 125 exist as EGYPTIAN Actors."""
    names = set(
        Actor.objects.filter(civilization="EGYPTIAN", name__in=FORTY_TWO_ASSESSORS)
        .values_list("name", flat=True)
    )
    absent, message = _missing(FORTY_TWO_ASSESSORS, names, "assessors of Ma'at")
    assert not absent, message


@pytest.mark.django_db
def test_the_bench_holds_exactly_forty_two_and_nobody_else(seeded):
    """Nothing extra wears an assessor_index, and nothing is missing one.

    The set-equality is the point. Checking only that the 42 expected names are
    present would stay green if a forty-third row were seeded alongside them —
    which is precisely the shape of the defect this roster replaced.
    """
    found = sorted(_assessors())
    expected = sorted(FORTY_TWO_ASSESSORS)
    assert found == expected, (
        f"The bench of 42 is not the expected roster. "
        f"Seeded but not expected: {sorted(set(found) - set(expected))}. "
        f"Expected but not seeded: {sorted(set(expected) - set(found))}. "
        f"Total carrying an assessor_index: {len(found)}."
    )


@pytest.mark.django_db
def test_assessor_index_is_a_permutation_of_one_to_forty_two(seeded):
    """Positions 1..42, each used exactly once.

    `assessor_index` is the only thing that records the order the text puts
    these gods in — `Actor.Meta.ordering` is ["civilization", "role", "name"],
    so without it the bench sorts alphabetically. A duplicated or skipped index
    means two assessors claim one seat and one seat is empty, and nothing else
    in the system would notice.
    """
    indices = {}
    for name, actor in _assessors().items():
        indices.setdefault(actor.powers_json["assessor_index"], []).append(name)

    duplicated = {index: sorted(n) for index, n in indices.items() if len(n) > 1}
    missing = sorted(set(range(1, 43)) - set(indices))
    out_of_range = sorted(i for i in indices if not isinstance(i, int) or not 1 <= i <= 42)
    assert not duplicated and not missing and not out_of_range, (
        f"assessor_index is not a 1..42 bijection. Seats claimed by more than "
        f"one assessor: {duplicated}. Seats nobody holds: {missing}. "
        f"Indices outside 1..42: {out_of_range}."
    )


@pytest.mark.django_db
def test_each_assessor_holds_the_seat_the_text_gives_him(seeded):
    """Assessor N is the Nth name in the Nebseni order, not the Nth alphabetically."""
    seated = {
        actor.powers_json["assessor_index"]: name
        for name, actor in _assessors().items()
    }
    misseated = {
        index: {"expected": expected, "found": seated.get(index)}
        for index, expected in enumerate(FORTY_TWO_ASSESSORS, start=1)
        if seated.get(index) != expected
    }
    assert not misseated, (
        f"Assessors seeded in the wrong seat (Papyrus of Nebseni order, "
        f"Budge 1904 pp. 418-419): {misseated}"
    )


@pytest.mark.django_db
def test_the_bench_order_is_not_the_alphabetical_order(seeded):
    """The canonical order genuinely differs from the model's default ordering.

    Not a tautology check on the data — a check that `assessor_index` is load
    bearing. If the bench happened to be in alphabetical order, every display
    that forgot to sort on the index would look correct and the omission would
    never surface. It does not: Aati is 17th in the text and 1st alphabetically.
    """
    by_index = [name for _, name in sorted(
        (actor.powers_json["assessor_index"], name)
        for name, actor in _assessors().items()
    )]
    alphabetical = sorted(by_index)
    assert by_index != alphabetical, (
        "The seeded bench of 42 is in alphabetical order, so nothing would ever "
        "reveal a display that ignores assessor_index. Check the seed table "
        "against the Nebseni order."
    )


@pytest.mark.django_db
def test_every_assessor_is_a_judge_of_the_hall_of_two_truths(seeded):
    """Role JUDGE, realm EG_HALL_TWO_TRUTHS — the bench sits where the text puts it."""
    miscast = {
        name: {"role": actor.role, "realm": getattr(actor.realm, "realm_code", None)}
        for name, actor in _assessors().items()
        if actor.role != "JUDGE"
        or getattr(actor.realm, "realm_code", None) != "EG_HALL_TWO_TRUTHS"
    }
    assert not miscast, (
        f"Assessors seeded with the wrong role or realm — every one of the 42 "
        f"must be a JUDGE in EG_HALL_TWO_TRUTHS: {miscast}"
    )


@pytest.mark.django_db
def test_assessors_carry_their_edition_and_papyrus(seeded):
    """Provenance travels inside the row.

    The failure this roster replaced was unattributed data: 33 names with no
    citation, which is why nobody could tell they were wrong without doing the
    research from scratch. A row that has lost its citation is on its way back
    to that state.
    """
    unattributed = sorted(
        name for name, actor in _assessors().items()
        if not actor.powers_json.get("source_edition")
        or not actor.powers_json.get("papyrus")
    )
    assert not unattributed, (
        f"Assessors seeded without source_edition and papyrus in powers_json: "
        f"{unattributed}. The edition has to be recorded in the data — the "
        f"manuscripts disagree on both the order and the count, so a name "
        f"without an edition is not a checkable claim."
    )


@pytest.mark.django_db
def test_assessors_carry_a_home_place_and_a_confession(seeded):
    """Each row holds the two things the text pairs with the name.

    #8 is the one exception on home place and it is not an exception to the
    rule: the text gives him no town, so the field is empty on purpose and
    ASSESSORS_WITH_SOURCE_CAVEATS records why.
    """
    incomplete = {
        name: {
            "home_place": actor.powers_json.get("home_place"),
            "negative_confession": actor.powers_json.get("negative_confession"),
        }
        for name, actor in _assessors().items()
        if not actor.powers_json.get("negative_confession")
        or (
            not actor.powers_json.get("home_place")
            and actor.powers_json.get("assessor_index")
            not in ASSESSORS_WITH_SOURCE_CAVEATS
        )
    }
    assert not incomplete, (
        f"Assessors missing home_place or negative_confession in powers_json: "
        f"{incomplete}"
    )


@pytest.mark.django_db
def test_flagged_assessors_keep_their_source_caveats(seeded):
    """The uncertain entries stay marked uncertain.

    Five of the 42 are not clean readings: #8 has no home town in the text, #32's
    confession clause is partly unreadable in the scan, #37's name is Budge's own
    query, and #38/#39 carry his question marks on the place where the second
    witness also disagrees. Those flags are the honest part of the roster and are
    the first thing a future tidy-up would delete. Only the presence of a note is
    asserted, never its wording, so the prose can be improved freely.
    """
    by_index = {
        actor.powers_json["assessor_index"]: (name, actor)
        for name, actor in _assessors().items()
    }
    unflagged = {}
    for index, why in ASSESSORS_WITH_SOURCE_CAVEATS.items():
        if index not in by_index:
            continue
        name, actor = by_index[index]
        if not actor.powers_json.get("source_notes"):
            unflagged[index] = {"name": name, "caveat_that_was_dropped": why}
    assert not unflagged, (
        f"Assessors whose source caveat was dropped from powers_json"
        f"['source_notes']: {unflagged}. These readings are uncertain in the "
        f"source; recording them as if they were not is the fabrication this "
        f"roster exists to correct."
    )

    eighth = by_index.get(8)
    assert eighth is None or eighth[1].powers_json.get("home_place") == "", (
        f"Assessor 8 was given a home place ({eighth[1].powers_json.get('home_place')!r}). "
        f"The text gives him none — the formula reads 'who comest forth as [thou] "
        f"goest back'. An empty string is the correct value; a guess is not."
    )


@pytest.mark.django_db
def test_no_assessor_collides_with_an_egyptian_principal(seeded):
    """The bench and the principals share no name.

    The deleted 33-name list collided on 'Ra' and 'Maat', manufacturing on every
    fresh database exactly the duplicate and cross-spelling rows that
    `fix_actor_civilization` exists to clean up.
    """
    collisions = sorted(set(FORTY_TWO_ASSESSORS) & set(EGYPTIAN_PRINCIPALS))
    assert not collisions, (
        f"Assessor names that are also major Egyptian deities: {collisions}. "
        f"The seeder matches on (civilization, name), so a shared name is one "
        f"row wearing two identities."
    )

    duplicated = sorted(
        name for name in FORTY_TWO_ASSESSORS
        if Actor.all_objects.filter(civilization="EGYPTIAN", name=name).count() > 1
    )
    assert not duplicated, (
        f"More than one EGYPTIAN row seeded under an assessor's name: {duplicated}"
    )


@pytest.mark.django_db
def test_nefertem_and_basti_belong_to_the_bench_not_to_the_pantheon(seeded):
    """The two near-miss names are held by assessors, and stay that way.

    #34 Nefer-Tem and #26 Basti are one vowel from the deities Nefertem and
    Bastet, neither of which is seeded. Whoever adds those deities must not
    spell them this way: the seeder matches on (civilization, name), so it would
    quietly overwrite an assessor rather than creating a second actor — a silent
    merge, leaving no duplicate for `fix_actor_civilization` to catch. This test
    is the tripwire on that.
    """
    bench = _assessors()
    wrong = {}
    for name, expected_index in ASSESSOR_NAMES_RESERVED_AGAINST_DEITIES.items():
        actor = bench.get(name)
        if actor is None:
            wrong[name] = "not seeded as an assessor at all"
        elif actor.powers_json.get("assessor_index") != expected_index:
            wrong[name] = (
                f"holds seat {actor.powers_json.get('assessor_index')}, "
                f"expected {expected_index}"
            )
    assert not wrong, (
        f"The names reserved for assessors are no longer held by them: {wrong}. "
        f"If Nefertem or Bastet is being added as a major deity, give the deity "
        f"its own spelling — do not reuse the assessor's."
    )


@pytest.mark.django_db
def test_second_run_creates_no_assessors(seeded):
    """Idempotency for the bench specifically.

    The 42 go through a second seeding pass with its own row builder, so
    "re-running creates nothing" has to be true of that pass and not only of the
    command as a whole.
    """
    before = len(_assessors())
    output = _seed(civilization="egyptian")
    after = len(_assessors())
    assert before == after == 42, (
        f"Re-seeding changed the size of the bench: {before} -> {after} "
        f"(expected 42 both times).\n{output}"
    )
    assert "created=0" in output, (
        f"A second --civilization=egyptian run reported creations — the assessor "
        f"pass is not idempotent.\n{output}"
    )


@pytest.mark.django_db
def test_greek_realms_present(seeded):
    """The Greek cast has Greek ground to stand on.

    Without these two rows there is no place in the system that any of the
    seven Greek actors belongs to, and the only way to give them a realm at all
    is to put them in a circle of Dante's hell — which is how Minos, Aeacus,
    Rhadamanthus, Charon, Cerberus and Hades all came to be misplaced at once.
    """
    codes = set(
        Realm.objects.filter(civilization="EUROPEAN", realm_code__in=GREEK_REALMS)
        .values_list("realm_code", flat=True)
    )
    absent, message = _missing(GREEK_REALMS, codes, "Greek realms")
    assert not absent, message


@pytest.mark.django_db
def test_greco_roman_cast_present_with_correct_roles_and_realms(seeded):
    """Hades, the three judges, Charon and Cerberus exist, cast AND placed.

    `consolidate_eu_pantheon` keeps Christian + Greco-Roman as the two European
    judgment systems and audits this exact roster. The seed used to create only
    Charon, Minos, Cerberus and Pluto, so on a fresh database that audit
    reported Hades, Aeacus and Rhadamanthus MISSING — the audit could not pass
    on any database this project ships.

    Then it could, and it still said nothing useful: with all six seeded, five
    of them were standing in a realm no source supports and both this test and
    that audit passed, because both locked the role and neither looked at the
    realm. The realm is checked here now.
    """
    fault = _placement_faults(
        "EUROPEAN", GRECO_ROMAN_CAST, "The Greco-Roman cast"
    )
    assert fault is None, (
        f"{fault}\nconsolidate_eu_pantheon audits exactly these six and its "
        f"GRECO_ROMAN_EXPECTED must say the same thing this table does."
    )


@pytest.mark.django_db
def test_christian_cast_present_with_correct_roles_and_realms(seeded):
    """The judge the creed names is in the database, and nobody else is judging.

    Christ was missing outright — `grep -i 'christ|jesus|基督|耶稣'` matched
    nothing anywhere in the repo — while John 5:22 ("the Father judgeth no man,
    but hath committed all judgment unto the Son"), the Nicene Creed and CCC
    1021-1041 name him without qualification, and all three of Catholic,
    Orthodox and Protestant readings agree on the point.

    The JUDGE role had instead been given to Michael and to Satan. Michael
    weighing souls is a medieval iconographic motif that reached Christian art
    through Greek psychostasia from the Egyptian weighing of the heart this
    same seeder puts in the Hall of Two Truths — so the repo had Michael doing
    Anubis' job — while his liturgical office is to lead (*signifer sanctus
    Michael repraesentet eas in lucem sanctam*, Offertory of the Roman
    Requiem). Satan is the accuser (Rev 12:10; Job 1-2) and is himself judged
    (Rev 20:10); in Dante he is the punishment, frozen in Cocytus (Inf. XXXIV).
    Neither adjudicates anything.
    """
    fault = _placement_faults("EUROPEAN", CHRISTIAN_CAST, "The Christian cast")
    assert fault is None, fault


@pytest.mark.django_db
def test_the_christian_side_seats_one_judge_and_no_bench(seeded):
    """Christianity's bench is empty, and the emptiness is asserted, not assumed.

    Diyu has ten kings and the Hall of Two Truths has forty-two assessors.
    Christianity has neither, and not because the research came up short: the
    theology does not use the structure. One judge, no jury, no division of
    labour, no assigned seats. The two passages that sound like a bench are not
    one — Matt 19:28 / Luke 22:30 seats the twelve apostles but gives them no
    dockets and no names, and 1 Cor 6:2-3 makes the subject "the saints", i.e.
    everyone rather than a closed list. Angels attend the judgment as gatherers
    and executors (Matt 13:41-42, 24:31, 25:31), never as adjudicators.

    This test is the mechanism that keeps the slot explicitly empty rather than
    merely unfilled. An empty slot with nothing watching it reads as an
    oversight, and the repo has already run that experiment once: the forty-two
    assessors were for a long time thirty-five names that were not assessors,
    assembled because the template said a bench belonged there. Europe answered
    the same pressure by counting Greeks — three of the eleven European actors
    were Greek judges — which is why the Greek names are excluded here by
    realm rather than by a hardcoded list of who not to count.
    """
    christian_realms = ["EU_HEAVEN", "EU_PURGATORY"]
    judges = sorted(
        Actor.objects.filter(
            civilization="EUROPEAN",
            role="JUDGE",
            realm__realm_code__in=christian_realms,
        ).values_list("name", flat=True)
    )
    assert judges == ["Christ"], (
        f"The Christian side of EU_HEAVEN_HELL should seat exactly one judge, "
        f"Christ, and it seats {judges}. If a name was added here to fill out a "
        f"tribunal: there is no tribunal to fill. If Christ is missing, the "
        f"judgment system has no judge. Realms checked: {christian_realms}."
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
    # The audit prints each deviation as an indented bullet under a "Deviations
    # found:" header. Matched on that shape rather than on a keyword: an earlier
    # draft looked for "expected " and matched the Norse step's "this is the
    # expected state", i.e. a check that failed on a line reporting success.
    deviation_lines = [
        line.strip() for line in output.splitlines()
        if line.startswith("    - ")
    ]
    assert "Deviations found" not in output, (
        "consolidate_eu_pantheon's Greco-Roman audit found deviations against a "
        "freshly seeded database:\n" + "\n".join(deviation_lines)
        + f"\n\nFull output:\n{output}"
    )
    assert not deviation_lines, (
        "consolidate_eu_pantheon reports role or realm deviations against a "
        "freshly seeded database:\n" + "\n".join(deviation_lines)
        + f"\n\nFull output:\n{output}"
    )
    assert "all six stand in the realm their source puts them in" in output, (
        f"The audit did not report a clean pass, so the assertions above may be "
        f"passing because the audit never ran — or because its realm check was "
        f"removed, which is the failure this phrase exists to detect.\n{output}"
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
        DispositionService.EG_ANNIHILATION,
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
