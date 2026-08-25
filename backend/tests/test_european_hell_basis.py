"""What sorts a soul into a circle of Dante's Hell — and what this system uses.

Two claims live in this file and they are not the same claim.

**Fixed, and pinned here so it stays fixed.** `_route_european` used to pick a
circle from `abs(karma)` — merit minus demerit. So a European soul got *milder*
the more good it had done: a hundred alms against one killing netted to zero and
put the killer in circle 1. apps/ledger/readings.py already rules that out for
this cosmology in as many words — 「a good deed does not retire a sin, absolution
does, and letting merit reduce culpa would rebuild the Chinese netting account
under a Latin name」 — and `_european_reading` already reported `culpa` as the
demerit total alone. The router now reads the same figure.

`test_alms_no_longer_buy_a_killing_out_of_the_lower_circles` was written first in
its inverted form, asserting circle 1, and run green against the unmodified
router; the assertions were then flipped. The recorded run is in the task log.
Same discipline as tests/test_ledger_fungibility.py, and for the same reason: a
check nobody has watched fail is a check nobody has evidence for.

**NOT fixed, and pinned here so that fixing it has to be deliberate.** Dante does
not layer Hell by how much wrong was done. Virgil says the basis outright at Inf.
XI.79-84, citing the Ethics — 「Incontinence, and Malice, and insane Bestiality」
(Longfellow 1867, Project Gutenberg #1001). Incontinenza is circles 2-5, malizia
(violence, fraud) and matta bestialitade (treachery) are 6-9 inside the walls of
Dis, and that wall is the poem's only real divider.
docs/lore-verification/verify-christian-structure.md §2, §3.1, §6.

A magnitude ladder cannot express that, whatever number is fed into it. The
"contradiction" tests below assert that the ladder is STILL a magnitude ladder
and that the classification it would need STILL does not exist anywhere in this
system. They are written the way
tests/test_migration_reverse_scope.py::test_perm_0008_sample_scopes_contradict_perm_0017
is written, and for the same reason: nothing in the language connects a routing
formula to a claim about Aristotle, so the disagreement has to be asserted or it
is invisible. Whoever supplies real sin classification will find these tests red
and has to delete them on purpose — which is the point.

WHAT NOT TO DO WHEN THAT DAY COMES. Do not invent the missing categories.
docs/lore-verification/README.md §1 is about this exact material: "Do not
complete these lists. Filling in the 'missing' four evils, three virtues, or
three sins is the one repair that is certainly wrong." `8308204` is what happened
the last time it was tried — seven sins fitted to nine circles, three of them to
circles Dante gives them nowhere, one punishment invented outright.
"""
import io

import pytest
from django.core.management import call_command

from apps.actors.mythology import EUROPEAN_STATUTES, INFERNO_STATUTES
from apps.disposition.services import DispositionService
from apps.judgment.models import CORPUS_CIVILIZATION, Judgment, StatuteCorpus, Verdict
from apps.ledger.services import LedgerService
from apps.souls.models import Civilization, Soul, SoulState
from apps.souls.record_models import RecordCategory, SoulRecord
from apps.tenants.models import Tenant

BAND = DispositionService.EU_HELL_CULPA_BAND

#: Named through the map rather than by literal realm code, per the convention
#: apps/disposition/tests.py states: these tests are about which end of the
#: structure a soul lands at, not which string spells it.
LIMBO = DispositionService.EU_HELL_CIRCLES[1]
FRAUD = DispositionService.EU_HELL_CIRCLES[8]
TREACHERY = DispositionService.EU_HELL_CIRCLES[9]

#: One killing, weighted the way tests/test_ledger_fungibility.py weights it.
KILLING_POINTS = 100
#: A hundred one-point alms against it — the offset that used to work.
ALMS_POINTS = 1
ALMS_COUNT = 100


@pytest.fixture
def make_european_soul(db):
    """European souls whose deeds are dated in their year of death.

    CIVILIZATION_DECAY_RATE puts EUROPEAN at 0.0, so no decay applies here at
    all and the scores are exactly the weights. A factory rather than one soul
    because every claim below compares two ledgers against each other.
    """
    tenant = Tenant.objects.get_or_create(
        code="EU_HEAVEN_HELL", defaults={"display_name": "European Heaven/Hell"}
    )[0]

    def _make(name):
        soul = Soul.objects.create(
            name=name,
            current_state=SoulState.JUDGING,
            death_year=2000,
            tenant=tenant,
        )
        assert soul.civilization == Civilization.EUROPEAN
        return soul

    return _make


def _record(soul, record_type, category, weight, description):
    return SoulRecord.objects.create(
        soul=soul,
        record_type=record_type,
        category=category,
        weight=weight,
        description=description,
        event_year=2000,
    )


def _alms(soul, count=ALMS_COUNT):
    for n in range(count):
        _record(soul, "MERIT", RecordCategory.CHARITY, ALMS_POINTS, f"alms #{n + 1}")


def _killing(soul):
    _record(soul, "DEMERIT", RecordCategory.MURDER, KILLING_POINTS, "slew a man")


def _fraud(soul, weight=KILLING_POINTS):
    _record(soul, "DEMERIT", RecordCategory.DECEPTION, weight, "defrauded a man")


# --------------------------------------------------------------------------
# The half that is fixed: merit no longer buys a European soul out of anything
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_alms_no_longer_buy_a_killing_out_of_the_lower_circles(make_european_soul):
    """The defect, in one soul.

    A hundred alms and one killing. `karmic_balance` is zero — it is still zero,
    deliberately, and that is asserted below — and `abs(karma) // 15 + 1` read
    that zero as circle 1. Culpa is 100 and does not know the alms happened.
    """
    soul = make_european_soul("almsgiving killer")
    with SoulRecord.batch():
        _alms(soul)
        _killing(soul)
    soul.refresh_from_db()

    assert soul.karmic_balance == 0, "fixture no longer reproduces the netting"
    assert soul.demerit_score == KILLING_POINTS

    destination = DispositionService._route_to_realm(soul, Verdict.FAILED)
    expected = DispositionService.EU_HELL_CIRCLES[KILLING_POINTS // BAND + 1]
    assert destination == expected
    # Assert the absence as well: circle 1 is Limbo, and the whole defect was
    # that generosity landed a killer there.
    assert destination != LIMBO, "merit is buying culpa down again"


@pytest.mark.django_db
def test_merit_moves_a_european_soul_nowhere_at_all(make_european_soul):
    """Not "less", but "not at all" — culpa has no merit term in it.

    Two identical killers, one of whom gave away a fortune. A test that only
    checked the generous one had *sunk deeper* would stay green if merit still
    counted for a fraction of itself.
    """
    plain = make_european_soul("killer")
    generous = make_european_soul("generous killer")
    with SoulRecord.batch():
        _killing(plain)
        _alms(generous, ALMS_COUNT * 10)
        _killing(generous)
    plain.refresh_from_db()
    generous.refresh_from_db()

    assert generous.karmic_balance > plain.karmic_balance
    assert DispositionService._route_to_realm(
        generous, Verdict.FAILED
    ) == DispositionService._route_to_realm(plain, Verdict.FAILED)


@pytest.mark.django_db
def test_the_verdict_still_outranks_the_ledger(make_european_soul):
    """Culpa picks depth inside an outcome the verdict has already fixed.

    The heaviest ledger this fixture can build does not get to sentence a soul
    the court passed, or to conclude an appeal the court left open. Same
    precedence rule as `_route_chinese`.
    """
    soul = make_european_soul("condemned by nobody")
    with SoulRecord.batch():
        _killing(soul)
        _fraud(soul)
    soul.refresh_from_db()

    assert (
        DispositionService._route_to_realm(soul, Verdict.PASSED)
        == DispositionService.EU_HEAVEN
    )
    for verdict in (Verdict.PURGATORY, Verdict.RETRY):
        assert (
            DispositionService._route_to_realm(soul, verdict)
            == DispositionService.EU_PURGATORY
        ), f"{verdict} was concluded by a severity figure"


@pytest.mark.django_db
def test_the_gongguoge_rule_still_does_not_reach_the_european_router(
    make_european_soul,
):
    """The fix is a European doctrine, not the Chinese one arriving late.

    452616f gave `_route_chinese` the 「功過有不可折者」 partition and argued, per
    call site, that neither other cosmology gets it. That argument still holds
    and this asserts it: `get_unoffset_demerit` refuses a European soul, and the
    refusal is None — the absence of a claim — not 0.

    The soul is built so the two rules actually disagree, which the almsgiving
    killer no longer does. Charity and greed both fall in the MONEY pool
    (apps/ledger/fungibility.py), so a leaked partition would offset them
    against each other, report zero unoffset fault, and land this soul in Limbo.
    Culpa does not net at all: merit is not on the scale, and 100 points of
    theft are 100 points of guilt however much was given away.
    """
    soul = make_european_soul("outside 凡例's jurisdiction")
    with SoulRecord.batch():
        _alms(soul)
        _record(soul, "DEMERIT", RecordCategory.GREED, KILLING_POINTS, "stole")
    soul.refresh_from_db()

    assert soul.karmic_balance == 0
    assert LedgerService.get_unoffset_demerit(soul) is None
    assert LedgerService.get_unoffset_demerit(soul) != 0

    destination = DispositionService._route_to_realm(soul, Verdict.FAILED)
    assert destination == DispositionService.EU_HELL_CIRCLES[
        KILLING_POINTS // BAND + 1
    ]
    assert destination != LIMBO, "the 功過格 partition is offsetting a European soul"


# --------------------------------------------------------------------------
# The half that is not fixed. These tests assert a contradiction is still there.
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_violence_and_fraud_of_equal_weight_still_land_in_the_same_circle(
    make_european_soul,
):
    """CONTRADICTION, PINNED. Inf. XI puts these two on opposite sides of Dis.

    Murder is violence, circle 7, the boiling Phlegethon (Inf. XII). Fraud is
    circle 8, the ten fosses of Malebolge (Inf. XVIII-XXX). Dante separates them
    by KIND — malizia divides into violence and fraud, and fraud is the graver
    because it corrupts the bond peculiar to man (Inf. XI.22-27). Weigh them the
    same and this router cannot tell them apart, because the only thing it reads
    is the weight.

    This goes red when someone routes by sin type. That is the day to delete it,
    having first read `_route_european`'s docstring §3 on why nobody has.
    """
    killer = make_european_soul("violent")
    swindler = make_european_soul("fraudulent")
    with SoulRecord.batch():
        _killing(killer)
        _fraud(swindler)
    killer.refresh_from_db()
    swindler.refresh_from_db()

    assert killer.demerit_score == swindler.demerit_score
    assert DispositionService._route_to_realm(
        killer, Verdict.FAILED
    ) == DispositionService._route_to_realm(swindler, Verdict.FAILED), (
        "violence and fraud are routed by kind now — Inf. XI is satisfied and "
        "this test has done its job; delete it"
    )


@pytest.mark.django_db
def test_a_petty_fraud_is_sorted_above_a_grave_one_by_weight_alone(
    make_european_soul,
):
    """CONTRADICTION, PINNED. The same sin, two circles, because of a number.

    One swindler cheats small and one cheats large. Both belong in Malebolge and
    nowhere else; this router sends them to different circles — and sends the
    small one to Limbo, which holds virtuous pagans and unbaptized infants and is
    not a punishment at all (Inf. IV). The magnitude ladder does not merely lack
    a kind, it actively contradicts the one it is standing on.
    """
    petty = make_european_soul("petty swindler")
    grave = make_european_soul("grave swindler")
    with SoulRecord.batch():
        _fraud(petty, weight=1)
        _fraud(grave, weight=BAND * 8)
    petty.refresh_from_db()
    grave.refresh_from_db()

    assert DispositionService._route_to_realm(petty, Verdict.FAILED) == LIMBO
    assert DispositionService._route_to_realm(grave, Verdict.FAILED) == TREACHERY
    assert FRAUD not in {
        DispositionService._route_to_realm(petty, Verdict.FAILED),
        DispositionService._route_to_realm(grave, Verdict.FAILED),
    }, "a fraud now reaches Malebolge — routing by kind has landed; delete this"


def test_nothing_in_this_system_classifies_a_sin_the_way_dante_does():
    """CONTRADICTION, PINNED: the missing input, named field by field.

    Routing by kind needs to know the kind. `RecordCategory` is the only deed
    taxonomy in the codebase and it is a Chinese one — apps/ledger/fungibility.py
    maps every member onto a 功過格 gate. Five of the nine circles have no member
    that could reach them, and the sixth, Limbo, is not a sin at all.

    Treachery is the sharpest case and worth stating separately: it is not a deed
    type but a relationship of trust betrayed — kin, country, guest, benefactor,
    the four zones of Cocytus (Inf. XXXII-XXXIV). No amount of categorising
    *deeds* produces it.
    """
    members = {member.name for member in RecordCategory}
    unreachable = {
        "LUST": "circle 2, Inf. V",
        "GLUTTONY": "circle 3, Inf. VI",
        "WRATH": "circle 5, Inf. VII-VIII",
        "HERESY": "circle 6, Inf. IX-XI",
        "TREACHERY": "circle 9, Inf. XXXII-XXXIV",
    }
    for name, where in unreachable.items():
        assert name not in members, (
            f"RecordCategory now has {name} ({where}) — the classification this "
            f"system lacked may have arrived; re-read _route_european §3"
        )

    # BLASPHEMY exists and is NOT heresy. Dante's heretics are the Epicureans
    # who denied the soul's immortality (circle 6); blasphemy is violence
    # against God, the third ring of circle 7 (Inf. XIV). Reading one as the
    # other is the shape of mistake 8308204 was withdrawn for.
    assert "BLASPHEMY" in members


def test_no_model_in_this_system_carries_a_circle_or_a_sin_kind():
    """CONTRADICTION, PINNED: asserted as absence, because that is what it is.

    A field named for a circle appearing on any of these three is the signal
    that someone has started storing the coordinate. It is also the signal that
    they may be reinventing `dante_circle`, which is why this test names it.
    """
    forbidden = ("circle", "sin_kind", "sin_type", "dante")
    for model in (Soul, SoulRecord, Judgment):
        names = {field.name for field in model._meta.get_fields()}
        for fragment in forbidden:
            offenders = {name for name in names if fragment in name}
            assert not offenders, (
                f"{model.__name__} now carries {sorted(offenders)}. If this is "
                f"real sin classification, _route_european can stop guessing. "
                f"If it is a revived `dante_circle`, read 8308204 first."
            )


def test_the_european_corpora_are_citable_text_and_still_route_nothing():
    """CONTRADICTION, PINNED: a citable article is not a routing input.

    `JudgmentCitation` is the one structured link between a judgment and a named
    fault. There are now TWO European corpora and this test was relaxed in
    exactly one place to say so: DEADLY_SIN, the seven capital sins one per
    terrace of Mount Purgatory, and INFERNO, the nine circles with the seventh's
    three gironi, the eighth's ten bolge and the ninth's four zones. Three of the
    seven (pride, envy, sloth) still have no circle at all, and the
    `dante_circle` an earlier version carried is still withdrawn — 8308204, a
    coordinate the poem does not have.

    WHY THE RELAXATION IS ONLY THAT ONE LINE. The claim this file makes is that
    nothing here classifies a sin the way Dante does, and transcribing the
    circles did not change it: the circles corpus is TEXT, and choosing an
    article for a soul still needs a kind of sin, a baptismal state, a doctrinal
    position or the identity of a betrayed trust — none of which exists on any
    model (see the two tests above and the one below). `_route_european` still
    reads a demerit magnitude and the two CONTRADICTION tests at the top of this
    section are still green. So this file is NOT ready to be deleted; the
    condition in its docstring is "whoever supplies real sin classification",
    and nobody has.

    Expectations hand-written rather than derived from the table, per the rule
    tests/test_purgatorio_terraces.py states.
    """
    european_corpora = {
        corpus for corpus, civ in CORPUS_CIVILIZATION.items()
        if civ == Civilization.EUROPEAN
    }
    assert european_corpora == {StatuteCorpus.DEADLY_SIN, StatuteCorpus.INFERNO}

    assert len(EUROPEAN_STATUTES) == 7
    for article in EUROPEAN_STATUTES:
        payload = article["payload"]
        assert payload["purgatorio_terrace"] == article["ordinal"]
        offenders = {key for key in payload if "circle" in key or "dante" in key}
        assert not offenders, (
            f"{article['code']} carries {sorted(offenders)} — the withdrawn "
            f"`dante_circle` is back; read 8308204 and "
            f"docs/lore-verification/verify-christian-structure.md §4.1"
        )

    # Absence, stated positively: the three the Inferno has no room for.
    assert {"Pride", "Envy", "Sloth"} <= {a["title_en"] for a in EUROPEAN_STATUTES}

    # TIGHTENED, not relaxed: the circles corpus carries no hook a router could
    # read. It has no deed category, no weight and no score — the three shapes
    # through which a statute could quietly become an input to
    # `_route_european` — so an article remains something a judge cites by hand.
    # tests/test_inferno_circles.py checks what the 26 articles say; this checks
    # what they must not be able to do.
    assert len(INFERNO_STATUTES) == 26
    routable = ("record_category", "category", "weight", "points", "score",
                "culpa", "karma", "threshold", "band")
    for article in INFERNO_STATUTES:
        offenders = {
            key for key in article["payload"]
            if any(fragment in key for fragment in routable)
        }
        assert not offenders, (
            f"{article['code']} carries {sorted(offenders)}. A circle article "
            f"that scores or categorises a deed is the missing classification "
            f"arriving through the corpus rather than through a model — re-read "
            f"_route_european §3 before wiring it up, and delete these tests on "
            f"purpose if it is real."
        )


# --------------------------------------------------------------------------
# The half that is no longer a contradiction: routing by kind, where a kind is
# recorded. The CONTRADICTION tests above still pass, and that is the design —
# they describe an UNCLASSIFIED soul, which is every soul written before
# souls/0029 and every soul nobody has classified since.
# --------------------------------------------------------------------------

VIOLENCE_ARTICLE = "EU-INF-C7"
FRAUD_ARTICLE = "EU-INF-C8"
CAINA = "EU-INF-C9-Z1"
LIMBO_ARTICLE = "EU-INF-C1"
HERESY_ARTICLE = "EU-INF-C6"
VIOLENCE = DispositionService.EU_HELL_CIRCLES[7]


@pytest.fixture
def seeded_corpus(db):
    """The EU-INF articles have to exist for a citation to resolve."""
    call_command("seed_mythology", stdout=io.StringIO(), stderr=io.StringIO())


def _cite(soul, category, article, weight=KILLING_POINTS):
    record = _record(soul, "DEMERIT", category, weight, f"cited {article}")
    SoulRecord.all_objects.filter(pk=record.pk).update(inferno_article=article)
    return record


def test_the_corpus_carries_the_articles_these_tests_cite(seeded_corpus):
    """Guard for the guard. Every assertion below is about a citation
    resolving; if the corpus stopped carrying these codes they would all be
    asserting that an unresolvable citation falls back to the ladder, which is
    a different claim and a passing one."""
    from apps.judgment.models import Statute

    for code, circle in [
        (VIOLENCE_ARTICLE, 7), (FRAUD_ARTICLE, 8), (CAINA, 9),
        (LIMBO_ARTICLE, 1), (HERESY_ARTICLE, 6),
    ]:
        statute = Statute.all_objects.filter(code=code).first()
        assert statute is not None, f"{code} is not seeded"
        assert (statute.payload_json or {}).get("circle") == circle, code


@pytest.mark.django_db
def test_violence_and_fraud_of_equal_weight_now_land_in_different_circles(
    make_european_soul, seeded_corpus
):
    """Inf. XI puts these two on opposite sides of Dis, and now so does this.

    The contradiction test of the same name above still passes, because it
    weighs two UNCLASSIFIED deeds. This is the same pair with the kind
    recorded, and it is the whole point of the field: same weight, different
    circle, because Dante divides malizia into violence and fraud rather than
    into more and less.
    """
    killer = make_european_soul("violent")
    swindler = make_european_soul("fraudulent")
    with SoulRecord.batch():
        _cite(killer, RecordCategory.MURDER, VIOLENCE_ARTICLE)
        _cite(swindler, RecordCategory.DECEPTION, FRAUD_ARTICLE)
    killer.refresh_from_db()
    swindler.refresh_from_db()

    assert killer.demerit_score == swindler.demerit_score, (
        "the weights differ, so this would prove nothing about kind"
    )
    assert DispositionService._route_to_realm(killer, Verdict.FAILED) == VIOLENCE
    assert DispositionService._route_to_realm(swindler, Verdict.FAILED) == FRAUD


@pytest.mark.django_db
def test_a_petty_fraud_and_a_grave_one_land_in_the_same_circle(
    make_european_soul, seeded_corpus
):
    """The other contradiction, inverted. Both belong in Malebolge and nowhere
    else; the ladder sent the small one to Limbo, which is not a punishment."""
    petty = make_european_soul("petty swindler")
    grave = make_european_soul("grave swindler")
    with SoulRecord.batch():
        _cite(petty, RecordCategory.DECEPTION, FRAUD_ARTICLE, weight=1)
        _cite(grave, RecordCategory.DECEPTION, FRAUD_ARTICLE, weight=BAND * 8)
    petty.refresh_from_db()
    grave.refresh_from_db()

    assert DispositionService._route_to_realm(petty, Verdict.FAILED) == FRAUD
    assert DispositionService._route_to_realm(grave, Verdict.FAILED) == FRAUD


@pytest.mark.django_db
def test_the_gravest_cited_circle_wins(make_european_soul, seeded_corpus):
    """A soul who both killed and swindled is a swindler as far as the eighth
    circle is concerned — Inf. XI.22-27 has fraud the graver, "because it is a
    fault peculiar to man". The rule is the poem's ordering, not a threshold
    invented here."""
    both = make_european_soul("both")
    with SoulRecord.batch():
        _cite(both, RecordCategory.MURDER, VIOLENCE_ARTICLE)
        _cite(both, RecordCategory.DECEPTION, FRAUD_ARTICLE)
    both.refresh_from_db()

    assert DispositionService._route_to_realm(both, Verdict.FAILED) == FRAUD


@pytest.mark.django_db
def test_a_zone_of_cocytus_names_the_trust_that_was_betrayed(
    make_european_soul, seeded_corpus
):
    """Treachery is not a deed type but a relationship betrayed — kin, country,
    guest, benefactor. `test_nothing_in_this_system_classifies_a_sin_the_way_
    dante_does` says no amount of categorising deeds produces it, and that is
    still true: what produces it is CITING the zone, whose own title is
    "Caina — Treachery to Kin". The vocabulary is the poem's."""
    traitor = make_european_soul("traitor")
    with SoulRecord.batch():
        _cite(traitor, RecordCategory.DECEPTION, CAINA)
    traitor.refresh_from_db()

    assert DispositionService._route_to_realm(traitor, Verdict.FAILED) == TREACHERY


@pytest.mark.django_db
def test_an_unclassified_soul_still_takes_the_culpa_ladder(
    make_european_soul, seeded_corpus
):
    """The compatibility half, asserted rather than assumed. Every row written
    before souls/0029 is unclassified, and inferring a circle from
    `RecordCategory` would be the mapping the EU-INF corpus exists to avoid."""
    unclassified = make_european_soul("unclassified")
    with SoulRecord.batch():
        _fraud(unclassified, weight=1)
    unclassified.refresh_from_db()

    assert DispositionService._route_to_realm(unclassified, Verdict.FAILED) == LIMBO, (
        "an unclassified petty fraud should still take the ladder — including "
        "to Limbo, which is the contradiction the ladder has and the citation "
        "path does not"
    )


@pytest.mark.django_db
def test_merit_citations_do_not_pull_a_soul_upward(make_european_soul, seeded_corpus):
    """Dante's circles hold the damned. `apps/ledger/readings.py` rules for this
    cosmology that a good deed does not retire a sin; letting a cited MERIT
    change where a soul lands would be that netting under another name.

    THE MERIT CITES A DEEPER CIRCLE THAN THE SIN, AND THAT IS THE POINT. The
    first version of this test gave the merit circle 7 against a demerit in
    circle 8 — and `max()` would have discarded it anyway, so removing the
    DEMERIT filter entirely left the test green. It was asserting a result the
    arithmetic produced for a different reason, which is the shape of a test
    that has data it cannot fail on. Citing Caina (circle 9) on the merit means
    only the filter can keep it out.
    """
    soul = make_european_soul("mixed")
    with SoulRecord.batch():
        _cite(soul, RecordCategory.DECEPTION, FRAUD_ARTICLE)
        merit = _record(soul, "MERIT", RecordCategory.CHARITY, ALMS_POINTS, "alms")
        SoulRecord.all_objects.filter(pk=merit.pk).update(inferno_article=CAINA)
    soul.refresh_from_db()

    assert DispositionService._route_to_realm(soul, Verdict.FAILED) == FRAUD, (
        "a cited MERIT reached the router — a good deed moved a damned soul, "
        "which is the netting apps/ledger/readings.py rules out for this "
        "cosmology by name"
    )


@pytest.mark.parametrize("article,circle", [(LIMBO_ARTICLE, 1), (HERESY_ARTICLE, 6)])
@pytest.mark.django_db
def test_a_deed_may_not_cite_a_circle_that_is_not_about_deeds(
    seeded_corpus, article, circle
):
    """Limbo and heresy carry `aristotle: None` in the corpus — Virgil's
    tripartition gives them no heading, because one is not a sin and the other
    is a belief. Accepting either here would let a deed sort a soul into Limbo,
    which is the contradiction the ladder already has."""
    from apps.souls.serializers import SoulRecordSerializer

    serializer = SoulRecordSerializer(data={
        "record_type": "DEMERIT",
        "category": RecordCategory.DECEPTION,
        "description": "x",
        "weight": 10,
        "inferno_article": article,
    })
    assert not serializer.is_valid(), f"{article} (circle {circle}) was accepted"
    assert "inferno_article" in serializer.errors, serializer.errors
