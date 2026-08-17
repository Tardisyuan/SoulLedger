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
    repaid tenfold (Republic X, 615a-b). Elapsed time, not a balance. It is not
    in the Civilization enum yet and must not be added here first.

So four cosmologies want four differently-shaped answers: a balance, a
comparison, two unrelated numbers, and a duration. Serving all of them one
shape built around a net total does not simplify the model, it silently applies
the Chinese one to everybody — and it is not harmless. Run against real data, a
net balance passes an Egyptian soul on a mechanic his tradition does not have.

Held as a dict of builders rather than an if/elif chain for the same reason
REBIRTH_CAPABLE_CIVILIZATIONS in services.py is a frozenset: adding GREEK
should be one entry, next to the others, where it is obvious that a fourth
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

TODO(i18n): the prose in `poena_unavailable` and `reason` below is user-facing
copy hard-coded in a service module, which is the wrong place for it — see the
same TODO on TERMINAL_COSMOLOGY_REASON in services.py. A later pass owns the
copy.
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
    absolution has occurred (nothing records contrition or confession), how much
    satisfaction is owed for a forgiven sin (weight measures the gravity of the
    deed, which is culpa, and Dante's terraces are not sorted by it), and how
    much penance has already been performed (there is no record type for an act
    of expiation — MERIT is a good deed done in life, not satisfaction rendered
    after death). Deriving poena from the demerit total would just be culpa
    printed twice under a second heading, which is precisely the collapse this
    reading exists to stop making.
    """
    return {
        "kind": "GUILT_AND_PENALTY",
        "civilization": Civilization.EUROPEAN.value,
        "culpa": demerit,
        "culpa_record_count": demerit_count,
        "poena": None,
        "poena_unavailable": (
            "Poena is what remains after culpa is absolved. Nothing in this "
            "ledger records absolution, satisfaction owed, or penance "
            "performed, so there is no honest number to report here."
        ),
    }


CIVILIZATION_READING = {
    Civilization.CHINESE: _chinese_reading,
    Civilization.EGYPTIAN: _egyptian_reading,
    Civilization.EUROPEAN: _european_reading,
}


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
    with a reason, not somebody else's arithmetic.

    `merit`, `demerit` and the top-level `karmic_balance` are still in the
    payload for these souls. They are raw sums, true of any ledger and
    committing to no cosmology; it is the *reading* that would be a claim.
    """
    builder = CIVILIZATION_READING.get(civilization)
    if builder is None:
        return {
            "kind": "UNAVAILABLE",
            "civilization": str(civilization),
            "reason": (
                "This soul's tenant is not mapped to a cosmology, so there is "
                "no rule for what its ledger means. Configure the tenant."
            ),
        }
    return builder(merit, demerit, demerit_count, class_totals)
