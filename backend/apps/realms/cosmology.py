"""One place that says which rules make up a civilization (expert design 2026-11-14, be-domain §3.3).

The four cosmologies used to differ by `if civilization == …` chains spread over ~26 files; adding a fifth
meant finding all of them. `COSMOLOGY` is the registry those chains move into, keyed by `Civilization`, in
the shape `apps.ledger.readings.CIVILIZATION_READING` already had. Not a rule engine: every rule stays in
code beside its source citation; this module only says which rule a civilization uses.

Registered so far (the rest of the chains are listed, with counts, in
`tests/test_civilization_branches_only_go_down.py`, which lets the number only go down):

  * `rebirth_capable` — whether a soul of this cosmology has a next life
    (`apps.ledger.constants.REBIRTH_CAPABLE_CIVILIZATIONS` is derived from it).
  * `outcome` — verdict → REHEAR / ACQUIT_TO_REBIRTH / DESTINATION
    (`apps.judgment.models.hears_again` / `acquitted_to_rebirth` read it).
  * `reading` — the ledger reading builder (`CIVILIZATION_READING` is derived from it).
  * `route` — the automatic router for a concluded case (`DispositionService._route_to_realm`).
  * `shape` — the dossier spine's shape. Registered, read by nothing yet; the four names
    (line / funnel / scale / fork) wait on the design system's confirmation (be-domain §5).

An unregistered civilization (UNKNOWN_CIVILIZATION, a tenant with no mapping) has no entry. Callers keep
their own answer for it, as they did: no reading, no realm, no rebirth, and every undecided verdict reheard.

Home: `apps.realms`, the cosmology's reference data (be-domain §2), not `apps.core` — core is the platform
and does not import the domain, and a change under `apps/core/` runs the whole backend suite. This module
imports only `Civilization`, so `apps.judgment.models` can import it at top level; what lives in apps that
import judgment (the routers, the reading builders) is resolved on first call (`_deferred`).
"""
from dataclasses import dataclass
from functools import partial
from importlib import import_module
from typing import Callable

from apps.souls.models import Civilization

REHEAR = "REHEAR"
ACQUIT_TO_REBIRTH = "ACQUIT_TO_REBIRTH"
DESTINATION = "DESTINATION"


def _deferred(module: str, name: str) -> Callable:
    """`module.name` (a dotted attribute path), looked up when called. `apps.disposition.services` imports
    `apps.judgment.models`, which imports this module, so the router cannot be imported here."""

    def call(*args, **kwargs):
        target = import_module(module)
        for part in name.split("."):
            target = getattr(target, part)
        return target(*args, **kwargs)

    call.__name__ = call.__qualname__ = f"{module}.{name}"
    return call


def _outcome(verdict, *, purgatory_rehears: bool, passed_acquits: bool) -> str:
    """What a verdict is under one cosmology. Strings, not `Verdict`: `apps.judgment.models` imports this.

    RETRY is a rehearing everywhere. PURGATORY is one where it is not a place (Diyu's waiting court, the
    Egyptian scale that did not settle) and a destination where it is (Dante's purgatory, Plato's Asphodel).
    A Diyu acquittal goes straight to rebirth. The reasons, with sources: `hears_again` / `acquitted_to_rebirth`."""
    if verdict == "RETRY" or (purgatory_rehears and verdict == "PURGATORY"):
        return REHEAR
    if passed_acquits and verdict == "PASSED":
        return ACQUIT_TO_REBIRTH
    return DESTINATION


@dataclass(frozen=True)
class CosmologyPolicy:
    civilization: str
    shape: str
    rebirth_capable: bool
    outcome: Callable[[str], str]
    reading: Callable[..., dict]
    route: Callable[..., str]


def _policy(civilization, *, shape, rebirth_capable, purgatory_rehears, passed_acquits, name) -> CosmologyPolicy:
    return CosmologyPolicy(
        civilization=civilization,
        shape=shape,
        rebirth_capable=rebirth_capable,
        outcome=partial(_outcome, purgatory_rehears=purgatory_rehears, passed_acquits=passed_acquits),
        reading=_deferred("apps.ledger.readings", f"_{name}_reading"),
        route=_deferred("apps.disposition.services", f"DispositionService._route_case_{name}"),
    )


COSMOLOGY: dict[str, CosmologyPolicy] = {
    Civilization.CHINESE: _policy(Civilization.CHINESE, shape="line", rebirth_capable=True,
                                  purgatory_rehears=True, passed_acquits=True, name="chinese"),
    Civilization.EUROPEAN: _policy(Civilization.EUROPEAN, shape="funnel", rebirth_capable=False,
                                   purgatory_rehears=False, passed_acquits=False, name="european"),
    Civilization.EGYPTIAN: _policy(Civilization.EGYPTIAN, shape="scale", rebirth_capable=False,
                                   purgatory_rehears=True, passed_acquits=False, name="egyptian"),
    Civilization.GREEK: _policy(Civilization.GREEK, shape="fork", rebirth_capable=True,
                                purgatory_rehears=False, passed_acquits=False, name="greek"),
}

#: The outcome for a civilization with no entry: unchanged from before the registry — an undecided verdict
#: (RETRY, PURGATORY) is reheard, nothing is acquitted to rebirth.
UNREGISTERED_OUTCOME = partial(_outcome, purgatory_rehears=True, passed_acquits=False)


def outcome_of(civilization, verdict) -> str:
    policy = COSMOLOGY.get(civilization)
    return (policy.outcome if policy is not None else UNREGISTERED_OUTCOME)(verdict)
