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

**Landed 2026-11-06 (v4 D7, user decision 「照文档」), and pinned so it stays the
judge's mark rather than a score.** Gorgias 525b-c divides the condemned in two:
the curable are benefited by their punishment, the incurable (ἀνίατοι) are made
everlasting examples; Republic X 615c-616a has the mouth refuse the incurable and
cast them into Tartarus (docs/02_希腊冥府审判与人物详解.md:183, :221, :252). Until
then this file pinned the distinction as ABSENT, because nothing in the system
bore on curability and a demerit threshold standing in for 「beyond help」 would be
the invented classifier `docs/lore-verification/README.md` §1 rules out (and that
`8308204` is the standing example of). That premise is gone and the rule still
stands: Gorgias 526b-c has the judge himself look at the soul and 「set a mark on
it, curable or incurable」 (docs/02:185), so the mark is `Judgment.greek_curability`,
stamped by the officer at conclusion — not derived from anything. The road is
still one road (524a); an INCURABLE mark makes that soul's disposition eternal,
on the soul and not on the realm, because the same Tartarus holds both kinds.
The last group of tests pins all of that, including that no score sets the mark.
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
# Four rows on a two-text basis, divided by what each text is asked for:
# Gorgias 524a supplies the judgment — the meadow and the two roads out of it —
# and Aeneid 6 supplies the topography, which here is the crossing a soul
# arrives by. `apps/actors/mythology/realms.py` states the division at the top
# of GREEK_REALMS and each row says which half it comes from.
GREEK_REALM_CODES = [
    "GR_PLATO_MEADOW",
    "GR_ACHERON",
    "GR_ISLES_OF_THE_BLESSED",
    "GR_TARTARUS",
]

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
    "GR_LUGENTES_CAMPI": (
        "Virgil's borderland sorts by manner of death — infants, the falsely "
        "condemned, suicides, and the Fields of Mourning for those who died of "
        "love (Aen. 6.426-476). Adopting Aeneid 6 for the topography does not "
        "make these reachable: `Judgment` produces a verdict and `Soul` carries "
        "a death date, not a death kind, so nothing in this system could route "
        "a soul to one. A realm no router can reach is what EG_AM_TYAT was "
        "retired for. The missing input is a cause-of-death field, and adding "
        "the regions before it exists would put the map ahead of the data."
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
        f"decided, record it on the realm rows and update this test, rather "
        f"than adding the row and leaving two documents disagreeing about "
        f"which author this cosmology follows. The basis IS now Gorgias plus "
        f"Aeneid 6 — verify-greek.md §8 route B, taken — but it is divided by "
        f"what each text is asked for, and neither half puts this row on the "
        f"map. Read the basis note at the top of GREEK_REALMS before "
        f"overruling this."
    )


@pytest.mark.django_db
def test_a_disposition_carries_its_realms_memory_reset(make_greek_soul):
    """The copy that was missing, and it was missing for every civilization.

    `create_from_judgment` copied `is_eternal` off the destination realm and
    not `memory_reset_mechanism`, so every auto-created disposition took the
    field's default of NONE. That made 孟婆汤 on twelve Chinese realms, the
    Egyptian SPELL on five and Dante's LETHE on two into seed data nothing
    read: `apps/reincarnation/services.py`'s `if disposition.memory_reset !=
    "NONE"` branch could never fire, so a soul that drank the broth at the
    tenth court was reborn carrying the description of the life it had left.

    Asserted as EQUALITY WITH THE REALM rather than as `== "LETHE"`, and over
    TWO ROUTES with different mechanisms. The first version of this test used
    one verdict, and its own docstring claimed the equality form would catch a
    disposition that hardcoded the right answer while ignoring the realm — it
    would not have. FAILED routes to GR_TARTARUS, which is LETHE, so a
    hardcoded `memory_reset=LETHE` satisfied the equality by coincidence and
    mutation showed it passing. One route can only ever compare a constant to
    itself; the second route is what makes the comparison mean anything.
    """
    call_command("seed_mythology", stdout=io.StringIO(), stderr=io.StringIO())

    # FAILED → GR_TARTARUS (LETHE); PURGATORY → the meadow (NONE). Two
    # mechanisms, so no single hardcoded value satisfies both.
    seen = {}
    for label, verdict in (("failed", Verdict.FAILED), ("unsettled", Verdict.PURGATORY)):
        soul = make_greek_soul(f"忘川探针·{label}")
        judgment = Judgment.objects.create(
            soul=soul, verdict=verdict, tenant=soul.tenant
        )
        disposition = DispositionService.create_from_judgment(judgment)

        assert disposition.destination_realm is not None, (
            f"{label}: no realm was routed to, so this asserts nothing"
        )
        realm = disposition.destination_realm
        assert disposition.memory_reset == realm.memory_reset_mechanism, (
            f"{label}: disposition.memory_reset is {disposition.memory_reset!r} "
            f"while its realm {realm.realm_code} says "
            f"{realm.memory_reset_mechanism!r}. The realm is what states the "
            f"mechanism; a disposition that does not carry it leaves every "
            f"seeded mechanism unread."
        )
        seen[label] = realm.memory_reset_mechanism

    assert len(set(seen.values())) == 2, (
        f"both routes landed on the same mechanism ({seen}), so this test is "
        f"comparing a constant to itself again. Pick verdicts whose realms "
        f"differ, or the equality above proves nothing."
    )


@pytest.mark.django_db
def test_both_greek_roads_reset_memory_and_the_two_thresholds_do_not(db):
    """Which Greek realms carry the drink, and which deliberately do not.

    Both destinations do, because both roads end in rebirth (`is_eternal` is
    False on each, GREEK is rebirth-capable) and both halves of this
    cosmology's basis put a forgetting-drink on that path — Republic X 621a-b
    at the river Ameles, Aeneid 6.713-715 at Lethe. It is the one place the
    two texts agree without needing the division rule.

    The meadow and the crossing do not, and that is the same shape the Chinese
    table already uses: 孟婆汤 sits on every destination a Chinese soul is
    reborn from (the courts and DY_01_HEAVEN) and on nothing else. Nobody is sentenced to the meadow or the crossing, so no rebirth follows
    from either.
    """
    call_command("seed_mythology", stdout=io.StringIO(), stderr=io.StringIO())
    mechanisms = dict(
        Realm.objects.filter(civilization="GREEK")
        .values_list("realm_code", "memory_reset_mechanism")
    )
    assert mechanisms == {
        "GR_PLATO_MEADOW": "NONE",
        "GR_ACHERON": "NONE",
        "GR_ISLES_OF_THE_BLESSED": "LETHE",
        "GR_TARTARUS": "LETHE",
    }, mechanisms


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
    gate above says this soul does have — and the incurable are stopped by their
    own eternal disposition (§3 below), not by a rule about the whole cosmology.
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
# 3. The exception: the judge's mark (Gorgias 526b-c), not a score.
# --------------------------------------------------------------------------


@pytest.mark.django_db
def test_every_condemned_greek_soul_gets_the_same_road_however_grave_the_wrong(
    make_greek_soul,
):
    """One road, no depth (524a), whatever the tally. One wrong against a hundred:
    both go to Tartarus. The incurable are not the ones who did *more* — Plato's
    examples are tyrants (525d-526a), not a count — so the router still reads the
    verdict alone; curability is the judge's mark and decides how long, not where.

    Red when a demerit figure starts separating the condemned: that is the
    invented classifier, the one thing the 2026-11-06 decision did not license.
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
        "the condemned are being separated by a ledger figure — curability is the "
        "judge's mark (526b-c), not a threshold"
    )


def test_curability_is_a_mark_on_the_judgment_and_nowhere_else():
    """The one fact 525c turns on lives on the case, as the judge's stamp — two
    members and a blank, no default that would decide for him. A curability field
    on the soul, its deeds or the disposition would be the place a derived value
    could hide; `Disposition.is_eternal` carries the consequence, not the mark.

    Mutation: give `greek_curability` a default of "CURABLE" → red."""
    from apps.judgment.models import GreekCurability

    forbidden = ("curab", "incurab", "aniat", "irredeem", "reformab")
    for model in (Soul, SoulRecord, Disposition):
        names = {field.name for field in model._meta.get_fields()}
        assert not {n for n in names if any(f in n for f in forbidden)}, model.__name__
    field = Judgment._meta.get_field("greek_curability")
    assert set(GreekCurability.values) == {"CURABLE", "INCURABLE"}
    assert field.default == "" and field.blank, "a default mark would be the system deciding, not the judge"

    members = {member.name for member in RecordCategory}
    assert not {name for name in members if "CURAB" in name or "TYRAN" in name}


def _sent_left(make_greek_soul, name, curability):
    call_command("seed_mythology", stdout=io.StringIO(), stderr=io.StringIO())
    soul = make_greek_soul(name)
    judgment = Judgment.objects.create(
        soul=soul,
        civilization=Civilization.GREEK,
        court="岔路草原",
        verdict=Verdict.FAILED,
        greek_curability=curability,
        tenant=soul.tenant,
    )
    return DispositionService.create_from_judgment(judgment)


@pytest.mark.django_db
def test_tartarus_is_not_eternal_and_the_unmarked_or_curable_serve_a_term(make_greek_soul):
    """The realm carries the norm (Republic X: a thousand years, then a new life),
    so it stays `is_eternal=False` — True would make every soul sent left an
    ἀνίατος. A curable soul, and one concluded before the mark existed, serve the
    default term (`apps/disposition/default_terms.py`, Republic X 615a-b)."""
    from apps.disposition.default_terms import GREEK_JOURNEY_YEARS
    from apps.judgment.models import GreekCurability

    for name, mark in (("unmarked", ""), ("curable", GreekCurability.CURABLE)):
        disposition = _sent_left(make_greek_soul, name, mark)
        assert disposition.destination_realm is not None, "the router returned a code the seed does not carry"
        assert disposition.destination_realm.realm_code == TARTARUS
        assert disposition.is_eternal is False, name
        assert disposition.sentence_years == GREEK_JOURNEY_YEARS, name
    assert Realm.all_objects.get(realm_code=TARTARUS).is_eternal is False, (
        "GR_TARTARUS is marked eternal, which makes every soul sent left an ἀνίατος"
    )


@pytest.mark.django_db
def test_an_incurable_soul_stays_in_tartarus_for_ever(make_greek_soul):
    """Gorgias 525b-c, Republic X 615c-616a: the same road, and no way back up it.
    The disposition is eternal with no term, and executing it leaves the soul
    SETTLED rather than REINCARNATING — `execute` reads `is_eternal`, so a Greek
    soul is rebirth-capable unless its own sentence says otherwise.

    Mutation: drop the INCURABLE branch in `create_from_judgment` → is_eternal is
    False and the soul goes REINCARNATING; red on both asserts."""
    from apps.judgment.models import GreekCurability

    disposition = _sent_left(make_greek_soul, "beyond help", GreekCurability.INCURABLE)
    assert disposition.destination_realm.realm_code == TARTARUS
    assert disposition.is_eternal is True
    assert disposition.sentence_years is None

    soul = disposition.soul
    soul.current_state = SoulState.DISPOSED
    soul.save(update_fields=["current_state"])
    DispositionService.execute(disposition)
    soul.refresh_from_db()
    assert soul.current_state == SoulState.SETTLED
