"""
The four cosmologies and which tenant speaks for each.

Lives in core because the sharding foundation (`core.sharding`, `core.tenant`,
`core.shard_sync`) and `realms` / `tenants` need it to know what a shard is;
`apps.souls.models` re-exports every name here.
"""
from django.db import models


class Civilization(models.TextChoices):
    CHINESE = "CHINESE", "Chinese Diyu"
    EUROPEAN = "EUROPEAN", "European Heaven/Hell"
    EGYPTIAN = "EGYPTIAN", "Egyptian Duat"
    # GREEK IS A FOURTH COSMOLOGY, NOT A REGION OF THE EUROPEAN ONE.
    #
    # It used to be filed under EUROPEAN, and that was never a claim anybody
    # checked: Hades, Aeacus and Rhadamanthus stood in GR_PLATO_MEADOW — Plato's
    # fork in the road, Gorgias 524a — while carrying the civilization of a
    # tenant whose other rows are the Nicene Creed's judgment and Dante's nine
    # circles. The two systems answer different questions with different
    # instruments: Dante's judgment is *poena* after *culpa* is forgiven, and
    # Plato's is a fixed term served (Republic X, 615a-b). One enum member
    # cannot carry both, and while it did, the Greek rows were reachable only
    # through the European tenant and inherited European routing, European
    # case types and the European ledger reading by default.
    #
    # WHAT DELIBERATELY DID NOT MOVE. Minos, Cerberus and Charon stay EUROPEAN,
    # because their text anchor in this repository is Dante and not the Greeks:
    # Minos allots the circle at the entrance to the second (Inf. V.4-15),
    # Cerberus stands over the gluttons in the third (Inf. VI), Charon works
    # Acheron at the gate of hell (Inf. III). Plato's Minos is a *separate row*
    # under GREEK — the two are different offices in different underworlds
    # (Gorg. 524a's final arbiter at the fork vs the coiling tail of Inf. V),
    # which is what the actor row itself has said all along.
    GREEK = "GREEK", "Greek Underworld"


# The one place tenant codes and cosmologies meet. A tenant is an
# administrative record; a civilization is a claim about what happens to the
# dead. Which tenant speaks for which cosmology is a fact about this
# deployment's configuration, so it is written down once, here, rather than
# re-derived at each call site.
TENANT_CIVILIZATION = {
    "CN_DIYU": Civilization.CHINESE,
    "EU_HEAVEN_HELL": Civilization.EUROPEAN,
    "EG_DUAT": Civilization.EGYPTIAN,
    # GREEK NEEDS ITS OWN TENANT OR IT CAN NEVER HOLD A SOUL.
    #
    # `Soul.civilization` is derived from the soul's tenant through this map and
    # from nothing else (see the property below). A GREEK enum member with no
    # tenant code pointing at it would therefore be unreachable by construction:
    # no soul could ever read GREEK, so its routing branch, its ledger reading
    # and its workflow templates would all be dead code that no test could
    # distinguish from working code.
    "GR_HADES": Civilization.GREEK,
}

# The same fact read backwards: which tenant speaks for a given cosmology.
# Derived rather than written out a second time, because the copies are what
# went wrong — this mapping existed in three more places (the Soul filterset,
# the multitenant backfill command, the seed script), each free to drift from
# the one above and from each other, and one of them defaulted an unrecognised
# civilization to the Chinese tenant. Callers that need this direction (a
# filter turning ?civilization=EGYPTIAN into a tenant lookup, a seeder deciding
# where a row belongs) import it instead of writing their own.
#
# Inverting assumes one tenant per cosmology, which is what this deployment
# configures. A second CHINESE tenant would silently lose to whichever came
# last in TENANT_CIVILIZATION — a reason to revisit the shape of both maps if
# that ever becomes a real configuration, not a reason to keep hand-written
# copies around.
CIVILIZATION_TENANT = {
    civilization: code for code, civilization in TENANT_CIVILIZATION.items()
}

# What a soul's cosmology is when nothing in the configuration says.
#
# This used to be Civilization.CHINESE — an unrecognised tenant code fell
# through to the first entry in the map. That was never a decision anyone
# made, it was the default argument of a dict lookup showing through, and it
# had a consequence nobody chose either: Chinese Diyu was then the one
# rebirth-capable cosmology modelled here (Greek has since joined it), so
# *unknown* silently meant *reborn*. A soul in a
# misconfigured or freshly created tenant was handed a next life on the
# strength of a typo. Guessing wrong about a cosmology is not a cosmetic error
# — it decides whether a soul is annihilated, admitted, or sent round again.
#
# Deliberately NOT a member of the Civilization TextChoices above. Two reasons,
# and the second is the load-bearing one:
#
#   1. "Unknown" is not a civilization. No one worships in it and nothing
#      happens to you there. It is the absence of an answer, and giving it a
#      seat alongside Diyu and the Duat would make the absence look like one
#      more afterlife on the list — in every dropdown, filter, and chart legend
#      that renders Civilization.choices.
#   2. Civilization.choices is the `choices=` argument of model fields in five
#      apps (actors, judgment, realms, workflow, souls). Adding a member
#      rewrites all five field definitions and demands an AlterField migration
#      in each — a schema change across the codebase to express "we don't
#      know", which is a large blast radius for a value no row should ever
#      legitimately store.
#
# Being a plain str keeps it safe everywhere a civilization is read as text
# (serializers, event payloads, __str__, CSV export) while failing every
# `== Civilization.X` and every `in REBIRTH_CAPABLE_CIVILIZATIONS` membership
# test — which is exactly the behaviour wanted. Unknown must not be quietly
# routed anywhere; it must fall to whatever each caller does when it does not
# recognise a cosmology.
UNKNOWN_CIVILIZATION = "UNKNOWN"
