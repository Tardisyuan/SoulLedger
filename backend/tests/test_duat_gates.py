"""The Duat's gates belong to the dead person, and to one book.

Why this file exists
--------------------
The gates a soul met in this database used to be twelve, and twelve gates are
the organising principle of the **Book of Gates** — a royal funerary
composition about **Ra's** nightly transit. The **Amduat** is a *second*,
different book about the same voyage, divided into twelve *hours*, each with its
own city and door. Two books, one subject, and that subject is the sun god.

`docs/lore-verification/verify-egyptian.md` §4.2 sets out the relationship and
names the failure mode: the Book of Gates' divisions *are* the night hours, so
the two books' name-series look interchangeable and are not. Filing one book's
names under the other's labels produces something that reads as data, resolves
as data, and is a splice.

This application does not model Ra. It models a dead person being judged, and
the Book of the Dead has its own gate corpus for exactly that — the same
scripture and the same edition family the forty-two assessors already come from:

* **BD 144 / 147** — the seven ꜥrrwt, approaches to the house of Osiris in the
  field of reeds. Seeded as ``EG_SEVEN_ARRWT``.
* **BD 145 / 146** — the twenty-one sbḫt, gateways of the Field of Reeds of the
  domain of Osiris. Seeded as ``EG_TWENTYONE_SEBKHET``.

What is asserted here
---------------------
1. Both gate corpora are seeded, as two rows and not as one run of twenty-eight.
2. **No realm on the dead person's itinerary names either book, or Ra's
   voyage.** This is the check the whole change exists for; everything else is
   scaffolding around it.
3. Each gate row cites *its own* chapter pair and not the other's.
4. Any Egyptian realm that arrives later as an individually numbered gate has to
   arrive with the edition it was transcribed from.

Rule 1 of ``tests/test_seed_mythology.py`` applies: nothing below is imported
from ``apps.actors.mythology``. The codes, the counts and the forbidden phrases
are a second copy, written out by hand, so that deleting a row from the seed
table cannot delete the expectation along with it.

A consequence worth stating plainly, because it will look like a bug to whoever
hits it first: rule 2 forbids these strings in realm *data* even in a sentence
that disclaims them. "This is not the Book of Gates" is a correct sentence and
it still fails, because the check cannot read intent and a check that tried to
would be the one that lets the splice through. The place for that sentence is
the comment above ``EGYPTIAN_REALMS`` in ``apps/actors/mythology/realms.py``,
where it is, and where no test can mistake it for a citation.
"""
import io

import pytest
from django.core.management import call_command

from apps.realms.models import Realm
from apps.tenants.managers import clear_current_tenant

# --------------------------------------------------------------------------
# The two gate corpora of the Book of the Dead. Hand-maintained; see the
# module docstring.
#
# `chapters`      the chapter numbers this row's description must cite.
# `not_chapters`  the *other* corpus's chapters, which it must not cite. This
#                 is what holds the two series apart: a row that cited all four
#                 would have merged them, which is the shape "twelve gates"
#                 had — one flat numbered run standing in for whatever gates
#                 anybody remembered.
# `count`         how many gates the chapter title gives. Recorded here so a
#                 reader can check it against a source; not asserted against a
#                 row count, because the individual gates are deliberately not
#                 seeded (see `test_no_gate_is_seeded_by_ordinal_alone`).
# --------------------------------------------------------------------------
GATE_CORPORA = {
    "EG_SEVEN_ARRWT": {
        "chapters": ["144", "147"],
        "not_chapters": ["145", "146"],
        "count": 7,
    },
    "EG_TWENTYONE_SEBKHET": {
        "chapters": ["145", "146"],
        "not_chapters": ["144", "147"],
        "count": 21,
    },
}

# Ra's books, and Ra's voyage. Any of these in an Egyptian realm's own data
# means the sun god's itinerary has been written onto the dead person's.
#
# `Am-Tuat` is here as well as `Amduat`: it is the same book under Budge's
# spelling, and it is also the string that produced `EG_AM_TYAT`, the invented
# "Path of Amtyat" that realms/0013 retired. A book title becoming a place is
# how this exact error entered the database the first time.
SOLAR_VOYAGE_PHRASES = [
    "book of gates",
    "門之書",
    "门之书",
    "amduat",
    "am-tuat",
    "amtuat",
    "阿姆杜阿特",
    "冥界之书",
    "solar barque",
    "solar bark",
    "太阳船",
    "night journey",
    "nightly voyage",
    "nightly transit",
    "夜航",
]

# The fields that are the row's own assertions about itself. `name_egy` is
# included: it holds a handle rather than prose, and a handle reading
# `BookOfGates` would be the same claim in fewer characters.
REALM_TEXT_FIELDS = ["name_local", "name_zh", "name_en", "name_egy", "description"]

# What a citation looks like in this repository. The forty-two assessors set the
# policy: name the edition, not just the chapter. A row saying "BD 144" and
# nothing else is a pointer to a book nobody has opened.
EDITION_MARKERS = ["budge", "quirke", "ucl", "theban recension", "papyrus"]


@pytest.fixture
def seeded(db):
    clear_current_tenant()
    call_command("seed_mythology", stdout=io.StringIO())


def _egyptian_realms():
    """Every Egyptian realm, tombstones included.

    ``all_objects`` rather than ``objects``: a row soft-deleted by a migration
    and then written back by an edited seed table is still a row this database
    carries, and ``Realm.objects`` would show only the fresh one. Same reasoning
    as ``test_seed_mythology.py::test_no_unattested_realm_is_seeded``.
    """
    return Realm.all_objects.filter(civilization="EGYPTIAN")


def _texts(realm):
    """{field: value} for the fields a claim can hide in, blanks dropped."""
    return {
        field: (getattr(realm, field) or "")
        for field in REALM_TEXT_FIELDS
        if (getattr(realm, field) or "").strip()
    }


# --------------------------------------------------------------------------
# 1. Both corpora are seeded, as two series
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_both_book_of_the_dead_gate_corpora_are_seeded(seeded):
    """BD 144/147 and BD 145/146 each have a realm."""
    present = set(
        _egyptian_realms()
        .filter(realm_code__in=GATE_CORPORA, is_deleted=False)
        .values_list("realm_code", flat=True)
    )
    absent = sorted(set(GATE_CORPORA) - present)
    assert not absent, (
        f"Book of the Dead gate realms missing from a freshly seeded database: "
        f"{absent}. These are the gates the deceased passes — BD 144/147's seven "
        f"ꜥrrwt and BD 145/146's twenty-one sbḫt — and they replaced a twelve-gate "
        f"structure that belonged to Ra."
    )


@pytest.mark.django_db
def test_the_two_gate_corpora_stay_two(seeded):
    """Each gate row cites its own chapter pair and not the other's.

    The failure this guards is subtle and has a pull to it: seven gates plus
    twenty-one gates makes twenty-eight, twenty-eight is close to a round list,
    and a single realm citing "BD 144-147" would look tidier than two. It would
    also be false — ꜥrrwt and sbḫt are different words for different gates in
    different chapters, and nothing in the corpus runs a number across both.
    """
    rows = {r.realm_code: r for r in _egyptian_realms().filter(realm_code__in=GATE_CORPORA)}
    faults = []
    for code, expected in GATE_CORPORA.items():
        realm = rows.get(code)
        if realm is None:
            continue  # reported by the test above
        description = realm.description or ""
        for chapter in expected["chapters"]:
            if chapter not in description:
                faults.append(f"{code} does not cite its own chapter BD {chapter}")
        for chapter in expected["not_chapters"]:
            if chapter in description:
                faults.append(
                    f"{code} cites BD {chapter}, which belongs to the other corpus — "
                    f"the two series have been merged"
                )
    assert not faults, (
        "The two Book of the Dead gate corpora have run together:\n  "
        + "\n  ".join(faults)
    )


@pytest.mark.django_db
def test_no_gate_is_seeded_by_ordinal_alone(seeded):
    """A gate arrives with a name and a source, or it does not arrive.

    No transcription of the seven ꜥrrwt, their twenty-one keepers, or the
    twenty-one sbḫt demons has been obtained, and the order of either series has
    no second witness — the assessor round proved that matters, since Ani and
    Nebseni disagree on the sequence of the forty-two. So the gates are seeded as
    two sets and not as twenty-eight rows named "the fourth gate", which would
    look like data and say nothing.

    `docs/lore-verification/README.md` §1: completing these lists is the one
    certain way to get them wrong. Two frameworks filled in that way were
    withdrawn whole in 8308204.
    """
    padded = sorted(
        realm.realm_code
        for realm in _egyptian_realms().filter(is_deleted=False)
        if realm.realm_code not in GATE_CORPORA
        and any(
            realm.realm_code.startswith(prefix)
            for prefix in ("EG_ARRWT_", "EG_SEBKHET_", "EG_GATE_", "EG_DUAT_GATE_")
        )
    )
    assert not padded, (
        f"Individual Duat gates have been seeded by ordinal: {padded}. If the "
        f"transcriptions have since been obtained, these rows are welcome — give "
        f"each one its attested name and the edition it was read from, the way "
        f"the forty-two assessors carry theirs, and replace this check with that "
        f"citation rather than deleting it."
    )


# --------------------------------------------------------------------------
# 2. The check this change exists for
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_no_realm_on_the_dead_persons_itinerary_names_ras_books(seeded):
    """The Book of Gates and the Amduat do not appear on a realm. Either of them.

    This is the hard error the change was made to remove. Both books are about
    Ra's nightly voyage; a ``Realm`` in this system is somewhere a *soul* is
    sent, routed to and audited against. Naming one of Ra's books on such a row
    asserts that the deceased travels the sun god's itinerary, and naming *both*
    interleaves two different compositions whose name-series are not
    interchangeable (verify-egyptian.md §4.2).

    Deliberately not restricted to the Egyptian gate rows. The string that has
    to stay out is the one that ends up anywhere a soul's destination is
    described, and the row it entered on last time — ``EG_DUAT_ENTRY``, "soul
    begins the night journey" — was not a gate row at all.
    """
    offenders = []
    for realm in _egyptian_realms():
        for field, value in _texts(realm).items():
            lowered = value.lower()
            for phrase in SOLAR_VOYAGE_PHRASES:
                if phrase in lowered:
                    offenders.append(f"{realm.realm_code}.{field} contains {phrase!r}")
    assert not offenders, (
        "Ra's night voyage has been written onto a realm the dead person "
        "travels:\n  "
        + "\n  ".join(sorted(offenders))
        + "\n\nThe Book of Gates and the Amduat are two different books about the "
        "sun god, and this system models the deceased. The gates a soul passes "
        "are BD 144/147's seven ꜥrrwt and BD 145/146's twenty-one sbḫt. If the "
        "sentence was meant to *deny* the connection, it belongs in the comment "
        "above EGYPTIAN_REALMS, not in a column."
    )


# --------------------------------------------------------------------------
# 3. Citation policy
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_a_seeded_duat_gate_names_its_source_edition(seeded):
    """A row that claims a Book of the Dead chapter says which edition it read.

    The forty-two assessors set this policy and it is the reason their roster
    survived a second look: "BD 125" alone would have been a pointer, and what
    caught the thirty-three names that were not assessors was having an edition
    and a papyrus to check them against.
    """
    faults = []
    for realm in _egyptian_realms().filter(is_deleted=False):
        description = (realm.description or "").lower()
        claims_a_chapter = any(
            f"book of the dead {chapter}" in description
            or f"bd {chapter}" in description
            for corpus in GATE_CORPORA.values()
            for chapter in corpus["chapters"]
        )
        if not claims_a_chapter:
            continue
        if not any(marker in description for marker in EDITION_MARKERS):
            faults.append(realm.realm_code)
    assert not faults, (
        f"These realms cite a Book of the Dead gate chapter without naming the "
        f"edition it was read from: {sorted(faults)}. Name the edition — Budge's "
        f"Theban Recension vol. II and UCL/Quirke's chapter list are what the rest "
        f"of the Egyptian corpus in this repository is checked against."
    )
