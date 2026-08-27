"""GREEK — GORGIAS. TRANSCRIBED here, from Plato's Gorgias 523a-526d.

The FIRST Greek corpus, and the fifth transcribed one. Its companion is
``statutes_republic.py``; the two are separate for the same reason
``statutes_european.py`` and ``statutes_inferno.py`` are, and the reason is
stated in full there.

WHY THIS CORPUS EXISTS AT ALL. GREEK was the only civilization in this system
with no corpus — not an empty one, no entry. HELL_LAW is empty and says so:
``CORPUS_PROVENANCE`` declares it ABSENT, its emptiness is a finding, and
tests/test_corpus_provenance.py holds the finding in place. GREEK had no such
declaration, and could not have had one, because the guard iterated
``StatuteCorpus`` members — so a civilization that appears in no corpus at all
is invisible to a check that walks corpora. That guard now walks civilizations.

WHAT AN ARTICLE IS HERE, AND WHY IT IS A NEW KIND. The four older corpora share
one property: THE SOURCE ITSELF ENUMERATES. 《太微仙君功過格》 numbers 73
articles and prices each. The Book of the Dead gives 42 assessors, one denial
apiece. Purgatorio climbs seven terraces and the Inferno descends nine circles.
Neither Platonic myth enumerates anything. So the honest question — the one
HELL_LAW was withdrawn for never asking — is what a Greek article could be, and
the answer is NOT a list of offences, because Plato does not give one.

What Gorgias 523a-526d gives is a COURT: a reform, a bench, a venue, a rule of
evidence, a purpose of punishment, and a two-way sentence. Every article below
is a rule that myth states about how the dead are tried. That is why the
polarity of nearly all of them is PROCEDURE, a fourth value added with this
corpus — see ``StatutePolarity``, whose three older members all answer "does
citing this count for the soul or against it" and none of which can say
"neither: it says how the court proceeds".

A ledger with no offence articles is not a defect here. It is what the source
is. Filing Plato's myth as a table of sins would be the HELL_LAW mistake with
Greek names on it: a plausible chart, correct-looking prose, and no document
behind it.

WHAT THIS DOES NOT DO. It does not route anything, and GR-GRG-06 in particular
must not be mistaken for an input. `_route_greek` already implements the fork
that article transcribes, and it reads the verdict and nothing else; the
article is what a judge cites when writing down WHY the fork has two roads and
not ten. The Inferno corpus carries the same warning and it did not hold —
`_deepest_cited_circle` later made `payload["circle"]` live — so the warning is
repeated here with the specific reason: Plato's fork has no severity dimension
to read (see `_route_greek` §WHY THERE IS NO SEVERITY INPUT), and giving one an
article number would not create it.

TEXT AND SOURCE ARE NOT THE SAME QUESTION HERE.

  * The TRANSCRIBED English is Jowett (Gutenberg #1672), public domain, which
    is this repository's existing practice for a versified or dialogic source —
    Longfellow 1867 for the Commedia, Evelyn-White 1914 for Hesiod.
  * The STEPHANUS SECTIONS are not Jowett's. His prose is continuous and
    carries no inline numbers, so every citation below was located against the
    Perseus canonical-greekLit XML of the Gorgias (tlg0059.tlg023), whose
    ``<milestone unit="section">`` markers place them exactly. Lamb's WORDS are
    not reproduced here. A section number is a fact about where a passage sits;
    a translation is an expression, and the two need different permissions.

    WHICH FILE, AND WHY IT TURNS OUT NOT TO MATTER. This used to say "the
    Perseus canonical XML of the Loeb Gorgias", which welds two things that
    are not the same file: the canonical GREEK text (perseus-grc2) is Burnet's
    Oxford Classical Text, Clarendon 1903, and Lamb's Loeb 1925 is the English
    file (perseus-eng2) beside it. Which of the two was open when these
    citations were placed is not recorded anywhere and cannot now be
    established — but it does not bear on the numbers: both files carry 404
    ``unit="section"`` milestones and the two sequences are identical item for
    item (verified 2026-08-27). The version attribution was wrong; no section
    number depends on it.

  Both are recorded on every row, because "which translation" and "which
  numbering" are the two questions a later reader of a citation will ask.
"""

GORGIAS_SOURCE = (
    "Plato, Gorgias 523a-526d — the myth of the judgement, in Benjamin "
    "Jowett's translation (Project Gutenberg #1672, public domain). Stephanus "
    "sections located against the Perseus canonical-greekLit XML "
    "(tlg0059.tlg023; Burnet's Greek, Clarendon 1903, and Lamb's Loeb "
    "translation, 1925, carry identical section milestones); Lamb's wording "
    "is not reproduced."
)

from apps.actors.mythology.statutes_gorgias_entries import (  # noqa: F401
    GORGIAS_STATUTES,
)
