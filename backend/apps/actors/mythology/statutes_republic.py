"""GREEK — REPUBLIC_ER. TRANSCRIBED here, from Plato's Republic X 614b-621b.

The SECOND Greek corpus. Its companion is ``statutes_gorgias.py``, and the
argument for what a Greek article is at all — that neither Platonic myth
enumerates, that the unit here is a rule of the court rather than an offence,
and why the polarity PROCEDURE had to exist — is made there and not repeated.

WHY A SECOND GREEK CORPUS AND NOT MORE ARTICLES IN THE FIRST. Because these are
two eschatologies and joining them describes neither.

  * Gorgias ENDS. A soul is stamped, sent to Tartarus or to the Isles, and the
    myth stops. There is no return, no term, and no arithmetic anywhere in it.
  * Republic X CIRCULATES. The sentence has a length (a thousand years), a
    rate (tenfold), a unit (a hundred years), and an exit: the soul comes back
    to the meadow, chooses a next life, drinks at the river and is born again.

Merge them and a soul is both sentenced terminally and required to return. That
is exactly the failure ``docs/lore-verification/verify-christian-structure.md``
found on the European side — the seven capital sins laid over the nine circles
produce a chart that exists nowhere in Dante — and the repair there was a
corpus per structure, with neither citing the other. Same repair here.

THE KINSHIP IS REAL AND THAT IS WHY IT NEEDS SAYING. Shorey's apparatus to the
Loeb Republic cross-refers Gorg. 524a at the place of judgement and at the
meadow (614c, 614e), Gorg. 525c at the incurably wicked (615e), and Gorg.
525d-526a at the tyrants (615d). The two myths are about the same subject by
the same author and share vocabulary. They still do not share a structure, and
a corpus is a structure.

THIS ONE IS ALREADY LOAD-BEARING, WHICH THE OTHER IS NOT. Three modules cite
Republic X in prose today:

  * ``apps/ledger/services.py`` — `_greek_reading` COUNTS WRONGS rather than
    summing weights, "Republic X 615a-b repays tenfold per deed done", and
    refuses 功過相抵 for this cosmology by name.
  * ``apps/disposition/services.py`` — the thousand-year circuit, and
    `is_eternal=False` on the Greek destinations.
  * ``apps/disposition/models.py`` — which declines to invent a number for a
    term because "Republic X's thousand years belong to" that text.

Those are correct readings and GR-ER-03 / GR-ER-05 are the articles behind
them. They were sentences in comments; now they are rows a judgment can cite.
WHAT THAT DOES NOT MEAN is that the rows became inputs. `_greek_reading` reads
records, not statutes, and nothing here changes what it computes.

WHERE THE SOURCE ITSELF STOPS. Two of these articles record a rule Plato says
exists and declines to state (GR-ER-06). Those gaps are the author's, not the
transcriber's, and they are marked `transcription_gap` and left open — the same
treatment 救濟門's missing article gets in GONGGUOGE and the Antinferno gets in
INFERNO. Filling them is how the withdrawn HELL_LAW corpus was written.

TEXT AND SOURCE. The transcribed English is Jowett (Gutenberg #1497), public
domain. Stephanus sections were located against the Perseus canonical-greekLit
XML of the Republic (tlg0059.tlg030), whose ``<milestone unit="section">``
markers place them exactly; Shorey's wording is NOT reproduced here, and
unlike Lamb's Gorgias his Republic volume ii is 1935 and not in the public
domain. A section number is a fact about where a passage sits. A translation
is an expression.

This used to say "the Perseus canonical XML of the Loeb Republic", and the
Gorgias module carried the same conflation; see its docstring for the full
account. In short: the canonical GREEK file (perseus-grc2) is Burnet,
Clarendon 1905, and Shorey's Loeb 1935-37 is the English file beside it. Both
carry 1355 ``unit="section"`` milestones in an identical sequence (verified
2026-08-27), so the attribution was wrong and no section number depends on it.
The COPYRIGHT half of the paragraph is unaffected and still holds: Shorey's
volume ii is 1935, which is why only his section numbers are used here and
never his words.
"""

REPUBLIC_ER_SOURCE = (
    "Plato, Republic X 614b-621b — the myth of Er, in Benjamin Jowett's "
    "translation (Project Gutenberg #1497, public domain). Stephanus sections "
    "located against the Perseus canonical-greekLit XML (tlg0059.tlg030; "
    "Burnet's Greek, Clarendon 1905, and Shorey's Loeb translation, 1935-37, "
    "carry identical section milestones); Shorey's wording is not "
    "reproduced."
)

from apps.actors.mythology.statutes_republic_entries import (  # noqa: F401
    REPUBLIC_ER_STATUTES,
)
