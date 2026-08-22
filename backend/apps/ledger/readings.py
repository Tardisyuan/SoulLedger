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
  * GREEK, when it lands, is a sentence served — Plato's thousand-year circuit,
    repaid tenfold (Republic X, 615a-b). Elapsed time, not a balance. It has
    landed: `Civilization.GREEK` exists, `GR_HADES` is its tenant, and
    `_greek_reading` below is the fourth entry. The sentence this bullet used to
    end with — "not in the Civilization enum yet and must not be added here
    first" — was about the *order* of one change, not a prohibition on ever
    making it: the enum member has to exist before a key can name it, and
    `apps/ledger/test_readings.py` requires the two to match, so both halves
    land together or the suite is red in between.

So four cosmologies want four differently-shaped answers: a balance, a
comparison, two unrelated numbers, and a duration. Serving all of them one
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

RESOLVED(i18n): the two English sentences that used to sit in this module —
`poena_unavailable` in `_european_reading` and `reason` in
`get_civilization_reading` — are gone. `poena_missing` and `reason_code`
replaced them.

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
from apps.ledger.fungibility import offset_within_classes
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


def _chinese_reading(merit: int, demerit: int, demerit_count: int,
                     class_totals: dict | None = None) -> dict:
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


def _egyptian_reading(merit: int, demerit: int, demerit_count: int,
                      class_totals: dict | None = None) -> dict:
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


def _european_reading(merit: int, demerit: int, demerit_count: int,
                      class_totals: dict | None = None) -> dict:
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
GREEK_REPAYMENT_MULTIPLE = 10
GREEK_CIRCUIT_YEARS = 100 * GREEK_REPAYMENT_MULTIPLE


def _greek_reading(merit: int, demerit: int, demerit_count: int,
                   class_totals: dict | None = None) -> dict:
    """A sentence, measured in time — how much is owed, not how much is left.

    This is the one reading of the four whose unit is not a quantity of deeds
    at all. Plato's souls are sentenced to a *term*: each wrong is repaid
    tenfold, the unit of repayment is a hundred-year period, and the circuit is
    a thousand years (Republic X, 615a-b). What decides where a soul stands is
    therefore how much of that term has elapsed, and elapsed time is a fact
    about the sentence rather than about the ledger.

    WHY `wrongs` IS THE RECORD COUNT AND NOT THE DEMERIT TOTAL. Republic X
    counts deeds — "for all the wrongs they had ever done to anyone... they had
    paid the penalty in turn tenfold for each" — so the multiplier applies per
    wrong, not per unit of gravity. `weight` is this system's own severity
    scale; nothing in Plato grades wrongs by magnitude and then multiplies the
    magnitude, and reading the demerit *sum* here would silently convert a
    house scale into a term of years the source never authorises. The same
    discipline MAAT_FEATHER_WEIGHT is labelled with, in the other direction.

    WHY MERIT IS ABSENT, AND WHY THAT IS NOT THE EGYPTIAN REASON. In the
    Egyptian weighing merit is absent because there is no offsetting step at
    all. Here good deeds do count — 615b requites well-doing "in the same
    measure" — but on their *own* clock, on the road to the right, and never as
    a subtraction from the term owed on the road to the left. Two tenfold
    repayments running in parallel is not a net balance, and printing one would
    rebuild the Chinese account under a Greek name. The record count of merits
    is not in this function's signature either, so reporting the merit *sum*
    beside a wrongs *count* would put two different units under one heading.

    WHY `elapsed_years` IS None. The same shape as `poena` in the European
    reading, and for the same kind of reason: this is not a lookup nobody has
    written, it is data the ledger does not hold. SoulRecord records what was
    done in life and when; nothing records when a sentence began or how much of
    it has been served, and Soul has no such column. Deriving elapsed time from
    `death_year` would be inventing a start date for a term this system has
    never actually begun counting.
    """
    return {
        "kind": "SENTENCE",
        "civilization": Civilization.GREEK.value,
        # What the term is owed for: the number of recorded wrongs.
        "wrongs": demerit_count,
        "repayment_multiple": GREEK_REPAYMENT_MULTIPLE,
        "circuit_years": GREEK_CIRCUIT_YEARS,
        "elapsed_years": None,
        "elapsed_unavailable": (
            "Plato's sentence is a term served, so what decides a soul's "
            "standing is how much of the thousand-year circuit has elapsed. "
            "Nothing in this ledger records when the term began or how much of "
            "it has been served, so there is no honest number to report here."
        ),
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
                             demerit_count: int,
                             class_totals: dict | None = None) -> dict:
    """The reading this soul's cosmology uses, or an explicit refusal.

    Every builder takes `class_totals`; only the Chinese one uses it, and the
    other two ignore it on purpose rather than not being offered it. Merit does
    not enter an Egyptian weighing at all and does not reduce European culpa, so
    a per-class split of merit has nothing to say there — the uniform signature
    is what keeps that a stated decision instead of a missing argument.

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
    return builder(merit, demerit, demerit_count, class_totals)
