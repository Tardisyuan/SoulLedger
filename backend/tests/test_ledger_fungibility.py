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

THE ROUTING LAYER IS NOW IN SCOPE. The first version of this file asserted that
`karmic_balance` and `DispositionService` were untouched — the reading refused
the offset while the router still granted it, so buying off a killing worked
where it actually mattered. The section "The routing layer" below closes that,
and `test_karmic_balance_still_nets_raw_and_routing_no_longer_follows_it` is the
old gap-pinning test in its new arrangement. `karmic_balance` itself is
deliberately still a raw net; that test says why.
"""
import pytest

from apps.disposition.services import DispositionService
from apps.judgment.models import Verdict
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

#: 第九殿平等王 (阿鼻地獄) and 第二殿楚江王 — the ceiling and the floor of the
#: punishment courts. Named through the map rather than by literal key for the
#: reason apps/disposition/tests.py gives: what these tests are about is which
#: end of the band a soul lands at, not which integer indexes it.
DEEPEST_COURT = DispositionService.CHINESE_HELL_TIERS[
    DispositionService.CHINESE_HELL_MAX_TIER
]
MILDEST_COURT = DispositionService.CHINESE_HELL_TIERS[
    DispositionService.CHINESE_HELL_MIN_TIER
]

#: 救濟門#7: 賑濟鰥寡孤獨窮民百錢為一功。One hundred cash, one merit.
ALMS_POINTS = 1
ALMS_COUNT = 100
#: 不仁門#7: 故傷殺人性命為百過.
KILLING_POINTS = 100


@pytest.fixture
def make_chinese_soul(db):
    """Builds souls whose deeds are dated in their year of death, so the decay
    factor is exactly 1.0 and the only thing the reading sees is the weights.

    A factory rather than a single soul because the routing tests below compare
    two ledgers against each other — the whole claim is that two souls who did
    the same killing are sentenced the same way, and one fixture cannot be both
    of them."""
    tenant = Tenant.objects.get_or_create(
        code="CN_DIYU", defaults={"display_name": "Diyu"}
    )[0]

    def _make(name="功過格 fungibility fixture"):
        soul = Soul.objects.create(
            name=name,
            current_state=SoulState.JUDGING,
            death_year=2000,
            tenant=tenant,
        )
        assert soul.civilization == Civilization.CHINESE
        return soul

    return _make


@pytest.fixture
def chinese_soul(make_chinese_soul):
    return make_chinese_soul()


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
# The routing layer
# --------------------------------------------------------------------------
#
# Where the rule now actually costs a soul something. Everything above this line
# is a number on a page; below it is which of the ten courts a soul is sent to.


@pytest.mark.django_db
def test_a_hundred_alms_no_longer_buy_a_milder_court(make_chinese_soul):
    """The defect, at the layer that matters. Two souls, one killing each.

    Before this change the buyer went to 第二殿楚江王, the mildest punishment
    court, and the man who only killed went to 第九殿平等王 (阿鼻地獄), the
    deepest — seven courts apart, and the whole of the difference was a hundred
    coins spent on alms. Both halves of that were run green in their inverted
    form before the assertions here were written.
    """
    buyer = make_chinese_soul("百功殺人者")
    with SoulRecord.batch():
        _alms(buyer, ALMS_COUNT)
        _killing(buyer)
    plain = make_chinese_soul("殺人者")
    with SoulRecord.batch():
        _killing(plain)
    buyer.refresh_from_db()
    plain.refresh_from_db()

    # The undifferentiated pool still reads these two as 100 points apart.
    assert (buyer.karmic_balance, plain.karmic_balance) == (0, -KILLING_POINTS)

    # They are now sentenced identically, because what picks the court is the
    # fault no merit of its own kind could discharge, and that is 100 for both.
    assert LedgerService.get_unoffset_demerit(buyer) == KILLING_POINTS
    assert DispositionService._route_to_realm(buyer, Verdict.FAILED) == DEEPEST_COURT
    assert DispositionService._route_to_realm(plain, Verdict.FAILED) == DEEPEST_COURT


@pytest.mark.django_db
def test_merit_of_the_right_kind_still_softens_the_court(make_chinese_soul):
    """The routing counterpart of `test_merit_of_the_right_kind_does_offset`.

    功過相抵 is the arithmetic a 功過格 is made of, so a rule that refused every
    offset at the reading and then sentenced everyone to 阿鼻地獄 anyway would
    have over-fired in exactly the way that test guards against one level down.
    救人 is 性命, the same pool as the killing, so it does discharge it — and the
    court moves accordingly.
    """
    soul = make_chinese_soul("救人而又殺人者")
    with SoulRecord.batch():
        _record(soul, "MERIT", RecordCategory.COMPASSION, 40, "救人刑死")
        _killing(soul)
    soul.refresh_from_db()

    # 100 過 less 40 功 of its own kind = 60 standing → (60 // 10) + 1 = 第七殿.
    assert LedgerService.get_unoffset_demerit(soul) == KILLING_POINTS - 40
    realm = DispositionService._route_to_realm(soul, Verdict.FAILED)
    assert realm == DispositionService.CHINESE_HELL_TIERS[7]
    assert realm != DEEPEST_COURT


@pytest.mark.django_db
def test_a_condemned_soul_with_no_recorded_fault_lands_at_the_floor(make_chinese_soul):
    """`abs(karma)` could not tell +95 from -95, so a FAILED verdict on a soul
    that had done nothing but give alms sent it to the deepest hell for being
    generous. An unoffset-demerit total is a demerit total; it has no sign to
    lose, and a soul with no recorded fault has no recorded severity."""
    soul = make_chinese_soul("行善而見黜者")
    with SoulRecord.batch():
        _record(soul, "MERIT", RecordCategory.CHARITY, 95, "賑濟窮民")
    soul.refresh_from_db()

    assert soul.karmic_balance == 95
    assert LedgerService.get_unoffset_demerit(soul) == 0
    assert DispositionService._route_to_realm(soul, Verdict.FAILED) == MILDEST_COURT


@pytest.mark.django_db
def test_an_unoffset_killing_does_not_overturn_the_verdict(almsgiving_killer):
    """Severity picks a tier *within* the outcome the verdict already
    determined — the precedence rule 7fe9a28 established, now checked from the
    other side. A killing that no merit could discharge is the strongest signal
    this ledger can produce, and it still does not get to sentence a soul the
    court passed, or to conclude an appeal the court left open."""
    assert LedgerService.get_unoffset_demerit(almsgiving_killer) == KILLING_POINTS
    assert (
        DispositionService._route_to_realm(almsgiving_killer, Verdict.PASSED)
        == DispositionService.CHINESE_HEAVEN
    )
    for verdict in (Verdict.PURGATORY, Verdict.RETRY):
        assert (
            DispositionService._route_to_realm(almsgiving_killer, verdict)
            == DispositionService.CHINESE_PURGATORY
        ), f"{verdict} was concluded by a severity figure"


@pytest.mark.django_db
def test_a_ledger_with_no_scored_records_still_routes_on_the_raw_balance(
    make_chinese_soul,
):
    """No records, no partition, no claim — and so the pre-existing arithmetic.

    A soul whose denormalised scores did not come from its own records cannot be
    split into pools, and inventing a 0 for it would read as "nothing stands
    against this soul" rather than "we could not tell". `get_unoffset_demerit`
    returns None there and the router falls back to `abs(karma)` exactly as
    before.
    """
    soul = make_chinese_soul("無簿者")
    Soul.objects.filter(pk=soul.pk).update(merit_score=0, demerit_score=100)
    soul.refresh_from_db()

    assert LedgerService.get_unoffset_demerit(soul) is None
    assert DispositionService._route_to_realm(soul, Verdict.FAILED) == DEEPEST_COURT


@pytest.mark.django_db
def test_the_other_two_cosmologies_route_exactly_as_they_did(db):
    """功過格 is Chinese at the router too, not just in the reading.

    Each soul below is the same almsgiving killer, filed under a cosmology the
    凡例 has no jurisdiction over. If the rule leaked across, the European soul
    would be sentenced on 100 points of unoffset fault — circle 7 — instead of
    on its balance of zero, which is circle 1.
    """
    for code, verdict, expected in (
        ("EU_HEAVEN_HELL", Verdict.FAILED, DispositionService.EU_HELL_CIRCLES[1]),
        ("EG_DUAT", Verdict.PURGATORY, DispositionService.EG_DUAT_ENTRY),
    ):
        tenant = Tenant.objects.get_or_create(
            code=code, defaults={"display_name": code}
        )[0]
        soul = Soul.objects.create(
            name=f"{code} almsgiving killer", current_state=SoulState.JUDGING,
            death_year=2000, tenant=tenant,
        )
        with SoulRecord.batch():
            _alms(soul, ALMS_COUNT)
            _killing(soul)
        soul.refresh_from_db()

        assert soul.karmic_balance == 0
        # No partitioned reading is offered outside 功過格's jurisdiction...
        assert LedgerService.get_unoffset_demerit(soul) is None, (
            f"{code} was handed a 功過格 severity figure"
        )
        # ...so the raw balance still picks the destination, unchanged.
        assert DispositionService._route_to_realm(soul, verdict) == expected


# --------------------------------------------------------------------------
# What this change deliberately did not do
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_karmic_balance_still_nets_raw_and_routing_no_longer_follows_it(
    almsgiving_killer,
):
    """The gap this used to pin open, closed on one side and held open on the other.

    It was `test_karma_balance_and_routing_are_unchanged`, and its value was
    that it asserted two facts at once so neither could move unnoticed:
    `karmic_balance` still netted across every class, and the almsgiving killer
    therefore still routed as a soul at zero. The second is now false. The first
    is still true and is meant to stay true, so the test keeps its shape and
    flips only the half that changed.

    Why `karmic_balance` stays a raw net: it is a column expression before it is
    a property. apps/souls/querysets.py annotates `merit_score - demerit_score`
    so the souls list can sort and range-filter in SQL, apps/souls/filters.py
    compares it with F(), and apps/ledger/views.py buckets the karma
    distribution with it. A pool is derived in Python from a record's category
    and is deliberately not a stored column (see apps/ledger/fungibility.py on
    why), so there is no SQL for a pool-aware balance. Redefining the property
    would leave it disagreeing with every queryset that computes the same name
    in the database — which is the shape of defect this codebase keeps finding,
    not a fix for one.

    So the two facts are asserted together again, rearranged: the raw net is
    unchanged, and it no longer decides where the soul goes.
    """
    assert almsgiving_killer.karmic_balance == 0
    summary = LedgerService.get_ledger_summary(almsgiving_killer)
    assert summary["karmic_balance"] == 0
    assert summary["reading"]["non_fungible"]["unoffset_demerit"] == KILLING_POINTS

    # The SQL-side definition is the same number, still. This is the half that
    # must not move: a property and an annotation that disagree would break
    # ordering silently rather than loudly.
    annotated = (
        Soul.objects.filter(pk=almsgiving_killer.pk)
        .annotate_karma_balance()
        .values_list("_karmic_balance", flat=True)[0]
    )
    assert annotated == almsgiving_killer.karmic_balance == 0

    # And the routing layer no longer reads that zero.
    assert LedgerService.get_unoffset_demerit(almsgiving_killer) == KILLING_POINTS
    assert (
        DispositionService._route_to_realm(almsgiving_killer, Verdict.FAILED)
        == DEEPEST_COURT
    )


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
