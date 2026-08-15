"""EGYPTIAN — NEGATIVE_CONFESSION. DERIVED, not transcribed. No text here.

This module is two constants long, and that is the finding rather than an
omission. The 42 clauses live on the assessor rows in ``actors_egyptian.py``
as ``powers_json['negative_confession']``; ``_seed_derived_statutes`` builds
a citation row that POINTS AT each assessor, and ``Statute.derived_text``
reads the clause back at display time. Pasting the clauses in here would
make this file the second author of a text it does not own.

See the provenance contract in ``apps.actors.mythology``.

Moved verbatim out of ``seed_mythology.py``.

Cross-references in the comments below ("above", "below", "this file") were
written when every table in this package was one module; see the package
docstring in ``apps/actors/mythology/__init__.py``. Every table they name is
importable from that package.
"""

# What the Egyptian derivation reads off each assessor, and where it files the
# result. `NEGATIVE_CONFESSION_FIELD` is stored on every derived row
# (`Statute.source_actor_field`) rather than hardcoded in the model, so the
# derivation is legible from the data itself.
NEGATIVE_CONFESSION_FIELD = "negative_confession"
NEGATIVE_CONFESSION_SOURCE = (
    "Derived from the assessor actor seeded by this same command — the clause "
    "lives on Actor.powers_json['negative_confession'] and is read from there, "
    "never copied. Edition and papyrus are recorded on that row."
)
