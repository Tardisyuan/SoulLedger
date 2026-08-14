"""「功過有不可折者」 — merit does not all buy the same thing.

《文昌帝君功過格·凡例》 (1724) rules two offsets out by name:

    功過有不可折者。如用財之百功，不可折致死人之百過。
    零積之十功不能折一次之十過也。

This system did the first one anyway. Merit and demerit were one scalar pool, so
a hundred hundred-cash alms — 一功 apiece, 救濟門#7 — cancelled one killing —
百過, 不仁門#7 — exactly. `test_alms_no_longer_offset_a_killing` below was
written first in its inverted form, asserting that the offset SUCCEEDED, and run
green against the unmodified code; the assertions were then flipped. That
sequence is the point: a check nobody has watched fail is a check nobody has
evidence for.

INDEPENDENT OF THE CORPUS, ON PURPOSE. The defect is in the arithmetic, not in
the reference data: it predates the 功過格 articles and would survive their
deletion. Nothing here calls `seed_mythology` or reads a `Statute`, so a failure
in this file means the ledger broke and a failure in
`tests/test_gongguoge.py` means the transcription did. Mixing the two would
leave neither question answerable from a red run.

WHAT IS NOT ASSERTED HERE: that `karmic_balance` or disposition routing changed.
They did not — see "What this does not do" in apps/ledger/fungibility.py. The
last test in this file pins that gap open so it stays a known one.
"""
import pytest

from apps.ledger.fungibility import (
    ATTESTED_CLASSES,
    CATEGORY_FUNGIBILITY,
    FUNGIBILITY_CLASSES,
    LIFE,
    MONEY,
    class_for_category,
)
from apps.ledger.services import LedgerService
from apps.souls.models import Civilization, Soul, SoulState
from apps.souls.record_models import RecordCategory, SoulRecord
from apps.tenants.models import Tenant

#: 救濟門#7: 賑濟鰥寡孤獨窮民百錢為一功。One hundred cash, one merit.
ALMS_POINTS = 1
ALMS_COUNT = 100
#: 不仁門#7: 故傷殺人性命為百過.
KILLING_POINTS = 100


@pytest.fixture
def chinese_soul(db):
    """A soul whose deeds are dated in its year of death, so the decay factor
    is exactly 1.0 and the only thing the reading sees is the weights."""
    tenant = Tenant.objects.get_or_create(
        code="CN_DIYU", defaults={"display_name": "Diyu"}
    )[0]
    soul = Soul.objects.create(
        name="功過格 fungibility fixture",
        current_state=SoulState.JUDGING,
        death_year=2000,
        tenant=tenant,
    )
    assert soul.civilization == Civilization.CHINESE
    return soul


def _record(soul, record_type, category, weight, description):
    return SoulRecord.objects.create(
        soul=soul,
        record_type=record_type,
        category=category,
        weight=weight,
        description=description,
        event_year=2000,
    )


def _alms(soul, count):
    for n in range(count):
        _record(
            soul, "MERIT", RecordCategory.CHARITY, ALMS_POINTS,
            f"賑濟窮民百錢 #{n + 1}",
        )


def _killing(soul):
    _record(soul, "DEMERIT", RecordCategory.MURDER, KILLING_POINTS, "故傷殺人性命")


@pytest.fixture
def almsgiving_killer(chinese_soul):
    """一百次賑貧 against 一次殺人. Under 太微 both totals are 100."""
    with SoulRecord.batch():
        _alms(chinese_soul, ALMS_COUNT)
        _killing(chinese_soul)
    chinese_soul.refresh_from_db()
    return chinese_soul


# --------------------------------------------------------------------------
# The defect, and its refusal
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_alms_no_longer_offset_a_killing(almsgiving_killer):
    """用財之百功 does not discharge 致死人之百過.

    Before the fix every assertion below read the other way: `non_fungible` was
    absent and the raw balance of 0 was the whole reading, so the killing was
    reported as settled.
    """
    summary = LedgerService.get_ledger_summary(almsgiving_killer)
    reading = summary["reading"]

    # The raw sums are unchanged. This is not a re-scoring.
    assert summary["merit_score"] == 100
    assert summary["demerit_score"] == 100
    assert reading["kind"] == "BALANCE"
    assert reading["balance"] == 0

    non_fungible = reading["non_fungible"]
    # The killing stands, in full, and says so.
    assert non_fungible["unoffset_demerit"] == KILLING_POINTS, (
        f"the killing was discharged after all: {non_fungible}"
    )
    # The alms are not destroyed and not turned into credit against it. They
    # are merit with nothing of their own kind left to answer for.
    assert non_fungible["unusable_merit"] == ALMS_COUNT * ALMS_POINTS

    # Absence as well as presence: the merit did not land in the pool the
    # killing is in. A LIFE-classed alms would satisfy every assertion above
    # while restoring the exact defect.
    assert non_fungible["by_class"][MONEY] == {
        "merit": 100, "demerit": 0, "offset": 0,
        "unoffset_demerit": 0, "unusable_merit": 100,
    }
    assert non_fungible["by_class"][LIFE] == {
        "merit": 0, "demerit": 100, "offset": 0,
        "unoffset_demerit": 100, "unusable_merit": 0,
    }


@pytest.mark.django_db
def test_one_more_coin_no_longer_puts_the_killer_in_credit(chinese_soul):
    """The defect as a reviewer would have noticed it: buy one merit more than
    the killing cost and the ledger read positive. The raw balance still does —
    it is the same subtraction — and the reading now contradicts it."""
    with SoulRecord.batch():
        _alms(chinese_soul, KILLING_POINTS + 1)
        _killing(chinese_soul)
    chinese_soul.refresh_from_db()

    reading = LedgerService.get_ledger_summary(chinese_soul)["reading"]
    assert reading["balance"] == 1
    assert reading["non_fungible"]["unoffset_demerit"] == KILLING_POINTS
    assert reading["non_fungible"]["unusable_merit"] == KILLING_POINTS + 1


@pytest.mark.django_db
def test_merit_of_the_right_kind_does_offset(chinese_soul):
    """The rule is a partition, not a blanket refusal.

    功過相抵 is the arithmetic a 功過格 is made of — 不善門#8's 夾注 states it
    outright: 「一過去功一分，十過去功十分」. A reading that refused every
    offset would be as wrong as one that allowed every offset, so this is the
    test that stops the fix from over-firing.
    """
    with SoulRecord.batch():
        _record(chinese_soul, "MERIT", RecordCategory.COMPASSION, 40, "救人刑死")
        _killing(chinese_soul)
    chinese_soul.refresh_from_db()

    non_fungible = LedgerService.get_ledger_summary(chinese_soul)["reading"]["non_fungible"]
    assert non_fungible["by_class"][LIFE]["offset"] == 40
    assert non_fungible["unoffset_demerit"] == KILLING_POINTS - 40
    assert non_fungible["unusable_merit"] == 0


@pytest.mark.django_db
def test_a_clean_ledger_reports_nothing_standing(chinese_soul):
    with SoulRecord.batch():
        _alms(chinese_soul, 5)
    chinese_soul.refresh_from_db()

    non_fungible = LedgerService.get_ledger_summary(chinese_soul)["reading"]["non_fungible"]
    assert non_fungible["unoffset_demerit"] == 0
    assert non_fungible["unusable_merit"] == 5
    assert LIFE not in non_fungible["by_class"]


# --------------------------------------------------------------------------
# The classification itself
# --------------------------------------------------------------------------


def test_every_record_category_is_classified():
    """A category with no entry falls to CONDUCT silently, and CONDUCT offsets
    against CONDUCT — so an unclassified new category would quietly become
    interchangeable with every other unclassified thing."""
    missing = sorted(
        value for value in RecordCategory.values if value not in CATEGORY_FUNGIBILITY
    )
    assert missing == [], (
        f"RecordCategory members with no fungibility class: {missing}. Add them "
        f"to CATEGORY_FUNGIBILITY in apps/ledger/fungibility.py — and never to "
        f"{ATTESTED_CLASSES} by default, since those are the two pools "
        f"《文昌帝君功過格·凡例》 actually rules on."
    )
    unknown = sorted(
        f"{k}->{v}" for k, v in CATEGORY_FUNGIBILITY.items()
        if v not in FUNGIBILITY_CLASSES
    )
    assert unknown == [], f"classes nothing knows about: {unknown}"


def test_the_two_attested_classes_are_the_pair_the_rule_names():
    """MONEY and LIFE are 財 and 性命 — the only two 凡例 names. The rest of the
    partition is this system's, and the code must keep saying so."""
    assert set(ATTESTED_CLASSES) == {MONEY, LIFE}
    assert set(ATTESTED_CLASSES) < set(FUNGIBILITY_CLASSES)
    assert class_for_category(RecordCategory.MURDER) == LIFE
    assert class_for_category(RecordCategory.CHARITY) == MONEY
    # An unknown category must not land in either attested pool.
    assert class_for_category("NO_SUCH_CATEGORY") not in ATTESTED_CLASSES


# --------------------------------------------------------------------------
# What this change deliberately did not do
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_karmic_balance_and_routing_are_unchanged(almsgiving_killer):
    """The gap, pinned open rather than left to be discovered.

    `Soul.karmic_balance` is a souls-app property, seven DispositionService call
    sites route on it, and querysets order by it — so it still nets raw across
    every class, and the almsgiving killer still routes as a soul at zero. That
    is a real remaining hole in 「不可折」 and this test exists so that closing
    it, or leaving it open, is a decision somebody makes on purpose.
    """
    assert almsgiving_killer.karmic_balance == 0
    summary = LedgerService.get_ledger_summary(almsgiving_killer)
    assert summary["karmic_balance"] == 0
    assert summary["reading"]["non_fungible"]["unoffset_demerit"] == 100


@pytest.mark.django_db
def test_other_cosmologies_get_no_fungibility_claim(db):
    """功過格 is Chinese. Neither of the other two readings grows the key.

    An Egyptian heart is weighed against the feather with no offsetting step at
    all, and European culpa is not reduced by merit either; a `non_fungible`
    block on those would state a rule about an offset that does not exist there.
    """
    for code, expected_kind in (
        ("EG_DUAT", "THRESHOLD"), ("EU_HEAVEN_HELL", "GUILT_AND_PENALTY"),
    ):
        tenant = Tenant.objects.get_or_create(
            code=code, defaults={"display_name": code}
        )[0]
        soul = Soul.objects.create(
            name=f"{code} soul", current_state=SoulState.JUDGING,
            death_year=2000, tenant=tenant,
        )
        with SoulRecord.batch():
            _alms(soul, 5)
            _killing(soul)
        soul.refresh_from_db()

        reading = LedgerService.get_ledger_summary(soul)["reading"]
        assert reading["kind"] == expected_kind
        assert "non_fungible" not in reading, (
            f"{code} was handed a 功過格 rule: {reading}"
        )
