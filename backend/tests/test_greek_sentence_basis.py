"""What sorts a Greek soul — and the one distinction Plato draws that nobody here can.

Three claims live in this file and they are not the same claim.

**Landed, and pinned here so it stays landed.** `DispositionService` had no Greek
branch at all: `Civilization.GREEK` existed, `GR_HADES` held souls,
`_greek_reading` reported a sentence in years, and no verdict could reach
`GR_ISLES_OF_THE_BLESSED` or `GR_TARTARUS` — the two rows seeded from the one
sentence that names them. Plato, Gorgias 524a: judgment happens 「in the meadow
at the dividing of the road, whence are the two ways leading, one to the Isles
of the Blest, and the other to Tartarus」. PASSED takes the first road, FAILED
the second, and the two verdicts that settle nothing (PURGATORY, RETRY) leave
the soul standing on the meadow, which is the one place in that sentence that is
not a destination.

**Landed, and pinned because the neighbours are louder.** The Greek router reads
the verdict and no ledger figure whatsoever. A fork has two roads and no depth,
so there is nothing here for a severity number to select — not Dante's nine
circles (`_route_european`, whose own docstring §2 records that even *its*
ladder is the wrong shape for its own poem) and not Diyu's eight punishment
courts. `apps/ledger/readings.py` refuses the Chinese pool for this cosmology by
name: Republic X 615b requites well-doing 「in the same measure」 on its own road,
in parallel with the punishment rather than subtracted from it, so netting the
two 「would rebuild the Chinese account under a Greek name」.

**NOT landed, and pinned so that landing it has to be deliberate.** Gorgias 525c
divides the condemned in two: those whose wrongs are curable are benefited by
their punishment, and those who are incurable (ἀνίατοι) are made everlasting
examples. The owner has ruled that this exception holds alongside Republic X's
thousand-year circuit and its return to a new life (615a-b, 617d-620d) — rebirth
is the norm, the incurable are the exception. Only the norm is implemented. The
exception is not, because Plato's criterion is *curability* — whether punishment
can still improve the soul — and this system records nothing that bears on it:
`Soul` carries two scores, `RecordCategory` is a 功過格 deed vocabulary
(apps/ledger/fungibility.py) with no member for incorrigibility, and `Judgment`
holds free-form text and a citation. A demerit threshold standing in for
「beyond help」 would be the invented classifier that
`docs/lore-verification/README.md` §1 rules out for exactly this material, and
that `8308204` is the standing example of.

The last group of tests below therefore asserts that the distinction is STILL
absent — written the way `tests/test_european_hell_basis.py` and
`tests/test_migration_reverse_scope.py::test_perm_0008_sample_scopes_contradict_
perm_0017` are written, and for the same reason: nothing in the language
connects a routing formula to a claim about 525c, so the disagreement has to be
asserted or it is invisible. Whoever supplies a real curability judgment will
find these red and has to delete them on purpose.
"""
import io

import pytest
from django.core.management import call_command

from apps.actors.mythology.realms import GREEK_REALMS
from apps.disposition.models import Disposition
from apps.disposition.services import DispositionService
from apps.judgment.models import Judgment, Verdict
from apps.ledger.services import (
    CIVILIZATION_DECAY_RATE,
    DECAY_RATE,
    NON_FUNGIBLE_CIVILIZATIONS,
    REBIRTH_CAPABLE_CIVILIZATIONS,
    TERMINAL_COSMOLOGY_REASON,
    LedgerService,
)
from apps.realms.models import Realm
from apps.souls.models import Civilization, Soul, SoulState
from apps.souls.record_models import RecordCategory, SoulRecord
from apps.tenants.models import Tenant

#: Named through the class attributes rather than by literal realm code, per the
#: convention apps/disposition/tests.py states: these tests are about which road
#: a soul is sent down, not which string spells it.
ISLES = DispositionService.GR_ISLES
TARTARUS = DispositionService.GR_TARTARUS
MEADOW = DispositionService.GR_MEADOW

#: Every realm code the other three cosmologies route to. A Greek soul reaching
#: any of them is the pre-split behaviour returning — Plato's judges sentencing
#: into Dante's hell — and a bare `== TARTARUS` assertion would not say which
#: wrong answer had been given.
NOT_GREEK_GROUND = (
    {
        DispositionService.CHINESE_HEAVEN,
        DispositionService.CHINESE_PURGATORY,
        DispositionService.EU_HEAVEN,
        DispositionService.EU_PURGATORY,
        DispositionService.EG_AARU,
        DispositionService.EG_ANNIHILATION,
        DispositionService.EG_DUAT_ENTRY,
    }
    | set(DispositionService.EU_HELL_CIRCLES.values())
    | set(DispositionService.CHINESE_HELL_TIERS.values())
)

#: One killing, weighted the way tests/test_european_hell_basis.py weights it.
KILLING_POINTS = 100


@pytest.fixture
def make_greek_soul(db):
    """Greek souls whose deeds are dated in their year of death.

    Dated at the anchor so decay is a no-op and the scores are exactly the
    weights — GREEK has no CIVILIZATION_DECAY_RATE entry and falls to the shared
    DECAY_RATE, which is asserted separately below. A factory rather than one
    soul because most claims here compare two ledgers that must not matter.
    """
    tenant = Tenant.objects.get_or_create(
        code="GR_HADES", defaults={"display_name": "Greek Afterlife"}
    )[0]

    def _make(name):
        soul = Soul.objects.create(
            name=name,
            current_state=SoulState.JUDGING,
            death_year=2000,
            tenant=tenant,
        )
        assert soul.civilization == Civilization.GREEK
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


def _killing(soul, weight=KILLING_POINTS):
    _record(soul, "DEMERIT", RecordCategory.MURDER, weight, "slew a man")


def _alms(soul, count=100):
    for n in range(count):
        _record(soul, "MERIT", RecordCategory.CHARITY, 1, f"alms #{n + 1}")


# --------------------------------------------------------------------------
# 1. The fork: two roads, and the ground they lead out of
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_a_passed_greek_soul_takes_the_road_to_the_isles(make_greek_soul):
    """Gorgias 524a, the first of the two ways.

    Before this branch existed a PASSED Greek soul got the empty string — the
    fallback for a soul whose tenant names no cosmology — so the disposition was
    created with `destination_realm=None`. The tenant was configured; the router
    was not.
    """
    soul = make_greek_soul("the just")
    destination = DispositionService._route_to_realm(soul, Verdict.PASSED)

    assert destination == ISLES
    assert destination not in NOT_GREEK_GROUND, (
        "a Greek soul was sentenced into another cosmology's geography"
    )


@pytest.mark.django_db
def test_a_failed_greek_soul_takes_the_road_to_tartarus(make_greek_soul):
    """Gorgias 524a, the other way, named in the same sentence."""
    soul = make_greek_soul("the unjust")
    with SoulRecord.batch():
        _killing(soul)
    soul.refresh_from_db()

    destination = DispositionService._route_to_realm(soul, Verdict.FAILED)

    assert destination == TARTARUS
    assert destination not in NOT_GREEK_GROUND, (
        "a Greek soul was sentenced into another cosmology's geography"
    )


@pytest.mark.django_db
def test_an_unsettled_verdict_leaves_the_soul_on_the_meadow(make_greek_soul):
    """The verdicts 524a has no outcome for, answered by the place it does have.

    PURGATORY and RETRY say the outcome is not fixed. Plato's fork has no
    「pending」 road, and inventing a third destination for one is the failure
    this whole directory catalogues — so the soul is placed where 524a puts a
    soul that has not been sent down either road: the meadow the judging happens
    on. The absence of both roads is asserted, because "it went somewhere Greek"
    would stay green if the meadow had quietly become a third outcome to which
    souls are sentenced.
    """
    soul = make_greek_soul("still at the fork")
    with SoulRecord.batch():
        _killing(soul)
    soul.refresh_from_db()

    for verdict in (Verdict.PURGATORY, Verdict.RETRY):
        destination = DispositionService._route_to_realm(soul, verdict)
        assert destination == MEADOW, f"{verdict} was concluded by something"
        assert destination not in (ISLES, TARTARUS), (
            f"{verdict} sent an unfinished case down a road; 524a's judges send "
            f"a soul one way or the other only once they have tried it"
        )


@pytest.mark.django_db
def test_the_verdict_is_the_only_thing_the_greek_router_reads(make_greek_soul):
    """Not "the ledger matters less", but "the ledger does not enter".

    Two souls at opposite ends of every scale this system has — one with a
    hundred alms and no fault, one with a killing and nothing else — routed
    under each verdict in turn. A test that only checked the murderer sank
    *deeper* would stay green if a depth ladder had been copied over from
    `_route_european`; there is no depth here to sink into.
    """
    saint = make_greek_soul("hundred alms")
    murderer = make_greek_soul("one killing")
    with SoulRecord.batch():
        _alms(saint)
        _killing(murderer)
    saint.refresh_from_db()
    murderer.refresh_from_db()

    assert saint.karmic_balance != murderer.karmic_balance, "fixture is not a contrast"
    assert saint.demerit_score != murderer.demerit_score

    for verdict in (Verdict.PASSED, Verdict.FAILED, Verdict.PURGATORY, Verdict.RETRY):
        assert DispositionService._route_to_realm(
            saint, verdict
        ) == DispositionService._route_to_realm(murderer, verdict), (
            f"{verdict} routed two Greek souls differently, so a ledger figure "
            f"is selecting a destination. Gorgias 524a is a fork, not a ladder."
        )


@pytest.mark.django_db
def test_the_gongguoge_partition_does_not_reach_a_greek_soul(make_greek_soul):
    """452616f's 不可折 rule is Chinese arithmetic, and Plato has none to limit.

    Republic X 615b repays well-doing on its own road in its own measure; a good
    deed never discharges part of the term owed on the other. There is no
    offsetting step, so there is nothing for a pool split to constrain — the
    Egyptian reason rather than the European one, and it is why GREEK is not in
    `NON_FUNGIBLE_CIVILIZATIONS`. The refusal is None, the absence of a claim,
    and not 0, which would be one.
    """
    soul = make_greek_soul("outside 凡例's jurisdiction")
    with SoulRecord.batch():
        _alms(soul)
        _record(soul, "DEMERIT", RecordCategory.GREED, KILLING_POINTS, "stole")
    soul.refresh_from_db()

    assert Civilization.GREEK not in NON_FUNGIBLE_CIVILIZATIONS
    assert LedgerService.get_unoffset_demerit(soul) is None
    assert LedgerService.get_unoffset_demerit(soul) != 0


# --------------------------------------------------------------------------
# 2. The circuit: Republic X's norm, wired to the two constants that carry it
# --------------------------------------------------------------------------


# The Greek realms this system seeds, and the ones it deliberately does not.
#
# Three rows, all from Gorgias 524a: the meadow the judging happens on and the
# two roads out of it. `apps/actors/mythology/realms.py` states that basis on
# the rows themselves — GR_TARTARUS says in as many words that it is "the
# Gorgias one" and why it is not Virgil's.
GREEK_REALM_CODES = ["EU_PLATO_MEADOW", "GR_ISLES_OF_THE_BLESSED", "GR_TARTARUS"]

# Named here so their absence is a decision with a citation attached rather
# than a gap someone fills in good faith. Each entry is (code, why not).
GREEK_REALMS_DELIBERATELY_ABSENT = {
    "GR_ASPHODEL": (
        "Homer's asphodel field (Od. 11.538-540) is where Achilles' shade walks "
        "— a hero, not a middling soul. Homer draws no line between it and "
        "anywhere else, and the Tartarus/Asphodel/Elysium three-way split is a "
        "later systematization, mostly modern; docs/lore-verification/"
        "verify-greek.md records both findings and the source it cites for the "
        "split self-declares the relationship as uncertain. Seeding it as a "
        "NEUTRAL destination would invent a third road out of a fork whose own "
        "sentence names two, which is the mistake EG_AM_TYAT was retired for."
    ),
    "GR_ELYSIUM": (
        "Homer's Elysian plain (Od. 4.563-568) is an exemption from death "
        "granted to particular men, not a reward a life earns; Pindar's Isles "
        "(Ol. 2) require three just lives on either side of the grave. "
        "GR_ISLES_OF_THE_BLESSED already carries the Gorgias destination and "
        "records both variants in its description. A second row would be the "
        "same place under a different author's name."
    ),
}


def test_the_greek_realms_are_exactly_the_fork_and_its_two_roads():
    """The subject set, pinned — not counted and not sampled.

    `GREEK_REALMS` is where a fourth Greek realm would land, and a fourth realm
    is a fourth destination a judge could send a soul to. Pinning the list by
    name means adding one fails here first, with the basis stated above it,
    rather than being noticed later as a routing surprise.
    """
    assert sorted(code for code, *_ in GREEK_REALMS) == sorted(GREEK_REALM_CODES)


@pytest.mark.parametrize("code", sorted(GREEK_REALMS_DELIBERATELY_ABSENT))
def test_a_greek_realm_this_system_refuses_stays_refused(code):
    """An absence with no test behind it reads as an oversight.

    And the obvious repair for an oversight is to add the row — which is
    precisely the change the absence exists to prevent. Same device as
    `test_set_stays_out_of_the_judgment` and the unattested-realm check: the
    reason travels in the failure message, so whoever hits this reads the
    evidence before deciding to overrule it.
    """
    seeded = [c for c, *_ in GREEK_REALMS]
    assert code not in seeded, (
        f"{code} is seeded. It is deliberately absent: "
        f"{GREEK_REALMS_DELIBERATELY_ABSENT[code]} If a basis change has been "
        f"decided — Gorgias plus Aeneid 6 is the live proposal in "
        f"docs/lore-verification/verify-greek.md §8 route B — record that "
        f"decision on the realm rows and update this test, rather than adding "
        f"the row and leaving two documents disagreeing about which author "
        f"this cosmology follows."
    )


def test_greek_souls_are_rebirth_capable():
    """Republic X 617d-620d: the soul chooses a new life at the Spindle.

    The set is the single gate for both the reincarnation machinery and the
    state machine (`DispositionService.execute`), so this is the whole of "a
    Greek soul has a next life".
    """
    assert Civilization.GREEK in REBIRTH_CAPABLE_CIVILIZATIONS


def test_greek_is_not_recorded_as_a_terminal_cosmology():
    """The absence, stated, because a cosmology in both maps is a contradiction.

    `TERMINAL_COSMOLOGY_REASON` is the copy `RebirthNotApplicable` reads when it
    refuses a soul a next life. A GREEK entry would describe an afterlife the
    gate above says this soul does have — and half an entry, covering only the
    incurable, would name a population §3 below shows nobody can pick out.
    """
    assert Civilization.GREEK not in TERMINAL_COSMOLOGY_REASON
    assert set(TERMINAL_COSMOLOGY_REASON) == {
        Civilization.EGYPTIAN,
        Civilization.EUROPEAN,
    }


@pytest.mark.django_db
def test_an_executed_greek_disposition_sends_the_soul_round_again(make_greek_soul):
    """The state machine agrees with the gate, which is why it has no Greek branch.

    `execute` asks `REBIRTH_CAPABLE_CIVILIZATIONS` rather than testing a
    civilization by name, so this passed the moment the constant did. Asserted
    anyway: it is the observable half, and SETTLED is what a Greek soul used to
    get — the label for a cosmology whose account is closed.
    """
    soul = make_greek_soul("choosing again")
    soul.current_state = SoulState.DISPOSED
    soul.save(update_fields=["current_state"])

    DispositionService.execute(
        Disposition.objects.create(soul=soul, tenant=soul.tenant)
    )
    soul.refresh_from_db()

    assert soul.current_state == SoulState.REINCARNATING
    assert soul.current_state != SoulState.SETTLED


@pytest.mark.django_db
def test_inheritance_answers_a_greek_soul_with_a_number(make_greek_soul):
    """The 409 gate opens. `assert_rebirth_capable` is the same frozenset again."""
    soul = make_greek_soul("carrying something forward")
    with SoulRecord.batch():
        _alms(soul)
    soul.refresh_from_db()

    inheritance = LedgerService.get_reincarnation_inheritance(soul)
    assert inheritance["inherited_merit"] > 0


@pytest.mark.django_db
def test_greek_has_no_decay_rate_of_its_own_and_that_is_the_answer(make_greek_soul):
    """The dict entry that was predicted and is not warranted.

    A rate scales the *weight* of a deed by elapsed time. Nothing Greek reads a
    weight: `_greek_reading` counts wrongs, because Republic X 615a-b repays
    tenfold per wrong done and `weight` is this house's own severity scale; and
    `_route_greek` reads the verdict alone. An entry would govern nothing, and
    0.0 in particular would assert that Greek deeds do not fade — a doctrine
    nobody argued for. The shared default still applies to the displayed sums,
    which commit to no cosmology.
    """
    assert Civilization.GREEK not in CIVILIZATION_DECAY_RATE
    assert LedgerService._decay_rate_for(make_greek_soul("undecayed")) == DECAY_RATE


# --------------------------------------------------------------------------
# 3. The exception. These tests assert a contradiction is still there.
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_every_condemned_greek_soul_gets_the_same_road_however_grave_the_wrong(
    make_greek_soul,
):
    """CONTRADICTION, PINNED. Gorgias 525c divides these two and this router cannot.

    One wrong against a hundred of them. Both are sent to Tartarus, which is
    right as far as 524a goes — one road, no depth — and is exactly why the
    525c distinction cannot ride on top of it: the incurable are not the ones
    who did *more*, they are the ones punishment can no longer improve, and
    Plato's examples are tyrants (525d-526a) rather than a tally. There is no
    number in this system that separates them and no threshold that would be
    anything but invented.

    This goes red when someone routes the incurable elsewhere, or marks them.
    That is the day to delete it, having first read `_route_greek`'s docstring
    on why nobody has.
    """
    once = make_greek_soul("one wrong")
    many = make_greek_soul("a hundred wrongs")
    with SoulRecord.batch():
        _killing(once)
        for _ in range(100):
            _killing(many)
    once.refresh_from_db()
    many.refresh_from_db()

    assert many.demerit_score > once.demerit_score * 50, "fixture is not a contrast"
    assert DispositionService._route_to_realm(
        once, Verdict.FAILED
    ) == DispositionService._route_to_realm(many, Verdict.FAILED) == TARTARUS, (
        "the condemned are being separated by something — if that is a real "
        "curability judgment, 525c is satisfied and this test has done its job; "
        "if it is a demerit threshold, it is the invented classifier"
    )


def test_nothing_in_this_system_says_whether_a_soul_can_be_cured():
    """CONTRADICTION, PINNED: the missing input, named field by field.

    Asserted as absence, because that is what it is. A field named for
    curability appearing on any of these four is the signal that someone has
    started storing the one fact 525c turns on — and also the signal that they
    may have derived it from a score, which is the thing to check before
    deleting this.
    """
    forbidden = ("curab", "incurab", "aniat", "irredeem", "reformab")
    for model in (Soul, SoulRecord, Judgment, Disposition):
        names = {field.name for field in model._meta.get_fields()}
        for fragment in forbidden:
            offenders = {name for name in names if fragment in name}
            assert not offenders, (
                f"{model.__name__} now carries {sorted(offenders)}. If this is a "
                f"real curability judgment, `_route_greek` can stop sending every "
                f"condemned soul down one road. If it is derived from "
                f"merit/demerit, it is a threshold wearing Plato's word."
            )

    # The deed taxonomy is Chinese and has no member for it either — 功過格 grades
    # what was done, and ἀνίατος is a claim about what the doer has become.
    members = {member.name for member in RecordCategory}
    assert not {name for name in members if "CURAB" in name or "TYRAN" in name}


@pytest.mark.django_db
def test_tartarus_asserts_neither_perpetuity_nor_a_term(make_greek_soul):
    """CONTRADICTION, PINNED: one realm, two outcomes, one BooleanField.

    Republic X sends the unjust round again after a thousand years; 525c keeps
    the incurable there for good. `Realm.is_eternal` is a property of the place
    and the same Tartarus holds both kinds, so the flag cannot express the
    split. It is False, which now carries the norm — and the per-soul column
    that *could* carry the exception, `Disposition.is_eternal`, is copied
    straight off it, so a condemned Greek soul is recorded as not-eternal
    whatever it did.

    `sentence_years` is asserted null in the same breath and is the other half
    of the gap: the field's own help_text reads 「null = eternal」, so the two
    columns of this row say opposite things about the same soul. Neither is
    filled in, and neither should be guessed — Republic X's thousand years is a
    number from a different dialogue than the one GR_TARTARUS is seeded from,
    and welding them together is the synthesis
    docs/lore-verification/verify-greek.md §6 says not to perform.
    """
    call_command("seed_mythology", stdout=io.StringIO(), stderr=io.StringIO())

    realm = Realm.all_objects.get(realm_code=TARTARUS)
    assert realm.is_eternal is False, (
        "GR_TARTARUS is marked eternal, which makes every soul sent left an "
        "ἀνίατος — the smaller population and the one Plato treats as remarkable"
    )

    soul = make_greek_soul("sent left")
    judgment = Judgment.objects.create(
        soul=soul,
        civilization=Civilization.GREEK,
        court="岔路草原",
        verdict=Verdict.FAILED,
        tenant=soul.tenant,
    )
    disposition = DispositionService.create_from_judgment(judgment)

    assert disposition.destination_realm is not None, (
        "the Greek verdict produced a disposition with no realm — the router "
        "returned a code the seed does not carry"
    )
    assert disposition.destination_realm.realm_code == TARTARUS
    assert disposition.is_eternal is False
    assert disposition.sentence_years is None, (
        "a term was written for a Greek soul. Republic X 615a-b gives one — a "
        "thousand years — but GR_TARTARUS is seeded from Gorgias 524a, and "
        "reading the two as one geography is the thing verify-greek.md §6 "
        "refuses. If this was decided on purpose, say so on the realm row."
    )
