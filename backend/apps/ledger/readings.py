"""What each cosmology actually reads off a ledger.

`karmic_balance` — merit minus demerit — is the Chinese instrument, not a
shared primitive. 功過格 is a cumulative account: deeds do not expire, they net
off against each other, and the account is cleared by a deliberate act of
dedication (回向). A single net total is the right reading *there* and nowhere
else in the survey:

  * EGYPTIAN judgment is not a score, it is a threshold. The heart is weighed
    once against the feather of Maat and must be "not heavier than" it — a
    comparison against a fixed counterweight, not a magnitude, and emphatically
    not one where good deeds subtract from bad.
  * EUROPEAN (Dante) judgment is not an account at all. Purgatorio works off
    *poena* after *culpa* has already been forgiven; guilt and penalty come
    apart, which is exactly the thing a netting total cannot represent.
  * GREEK is not one reckoning but two running side by side — Plato's judges
    send the just to the right and the unjust to the left (Republic X, 614c),
    and both roads repay tenfold over the same thousand-year circuit (615a-b).
    Two parallel counts on one clock, and emphatically not their difference. It
    has landed: `Civilization.GREEK` exists, `GR_HADES` is its tenant, and
    `_greek_reading` below is the fourth entry. The sentence this bullet used to
    end with — "not in the Civilization enum yet and must not be added here
    first" — was about the *order* of one change, not a prohibition on ever
    making it: the enum member has to exist before a key can name it, and
    `apps/ledger/test_readings.py` requires the two to match, so both halves
    land together or the suite is red in between.

So four cosmologies want four differently-shaped answers: a balance, a
comparison, two unrelated numbers, and two parallel repayments on a clock
nobody started. Serving all of them one
shape built around a net total does not simplify the model, it silently applies
the Chinese one to everybody — and it is not harmless. Run against real data, a
net balance passes an Egyptian soul on a mechanic his tradition does not have.

Held as a dict of builders rather than an if/elif chain for the same reason
REBIRTH_CAPABLE_CIVILIZATIONS in services.py is a frozenset: adding GREEK
was one entry, next to the others, where it is obvious that a fourth
answer was needed and what it is.

This module *adds* a reading. It does not replace `karmic_balance`, which is a
Soul property the souls app owns and which querysets filter and order by in SQL.
Removing it is a separate, larger change.

What routing reads is no longer the same question. `disposition/services.py`
used to sentence every soul on `karmic_balance`; the Chinese branch now
sentences on the unoffset-demerit figure `non_fungible` reports below (via
`LedgerService.get_unoffset_demerit`), and the other two branches still read the
raw balance because 「不可折」 is a limit on 功過相抵 and neither of them has one.
That asymmetry is the same one this module is built on, carried one layer out.

RESOLVED(i18n): the three English sentences that used to sit in this module —
`poena_unavailable` in `_european_reading`, `reason` in
`get_civilization_reading`, and `elapsed_unavailable` in `_greek_reading` —
are gone. `poena_missing`, `reason_code` and `elapsed_missing` replaced them.

The third one went a release later than the other two, and the delay was the
argument rather than an oversight. `elapsed_unavailable` was exempted from the
prose rule on a survey finding — `SoulReadingPanel.tsx` had no SENTENCE branch,
so converting it would have deleted an explanation and put nothing in its
place — and that exemption was recorded as an exact-set assertion in
`test_readings.py::PROSE_STILL_ALLOWED` so that giving the Greek reading a
panel could not happen without the finding being re-decided. The panel now
exists; the finding is void; the field is members. That set is empty again.

The survey the old TODO asked for was done, and it found the worst case: the
frontend never read either string, and rendered the same content itself, more
completely. `SoulReadingPanel.tsx` drew the poena panel from
`souls.detail.reading.*` keys — a heading plus *three separate bullets* where
the sentence had one clause listing three things — and drew the unmapped-tenant
panel from `unavailable_explanation` and `unavailable_cta`. Both fields were
declared in `frontend/lib/api/ledger.ts` and read by nothing in the repository.

So the split `66a5a3f` drew holds and these two fall on the catalogue side of
it. What distinguishes them from TERMINAL_COSMOLOGY_REASON, which stays in
services.py in English on purpose: that one is the `detail` of a 409 whose only
readers are non-browser clients and the logs. These two were fields of a 200
body that a component renders, and a rendered string belongs where the
translations are.

What replaced them is not a shorter sentence, it is the members the sentence
was enumerating — the same move `66a5a3f` made when it took `inheritance_note`
out and left the two rates as numbers. A hard-coded clause on this side and a
hard-coded list of three bullets on the other is two copies of one fact, and
the second copy is the one that does not move: had the missing-input list here
grown to four, the panel would have gone on rendering three and nothing would
have been red. The panel now renders one bullet per member of `poena_missing`
and derives each bullet's catalogue key from the member name, so a fourth
member reaches the screen — as copy, or failing that as a visible raw key —
rather than being silently dropped.

A non-browser client is not left with a bare `null`. `poena_missing` names the
absent facts in the doctrine's own vocabulary and `reason_code` names the
state; both are stable identifiers a client can switch on, which an English
sentence never was, and both are enumerated as module constants below so the
full set is readable in one place instead of being reconstructed out of a
paragraph.
"""
import datetime

from apps.ledger.fungibility import offset_within_classes
from apps.souls.dates import whole_years_between
from apps.souls.models import Civilization

# What the heart is weighed against, in SoulRecord.weight units.
#
# This number is a product decision, not a sourced one, and is labelled as such
# deliberately. No Egyptian source gives the feather a magnitude — it could not,
# because the weighing is not a unit conversion. The heart (ib) is an organ
# carrying the moral record of a life; the feather (šwt of Maat) is rightness
# itself. The sources assert exactly one quantitative thing about the pairing:
# that the feather is *light*, and therefore that the bar is close to absolute.
# The 42 declarations of the Papyrus of Ani are denials of specific wrongs —
# "I have not stolen", "I have not killed" — not a claim to have done enough
# good to outweigh them.
#
# 1 is the smallest weight a SoulRecord can carry (the field's default, and the
# floor of its documented 1-100 range), so it is the lightest thing this system
# is able to put on a scale. Choosing it says: a heart with any recorded
# wrongdoing beyond a single minimal deed is heavier than the feather. That is a
# harsh instrument, and it is meant to be — it is the one property the sources
# actually assert, and softening it to a comfortable allowance (10, 20) would be
# inventing an Egyptian doctrine of tolerable sin in order to make the reading
# friendlier. If the product later wants a more forgiving bar that is a fine
# thing to want, but it should be changed here, on purpose, and not arrived at
# by picking whichever number made the dashboard look better.
MAAT_FEATHER_WEIGHT = 1


def _chinese_reading(merit: int, demerit: int, merit_count: int,
                     demerit_count: int, class_totals: dict | None = None,
                     term_start: tuple | None = None) -> dict:
    """A cumulative account — but not a single interchangeable pool.

    `balance` stays merit minus demerit. It is the native instrument here (it is
    what 不善門#8's 夾注 defines: 「一過去功一分，十過去功十分」) and it is what
    `Soul.karmic_balance` mirrors. It is no longer what disposition routes a
    Chinese soul on — see `non_fungible` below and the module docstring.

    What is added is the limit the same tradition puts on that arithmetic.
    《文昌帝君功過格·凡例》: 「功過有不可折者。如用財之百功，不可折致死人之
    百過。」 A single scalar pool cannot express that, and this system did not:
    a hundred hundred-cash alms cancelled one killing exactly, which is the
    trade the 凡例 rules out by name. `non_fungible` nets each class against
    itself and reports what is left standing on both sides — see
    apps/ledger/fungibility.py, including what it deliberately does not do.

    Absent when `class_totals` is None. A caller that cannot say where the
    points came from gets no claim about fungibility rather than a fabricated
    one — the same discipline `get_civilization_reading` applies to an unmapped
    tenant below.

    Neither record count is used, and that is the same decision as
    `_european_reading`'s in the opposite direction. 功過格 counts 分, not
    deeds: 不善門#8's 夾注 prices a fault at 「一過去功一分」 and a grave one at
    十分, so the ledger's own unit is the weight and a tally of how many entries
    produced it says nothing this account can act on. `demerit_count` is what
    the European reading needs precisely because *there* the deed is the unit;
    `merit_count` is what the Greek reading needs for the same reason. Received
    and unused, so that ignoring them stays a decision with a stated reason
    rather than an argument nobody offered this builder.

    `term_start` is the same, and the reason is the strongest of the three
    non-Greek ones. 功過格 imposes no term at all. It is a cumulative account
    settled by 回向, not a sentence with a clock — nothing here starts, so there
    is no start date to have. A Chinese soul's Disposition can perfectly well
    carry one (the column is on the model, not on a cosmology), and this
    reading still has nothing to say about it.
    """
    reading = {
        "kind": "BALANCE",
        "civilization": Civilization.CHINESE.value,
        "balance": merit - demerit,
        "merit": merit,
        "demerit": demerit,
    }
    if class_totals is not None:
        reading["non_fungible"] = offset_within_classes(class_totals)
    return reading


def _egyptian_reading(merit: int, demerit: int, merit_count: int,
                      demerit_count: int, class_totals: dict | None = None,
                      term_start: tuple | None = None) -> dict:
    """A threshold. The heart against a fixed counterweight — pass or fail.

    The heart's weight is the demerit total *alone*. Merit does not appear, and
    its absence is the whole point of this reading: the weighing has no
    offsetting step. A life of recorded charity does not make a heart lighter in
    the Hall of Two Truths, because what the scale measures is the wrongdoing
    the heart is carrying, and Ammit is not waiting on a subtraction.

    Netting is what the shared summary did, and against this deployment's own
    data it passed a soul it should not have: a heart carrying 18 points of
    recorded wrongdoing read as +6 once 24 points of merit were subtracted from
    it, and +6 is on the passing side of every threshold anyone would pick.

    `merit_count` is therefore doubly irrelevant here and is received anyway.
    If the merit *sum* has nothing to say to a scale that never subtracts, a
    tally of the deeds behind it has less; and the weighing does not count
    wrongs either, because what goes on the pan is the heart's weight and not a
    list of charges. The 42 declarations of the Papyrus of Ani are denials, one
    per wrong, but they are the interrogation and not the measurement.

    `term_start` is received and unused for a reason of the same kind. The
    weighing happens once. Aaru and the Devourer are outcomes, not sentences
    served, so there is no interval for a start date to be the start of — and
    an Egyptian Disposition that carries one is recording something this
    reading has no place to put rather than something it is failing to report.
    """
    return {
        "kind": "THRESHOLD",
        "civilization": Civilization.EGYPTIAN.value,
        "heart_weight": demerit,
        "counterweight": MAAT_FEATHER_WEIGHT,
        # "Not heavier than" — equality passes. The formula in the Book of the
        # Dead is balance, not surplus, and a heart level with the feather is
        # the ideal outcome rather than a near miss.
        "heavier_than_feather": demerit > MAAT_FEATHER_WEIGHT,
    }


#: The facts *poena* presupposes and which nothing in this ledger records, as
#: members rather than as a sentence that lists them.
#:
#: Same device as GRANULARITY_MISSING_INPUTS in fungibility.py, and for the same
#: stated reason: naming the absent inputs as data means the next attempt adds
#: the data rather than inventing a marker, a caller can enumerate them, and a
#: catalogue can key one string off each member. The wording of what each member
#: means lives in `_european_reading`'s docstring below and in the three message
#: bundles; it is deliberately not on the wire.
#:
#: Order is Purgatorio's order of operations — absolution first, because
#: satisfaction is only owed for a sin already forgiven and penance only
#: discharges satisfaction — and the panel renders the list in it.
POENA_MISSING_INPUTS = ("ABSOLUTION", "SATISFACTION", "PENANCE")


def _european_reading(merit: int, demerit: int, merit_count: int,
                      demerit_count: int, class_totals: dict | None = None,
                      term_start: tuple | None = None) -> dict:
    """Two unrelated numbers, because guilt and penalty are two facts here.

    *Culpa* is guilt: that a wrong was done, and how grave. It maps onto the
    DEMERIT records and nothing else. Merit is deliberately absent — in this
    cosmology a good deed does not retire a sin, absolution does, and letting
    merit reduce culpa would rebuild the Chinese netting account under a Latin
    name. The record count travels with the total because "one grave sin" and
    "eight small ones" are different guilts and the same number.

    *Poena* is the penalty that remains after culpa has been forgiven — the
    thing Purgatorio is actually about, and the reason the published European
    label reads 审判与补赎. We cannot compute it, and this reading says so
    rather than substituting a proxy.

    The gap is not a lookup we have not written; it is data we do not hold.
    Poena presupposes three facts, and SoulRecord stores none of them: that
    ABSOLUTION has occurred (nothing records contrition or confession), how much
    SATISFACTION is owed for a forgiven sin (weight measures the gravity of the
    deed, which is culpa, and Dante's terraces are not sorted by it), and how
    much PENANCE has already been performed (there is no record type for an act
    of expiation — MERIT is a good deed done in life, not satisfaction rendered
    after death). Deriving poena from the demerit total would just be culpa
    printed twice under a second heading, which is precisely the collapse this
    reading exists to stop making.

    Those three are POENA_MISSING_INPUTS, and the reading reports them by name
    instead of describing them in a sentence — see the RESOLVED(i18n) note in
    the module docstring for why the sentence went.

    `merit_count` is received and unused, and the asymmetry with
    `culpa_record_count` is the argument rather than an oversight. The demerit
    count travels because "one grave sin" and "eight small ones" are different
    guilts and the same number, and culpa is a thing this reading reports. There
    is no merit figure here at all for a merit count to qualify: a good deed
    does not retire a sin, so counting good deeds beside culpa would put a
    number on screen whose only available reading is the subtraction this
    cosmology does not perform. The Greek reading takes the same count and does
    report it, because there the good deeds have a road of their own to be
    repaid on; Purgatorio gives them none.

    `term_start` is received and unused, and this is the one of the three
    refusals worth stating carefully, because Purgatorio *does* have duration
    and the temptation is real. What POENA_MISSING_INPUTS names are three
    quantities — whether absolution has occurred, how much satisfaction is
    owed, how much penance has been performed — and a start date is none of
    them. Knowing when a soul entered Purgatorio says nothing about how much
    it owes, and time-on-the-terrace is precisely the reading Indulgentiarum
    Doctrina abolished the day-denominated indulgence for encouraging (see
    CIVILIZATION_DECAY_RATE in services.py). If a start date ever becomes an
    input to poena, it becomes a fourth member of that tuple first, on purpose.
    """
    return {
        "kind": "GUILT_AND_PENALTY",
        "civilization": Civilization.EUROPEAN.value,
        "culpa": demerit,
        "culpa_record_count": demerit_count,
        "poena": None,
        # Non-empty for as long as `poena` is None. An absence that does not say
        # what is missing is the bare null this list exists to avoid handing a
        # client, so the two travel together and test_readings.py pins the pair.
        "poena_missing": list(POENA_MISSING_INPUTS),
    }


# The two numbers Republic X actually states, kept as named constants because
# they are quotations and not tuning knobs.
#
# 615a-b: the unjust "had paid the penalty in turn tenfold for each" wrong done,
# "and the measure of this was by periods of a hundred years each, so that on
# the assumption that this was the length of human life the punishment might be
# ten times the crime" — ten periods of a hundred years, i.e. a thousand-year
# circuit, and the same measure requites those who did well.
#
# One multiple and one circuit length, for two roads. That is not an economy of
# fields, it is what 615b says: those who had done good "received requital in
# the same measure". Emitting a second `reward_multiple` and a second circuit
# would be two wire names for one quoted fact, and the two copies would be free
# to drift — the failure `inheritance_note` and the frontend's hard-coded
# 20/100 already demonstrated once in this codebase.
GREEK_REPAYMENT_MULTIPLE = 10
GREEK_CIRCUIT_YEARS = 100 * GREEK_REPAYMENT_MULTIPLE


#: The facts elapsed time presupposes and which nothing in this ledger records,
#: as members rather than as a sentence that lists them.
#:
#: Third instance of the device — after GRANULARITY_MISSING_INPUTS in
#: fungibility.py and POENA_MISSING_INPUTS above — and the first one that had to
#: be converted rather than born that way. `elapsed_unavailable` was a
#: four-line English paragraph on the wire, and `test_readings.py` exempted it
#: from the prose rule for one stated reason: `SoulReadingPanel.tsx` had no
#: SENTENCE branch, so converting it would have deleted an explanation and put
#: nothing in its place. That reason expired the moment the panel was built, and
#: the exemption was written as an exact-set assertion precisely so that
#: building the panel had to come back past it.
#:
#: Order is the order of the arithmetic that cannot be done: without a start
#: date there is nothing to measure elapsed time *from*, and time served is the
#: quantity that measurement would produce. The panel renders the list in it.
#:
#: TWO MEMBERS FOR TWO ROADS, NOT TWO PER ROAD. `_greek_reading` now reports the
#: right-hand road as well as the left, and the question of whether the just
#: soul's clock is a second unknown was asked and answered no. Republic X puts
#: both roads on *one* circuit: the souls are judged together, depart together
#: — right and upward, or left and downward (614c) — and meet again in the
#: meadow when the thousand years are up. So there is one moment the circuit
#: began and one quantity of it that has passed, and this ledger holds neither.
#: A parallel `REQUITAL_MISSING_INPUTS` would claim four absent facts where
#: there are two, and would give the two lists room to disagree about one gap.
#:
#: The names lean penal, and they are kept. `TERM_START` is the start of a fixed
#: term, which the circuit is for the just as much as for the unjust — nobody
#: comes back early. `TIME_SERVED` is the quantity of that term already gone
#: through, and "served" in that sense is what both roads are doing; only the
#: *content* of the thousand years differs, which is what `wrongs` and
#: `benefactions` are for. Renaming a stable wire identifier to soften a
#: connotation would cost three message bundles and buy no fact.
#:
#: BOTH MEMBERS OR NEITHER, AND THAT IS DERIVED RATHER THAN ASSUMED.
#: `Disposition.term_start` now exists, so the first of these two is a fact the
#: system can hold — and the obvious next question is whether TIME_SERVED
#: survives on its own once a start date is recorded. It does not, and the
#: reason is the one the "Order is the order of the arithmetic" paragraph above
#: already gives: TIME_SERVED is not a second stored fact sitting beside
#: TERM_START, it is *the quantity that measuring from TERM_START produces*.
#: Give the measurement its origin and it has both ends — the other end is
#: today — so the quantity follows immediately and there is nothing left to
#: report as missing. Hence `elapsed_missing` is either this whole tuple (no
#: start recorded) or empty (a start recorded), and never one member.
#:
#: It would have been just as easy to assume the opposite — drop TERM_START,
#: keep TIME_SERVED — and it would have been wrong: it would put on the wire a
#: claim that some *further* fact is still absent when the reading has just
#: computed the only thing that was.
#:
#: The tuple itself is unchanged. It is the description of the absent case, and
#: the absent case is still every disposition that has no term start recorded,
#: which is every row written before disposition/0011.
SENTENCE_MISSING_INPUTS = ("TERM_START", "TIME_SERVED")


def sentence_elapsed_years(term_start, today=None) -> int | None:
    """Whole years of a term already run, or None if it never started counting.

    `term_start` is a (year, month, day) triple — `Disposition.term_start_*` —
    or None. The other end of the measurement is today, because "how much of
    the term has been served" is a question asked from now: Republic X's souls
    are gathered back into the meadow when the thousand years are up, and until
    then the figure moves.

    `today` is an argument with a default rather than a bare `date.today()`
    call so that the arithmetic — the year-0 correction, the anniversary
    subtraction — can be asserted against fixed dates instead of against
    whatever day the suite happens to run on.

    FLOORED AT ZERO. A term start in the future is a data-entry mistake, and
    `whole_years_between` would answer it with a negative span. A negative
    quantity of time served is not a fact about any soul; 0 is, and it says the
    term has not begun to run. Reporting the negative instead would put a
    number on the wire whose only true reading is "this row is wrong", which is
    a validator's job (`apps.souls.dates.check_term_start`) and not this
    reading's.

    NOT CAPPED AT `GREEK_CIRCUIT_YEARS`. A soul whose term started 2637 years
    ago reports 2637, not 1000. Clamping would assert that the circuit ended
    and the soul came back, which is a fact about the disposition's execution
    and the soul's state — neither of which this ledger reading is looking at.
    """
    if term_start is None or term_start[0] is None:
        return None
    if today is None:
        today = datetime.date.today()
    span = whole_years_between(term_start, (today.year, today.month, today.day))
    return max(span, 0)


def _greek_reading(merit: int, demerit: int, merit_count: int,
                   demerit_count: int, class_totals: dict | None = None,
                   term_start: tuple | None = None) -> dict:
    """Two roads, one circuit — how much is owed on each, not what they net to.

    This is the one reading of the four whose verdict is not a quantity of
    deeds at all. Plato's souls are put on a *term*: each deed is repaid
    tenfold, the unit of repayment is a hundred-year period, and the circuit is
    a thousand years (Republic X, 615a-b). What decides where a soul stands is
    therefore how much of that term has elapsed, and elapsed time is a fact
    about the circuit rather than about the ledger. The deed counts below say
    what each of the two roads is repaying; they do not say how far along it is.

    WHY `wrongs` IS THE RECORD COUNT AND NOT THE DEMERIT TOTAL. Republic X
    counts deeds — "for all the wrongs they had ever done to anyone... they had
    paid the penalty in turn tenfold for each" — so the multiplier applies per
    wrong, not per unit of gravity. `weight` is this system's own severity
    scale; nothing in Plato grades wrongs by magnitude and then multiplies the
    magnitude, and reading the demerit *sum* here would silently convert a
    house scale into a term of years the source never authorises. The same
    discipline MAAT_FEATHER_WEIGHT is labelled with, in the other direction.

    WHY `benefactions` IS HERE, AND WHY IT IS NOT A SUBTRACTION. 614c sends the
    just to the right and upward and the unjust to the left and downward; 615b
    requites those who had done good "in the same measure" — the same tenfold,
    over the same thousand years. This reading used to take `demerit_count`
    alone, which modelled the left-hand road and left the right one unsayable:
    a soul who had done well got a reading in which nothing it had done well
    appeared. That was a defensible refusal only for as long as the alternative
    on offer was subtraction.

    It is not the alternative taken. `benefactions` sits beside `wrongs` as a
    second count, never netted against it and never multiplied out — the two
    roads are parallel repayments, and a difference or a sum of them is the
    Chinese account wearing a Greek name, which is the one thing this module
    exists to stop. This is also why the merit *sum* is still absent: the count
    is the unit both roads are reckoned in, and putting a magnitude beside a
    tally would file two different things under one heading. Republic X counts
    deeds on both sides or neither.

    WHY THAT IS NOT THE EGYPTIAN REASON, EITHER. In the Egyptian weighing merit
    is absent because there is no offsetting step at all — nothing a good deed
    could be reported *as*. Here there is: its own road, its own tenfold, and no
    arithmetic connecting it to the term owed.

    WHEN `elapsed_years` IS A NUMBER, AND WHEN IT IS STILL None. This used to
    be unconditionally None, on the ground that the ledger held no start date:
    SoulRecord records what was done in life and when, Soul has no such column,
    and deriving elapsed time from `death_year` would be inventing a start date
    for a term this system had never begun counting. That refusal stands
    exactly as written for every soul whose term start is still unrecorded —
    which is every disposition written before disposition/0011, and every one
    since where nobody has said when the term began.

    What changed is that there is now somewhere to say it.
    `Disposition.term_start` is an explicit column and NOT a re-reading of
    `executed_at`: when the office carried the paperwork out and when the soul
    began serving are two events, and the model's own comment argues why they
    could not share one column. When that date is present it is passed in here
    as `term_start`, and `sentence_elapsed_years` measures from it to today.
    The refusal was never to the arithmetic; it was to inventing the origin the
    arithmetic needs. Given the origin, the answer follows.

    So this field is None for one reason only — no term start recorded — and
    `elapsed_missing` carries SENTENCE_MISSING_INPUTS in exactly that case and
    is empty otherwise. The two travel together in both directions, which is
    what stops a client seeing a number beside a list of what is missing, or a
    bare null beside nothing. See the constant's own note for why both members
    come and go as a pair rather than TERM_START alone.

    That pair is reported once and covers both roads, and so is the number that
    replaces it. The two roads share a clock: one judgment starts them, one
    thousand years runs, one meadow ends it. One start date, one elapsed
    figure — two facts, not four.

    ELAPSED TIME IS NOT DRAWN FROM EITHER ROAD, and nothing here relates it to
    them. It is not a fraction of `circuit_years`, it is not multiplied by
    `repayment_multiple`, and it is not compared against a term length — this
    reading still computes no term length, because tenfold-per-deed is a rule
    Republic X states and not a total it sums. A soul can have served more
    years than the circuit is long and this reading will say so plainly rather
    than clamping it into a progress figure.
    """
    elapsed = sentence_elapsed_years(term_start)
    return {
        "kind": "SENTENCE",
        "civilization": Civilization.GREEK.value,
        # The left-hand road (614c). What the term is owed for: the number of
        # recorded wrongs.
        "wrongs": demerit_count,
        # The right-hand road. What is requited in the same measure: the number
        # of recorded good deeds. A count, like `wrongs`, and standing on its
        # own — nothing in this payload relates the two, because Republic X
        # relates them only by running them at the same time.
        "benefactions": merit_count,
        # One rule, both roads (615b). Not multiplied by either count here or
        # anywhere: tenfold repayment is what is owed per deed, not a total.
        "repayment_multiple": GREEK_REPAYMENT_MULTIPLE,
        "circuit_years": GREEK_CIRCUIT_YEARS,
        # One clock for both roads. A number when the term start is recorded,
        # None when it is not — never derived from anything else.
        "elapsed_years": elapsed,
        # Non-empty for exactly as long as `elapsed_years` is None, exactly as
        # `poena_missing` is for `poena`. An absence that does not say what is
        # missing is the bare null the list exists to avoid handing a client,
        # and a list of missing facts beside a computed number is the same
        # error in the other direction. So the two travel together in both
        # directions and test_readings.py pins the pair on both sides.
        "elapsed_missing": [] if elapsed is not None else list(SENTENCE_MISSING_INPUTS),
    }


CIVILIZATION_READING = {
    Civilization.CHINESE: _chinese_reading,
    Civilization.EGYPTIAN: _egyptian_reading,
    Civilization.EUROPEAN: _european_reading,
    Civilization.GREEK: _greek_reading,
}


#: Why a ledger got no reading, as a code rather than a sentence.
#:
#: One member today, and the tuple exists anyway. `reason_code` is the field a
#: client switches on, and it is the field the panel derives its two catalogue
#: keys from — `souls.detail.reading.unavailable_<code lowercased>_explanation`
#: and `..._cta` — so the set has to be enumerable from one place in order to be
#: checked against the three message bundles. That derivation is the point: the
#: keys used to be the flat `unavailable_explanation` / `unavailable_cta`, which
#: a second cause of UNAVAILABLE would have silently inherited and been
#: mis-described by. It is the `ledger.civ.UNKNOWN` failure `48a5e74` shipped —
#: a plausible string in the right place saying the wrong thing — and keying on
#: the code is what turns it into a visible miss.
REASON_TENANT_NOT_MAPPED = "TENANT_NOT_MAPPED"

UNAVAILABLE_REASON_CODES = (REASON_TENANT_NOT_MAPPED,)


def get_civilization_reading(civilization: str, merit: int, demerit: int,
                             merit_count: int, demerit_count: int,
                             class_totals: dict | None = None,
                             term_start: tuple | None = None) -> dict:
    """The reading this soul's cosmology uses, or an explicit refusal.

    Every builder takes the same five arguments and each one ignores some of
    them on purpose rather than not being offered them. Only the Chinese
    builder uses `class_totals`: merit does not enter an Egyptian weighing at
    all and does not reduce European culpa, so a per-class split of merit has
    nothing to say there. Only the European and Greek builders use a record
    count, and only the Greek one uses `merit_count` — a uniform signature is
    what keeps each of those a stated decision, argued in the builder's own
    docstring, instead of a missing argument nobody had to defend.

    `term_start` is the newest, and it was added the same way and at the same
    cost: four builders widened to serve one. That cost is the shape's, and it
    is paid on purpose. The alternative — handing the Greek builder an argument
    the others do not take — is a table of callables that cannot be called
    uniformly, i.e. the if/elif chain this dict replaced. `merit_count` before
    it made the same trade, and the same three docstrings say in their own
    words why each ignores what it is given: 功過格 imposes no term, the
    Egyptian weighing is not an interval, and poena's three missing quantities
    are not a date.

    `term_start` is a (year, month, day) triple from `Disposition.term_start_*`
    or None — the caller's job is to find the right disposition, not this
    module's. `LedgerService.get_ledger_summary` supplies it; every other
    caller passes nothing and gets the reading unchanged from before the column
    existed, which is what keeps this a widening rather than a break.

    `civilization` may be UNKNOWN_CIVILIZATION — a real value the API returns
    for a soul whose tenant code is not in TENANT_CIVILIZATION. It gets no
    reading at all, and that is the point. Falling through to the Chinese
    balance is the exact fail-open that was just removed from
    `Soul.civilization`, where an unrecognised tenant silently meant Diyu and
    therefore silently meant reborn. A ledger has no interpretation until
    someone says whose ledger it is, so an unconfigured tenant gets a refusal
    with a reason code, not somebody else's arithmetic.

    `merit`, `demerit` and the top-level `karmic_balance` are still in the
    payload for these souls. They are raw sums, true of any ledger and
    committing to no cosmology; it is the *reading* that would be a claim.
    """
    builder = CIVILIZATION_READING.get(civilization)
    if builder is None:
        return {
            "kind": "UNAVAILABLE",
            "civilization": str(civilization),
            # A state, not a sentence. The remedy — configure the tenant's
            # civilization mapping — is not a second field: it is what
            # TENANT_NOT_MAPPED *means*, and emitting it separately would be
            # two wire names for one fact, which is exactly how the
            # `inheritance_note` prose and the frontend's hard-coded 20/100
            # got to disagree. The imperative half is copy, and the panel owns
            # it as `unavailable_tenant_not_mapped_cta`.
            "reason_code": REASON_TENANT_NOT_MAPPED,
        }
    return builder(merit, demerit, merit_count, demerit_count, class_totals, term_start)
