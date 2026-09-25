"""Edge conditions: a declarative structure over a whitelisted set of case facts.

A branch on a node is ``{"id", "when": [clause, ...], "target"}``; a clause is
``{"fact", "op", "value"}``. The branch is taken on PASS when **every** clause
holds. There is no expression language: no string is parsed, nothing is
evaluated with ``eval`` or anything like it. The only operations are the
comparisons spelled out in ``_holds`` below, over the facts in ``FACTS``.

    fact          kind     ops                      value
    balance       integer  lt lte gt gte eq         an integer   (功过余额 = merit − demerit)
    civilization  enum     in not_in                a list of Civilization members
    verdict       enum     in not_in                a list of judgment Verdict members

Because the set is this small, the questions the publish validator has to ask —
"can this branch ever be taken?" and "can two branches both be taken?" — have
exact answers, computed in ``region`` / ``overlaps``: every conjunction of these
clauses is a box (an integer interval × a subset per enum), and two boxes
intersect or they do not. That exactness is the reason to keep the set small;
a fact that cannot be reduced to an interval or a finite set does not belong
here.
"""
from __future__ import annotations

import math

NUMBER_OPS = ("lt", "lte", "gt", "gte", "eq")
ENUM_OPS = ("in", "not_in")


def _civilizations() -> tuple[str, ...]:
    from apps.souls.models import Civilization

    return tuple(Civilization.values)


def _verdicts() -> tuple[str, ...]:
    from apps.judgment.models import Verdict

    return tuple(Verdict.values)


#: fact -> (kind, allowed values for an enum fact)
FACTS = {
    "balance": ("number", None),
    "civilization": ("enum", _civilizations),
    "verdict": ("enum", _verdicts),
}


def clause_error(clause) -> str | None:
    """Why `clause` is not a well-formed clause, or None."""
    if not isinstance(clause, dict):
        return "not_a_clause"
    fact, op, value = clause.get("fact"), clause.get("op"), clause.get("value")
    if fact not in FACTS:
        return "unknown_fact"
    kind, universe = FACTS[fact]
    if kind == "number":
        if op not in NUMBER_OPS:
            return "bad_op"
        if isinstance(value, bool) or not isinstance(value, int):
            return "bad_value"
        return None
    if op not in ENUM_OPS:
        return "bad_op"
    if not isinstance(value, list) or not value or not all(isinstance(v, str) for v in value):
        return "bad_value"
    if any(v not in universe() for v in value):
        return "bad_value"
    return None


def case_facts(workflow) -> dict:
    """The facts a condition may read, for one workflow. Read at decision time."""
    soul = workflow.soul
    judgment = workflow.judgment
    return {
        "balance": soul.karmic_balance,
        "civilization": soul.civilization,
        "verdict": judgment.verdict if judgment is not None else None,
    }


def _holds(clause: dict, facts: dict) -> bool:
    actual = facts.get(clause["fact"])
    if actual is None:
        # A fact the case does not have (no judgment -> no verdict) satisfies
        # no clause, `not_in` included: "unknown" is not "not one of these".
        return False
    op, value = clause["op"], clause["value"]
    if op == "lt":
        return actual < value
    if op == "lte":
        return actual <= value
    if op == "gt":
        return actual > value
    if op == "gte":
        return actual >= value
    if op == "eq":
        return actual == value
    if op == "in":
        return actual in value
    if op == "not_in":
        return actual not in value
    return False


def matches(when: list, facts: dict) -> bool:
    """True when every clause holds. An empty or malformed set never matches:
    the validator refuses both, and an unvalidated row must fail closed."""
    if not when:
        return False
    return all(clause_error(c) is None and _holds(c, facts) for c in when)


# ── static analysis: every clause set is a box ──────────────────────────


def _clause_box(clause: dict):
    fact, op, value = clause["fact"], clause["op"], clause["value"]
    kind, universe = FACTS[fact]
    if kind == "number":
        lo, hi = -math.inf, math.inf
        if op == "lt":
            hi = value - 1
        elif op == "lte":
            hi = value
        elif op == "gt":
            lo = value + 1
        elif op == "gte":
            lo = value
        elif op == "eq":
            lo = hi = value
        return (lo, hi)
    allowed = set(value) if op == "in" else set(universe()) - set(value)
    return frozenset(allowed)


def _meet(a, b):
    if isinstance(a, tuple):
        return (max(a[0], b[0]), min(a[1], b[1]))
    return a & b


def _empty(box) -> bool:
    if isinstance(box, tuple):
        return box[0] > box[1]
    return not box


def region(when: list) -> dict | None:
    """The box `when` describes, as {fact: interval | set}; None when empty.

    Integer intervals, because `balance` is an integer: `< 0` is `≤ -1`, so
    `balance < 0` and `balance > -1` are correctly found disjoint.
    """
    box: dict = {}
    for clause in when:
        c = _clause_box(clause)
        box[clause["fact"]] = _meet(box[clause["fact"]], c) if clause["fact"] in box else c
        if _empty(box[clause["fact"]]):
            return None
    return box


def overlaps(a: dict, b: dict) -> bool:
    """Can one case satisfy both boxes? A fact absent from a box is unconstrained."""
    return all(not _empty(_meet(a[fact], b[fact])) for fact in set(a) & set(b))
