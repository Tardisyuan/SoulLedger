"""
Judgment model — records of soul judgment proceedings.
"""
import uuid

from django.core.exceptions import ValidationError
from django.db import models

from apps.core.archive import ArchivableMixin
from apps.core.models import AuditUserFields
from apps.souls.models import Civilization, Soul
from apps.tenants.managers import TenantManager


class Verdict(models.TextChoices):
    PASSED = "PASSED", "Passed / Saved"
    FAILED = "FAILED", "Failed / Condemned"
    PURGATORY = "PURGATORY", "Purgatory / Intermediate"
    RETRY = "RETRY", "Retry / Appeal"


class JudgmentMethod(models.TextChoices):
    STANDARD = "STANDARD", "Standard Trial (Chinese/European)"
    HEART_WEIGHING = "HEART_WEIGHING", "Heart Weighing (Egyptian)"
    DIABOLICAL_TRIAL = "DIABOLICAL_TRIAL", "Diabolical Trial (European Hell)"


class Judgment(ArchivableMixin, AuditUserFields, models.Model):
    """
    A single judgment proceeding for a soul.

    Deletion (Stage 4 §4.7): a pending judgment (verdict is null) is an
    ordinary soft delete. Once a verdict has been recorded, the judgment
    is part of the soul's judicial history and is archivable instead — see
    can_delete/delete_or_archive below and ArchivableMixin.archive().
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    soul = models.ForeignKey(
        Soul,
        on_delete=models.CASCADE,
        related_name="judgments",
    )
    civilization = models.CharField(max_length=20, choices=Civilization.choices)
    judge = models.ForeignKey(
        "actors.Actor",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="judgments_conducted",
    )
    court = models.CharField(max_length=255, blank=True, help_text="Court name, e.g. 第一殿")
    evidence_json = models.JSONField(default=dict)
    confession = models.TextField(blank=True)
    judgment_method = models.CharField(
        max_length=30,
        choices=JudgmentMethod.choices,
        default=JudgmentMethod.STANDARD,
        help_text="Method of judgment (affects disposition routing)",
    )
    verdict = models.CharField(
        max_length=20,
        choices=Verdict.choices,
        null=True,
        blank=True,
    )
    notes = models.TextField(blank=True)
    is_final = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    concluded_at = models.DateTimeField(null=True, blank=True)

    tenant = models.ForeignKey(
        'tenants.Tenant',
        on_delete=models.CASCADE,
        related_name='judgments',
        null=True,
    )

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Judgment"
        verbose_name_plural = "Judgments"
        indexes = [
            models.Index(fields=["soul", "verdict"]),
            models.Index(fields=["tenant", "created_at"]),
            models.Index(fields=["verdict"]),
            models.Index(fields=["is_final"]),
        ]

    all_objects = models.Manager()  # unfiltered; declared first so it's _base_manager
    objects = TenantManager()

    def __str__(self):
        v = self.verdict or "PENDING"
        return f"Judgment of {self.soul.name}: {v}"

    def conclude(self, verdict: str, notes: str = "", create_workflow: bool = False,
                 statute_ids=None) -> bool:
        from apps.judgment.services import JudgmentConclusionService
        return JudgmentConclusionService.conclude_judgment(
            self, verdict, notes, create_workflow, statute_ids=statute_ids
        )

    @property
    def can_delete(self) -> bool:
        """False once a verdict has been recorded — see class docstring."""
        return self.verdict is None

    def delete_or_raise(self, user=None, reason=""):
        """Soft-delete this judgment, or raise DeletionNotAllowedError
        (archivable=True) once it carries a verdict."""
        from apps.core.archive import DeletionNotAllowedError

        if not self.can_delete:
            raise DeletionNotAllowedError(
                "This judgment has a recorded verdict and cannot be deleted. "
                "Archive it instead.",
                archivable=True,
            )
        self.soft_delete(user=user, reason=reason)


# ---------------------------------------------------------------------------
# The cited basis of a verdict
# ---------------------------------------------------------------------------


class StatuteCorpus(models.TextChoices):
    """Which body of rules an article belongs to.

    Not one flat "sin category" list, and not one shared article schema. The
    three cosmologies in this system do not have the same kind of rulebook, in
    exactly the way apps/ledger/readings.py says they do not have the same kind
    of ledger reading:

      * NEGATIVE_CONFESSION is not a code of offences at all. It is 42 things
        the deceased *denies* having done, one per assessor, recited in the
        Hall of Two Truths. Citing one is citing a denial the heart failed to
        sustain — the polarity is inverted from a statute, and flattening the
        two together would state the Egyptian material as prohibitions it does
        not contain.
      * DEADLY_SIN is the seven capital sins, one article per terrace of Mount
        Purgatory (EU-DS-T1..T7). It was seeded in 6017f04 against Dante's nine
        circles, withdrawn in 8308204 because that frame does not exist — the
        Inferno is layered on Aristotle's tripartite scheme (Inf. XI.79-84) and
        pride, envy and sloth get no circle at all — and re-anchored to
        Purgatorio X-XXVII, which is the structure the seven actually order.
        The articles carry `purgatorio_terrace`; the `dante_circle` the first
        attempt carried is retired, being a coordinate the poem does not have.
      * INFERNO is the OTHER European corpus and a different structure in a
        different canticle: the nine circles of Inferno IV-XXXIV plus the
        seventh circle's three gironi, the eighth's ten bolge and the ninth's
        four zones of Cocytus, 26 articles under EU-INF-*. Two European
        corpora rather than one enlarged one, because the seven capital sins
        order the terraces and Aristotle's tripartition orders the circles
        (Inf. XI.79-84), and the single finding of
        docs/lore-verification/verify-christian-structure.md is that joining
        the two produces a chart that exists nowhere in Dante. No article here
        cites a terrace and no terrace article cites a circle.

        THIS IS NOT `dante_circle` RETURNING. That key was a circle number
        hung on a capital sin — a coordinate for pride, envy and sloth that
        the poem does not give them. Here the circle is not an attribute of
        anything: the circle IS the article, the way the terrace article for
        wrath IS the third terrace. No row in any corpus carries the retired
        key, and tests/test_purgatorio_terraces.py still asserts it of every
        seeded statute.

        AND IT ROUTES NOTHING. Which circle a soul belongs in needs a kind of
        sin; `RecordCategory` is a 功過格 taxonomy, and baptismal state,
        doctrinal position and the identity of a betrayed trust have no field
        anywhere in this system. `_route_european` still sorts by a demerit
        magnitude and the contradiction tests in
        backend/tests/test_european_hell_basis.py still pass. An article is
        something a judge can cite by hand.
      * HELL_LAW (冥律) is EMPTY, and its emptiness is a finding rather than a
        backlog item. It was seeded in 6017f04 and withdrawn: there is no
        codified 冥律 to transcribe — 《玉历宝钞》 is a hall-by-hall morality
        tract with no articles, no numbering and no sentence lengths. The
        withdrawal note in seed_mythology.py has the detail; migration
        judgment/0012 retired the rows.

        GONGGUOGE ARRIVING DOES NOT CHANGE THIS. The finding was about 冥律,
        not about the Chinese side having nothing: 《太微仙君功過格》 is real
        and is now seeded, and a codified 冥律 is still a document nobody has
        ever produced. HELL_LAW stays empty, and refilling it with the 功過格
        articles would re-assert the very thing 8308204 withdrew.
      * GONGGUOGE (功過格) is 《太微仙君功過格》 (1171, Daozang 洞真部戒律類),
        73 transcribed articles under CN-GGG-*: 35 功 and 38 過, in four gates
        each. Signed, enumerated, point-valued — the shape `polarity` was built
        for — and the ONLY corpus here whose articles carry positive entries.
        It is also the one corpus this system uses for something its own text
        does not claim: a 功過格 is an account book the LIVING keep on
        themselves, whose sanctions are 奪紀奪算 (years struck off a life),
        the 300/1300-good thresholds for immortality and 餘慶餘殃 falling on
        descendants. 太微 names no hell anywhere. Every seeded row carries that
        appropriation in `source_notes` rather than being quietly filed as
        infernal law, which is exactly how the withdrawn HELL_LAW corpus
        started.

    THE EMPTY VALUE IS KEPT ON PURPOSE. Rows still carry it — the ones 0012
    soft-deleted, and any it refused to touch because a judgment had already
    cited them — and a value that has left the enum is a row whose `corpus` no
    longer renders, no longer validates, and no longer reverses. An empty choice
    costs nothing; an unreadable stored value costs a decided case its stated
    grounds. The same applies to the retired EU-DS-01..07 rows, which are
    DEADLY_SIN tombstones sitting beside the seven live terrace articles.

    WHY GONGGUOGE IS A NEW VALUE AND NOT A REFILL OF HELL_LAW. A 功過格 is an
    account book the living keep on themselves; 冥律 claims to be a penal code
    hell administers. Reusing the name would file the one under the other and
    resurrect exactly the framing that had to be withdrawn — and it would do it
    silently, because the codes and the prose would all look correct. The
    citation keys are new for the same reason the terraces' are (CN-GGG-*, not
    CN-HL-*): judgment/0012 deliberately left cited articles live, so a
    CN-HL-O01 may still exist on a deployed database, and `_upsert` matches on
    `code`.

    So `corpus` says what kind of thing the reader is looking at, and
    CORPUS_CIVILIZATION below pins each one to the single cosmology it belongs
    to. A statute may not be filed under a corpus its civilization does not
    have; `Statute.clean` refuses it.
    """
    HELL_LAW = "HELL_LAW", "冥律 — Hell Law (Chinese)"
    GONGGUOGE = "GONGGUOGE", "功過格 — Ledger of Merit and Demerit (Chinese)"
    NEGATIVE_CONFESSION = "NEGATIVE_CONFESSION", "Declaration of Innocence (Egyptian)"
    DEADLY_SIN = "DEADLY_SIN", "Seven Deadly Sins (European)"
    INFERNO = "INFERNO", "Inferno — the Circles of Dante's Hell (European)"


#: The one civilization each corpus belongs to. A dict rather than a naming
#: convention on the code, so adding a corpus is one line here and an obvious
#: one to review.
CORPUS_CIVILIZATION = {
    StatuteCorpus.HELL_LAW: Civilization.CHINESE,
    StatuteCorpus.GONGGUOGE: Civilization.CHINESE,
    StatuteCorpus.NEGATIVE_CONFESSION: Civilization.EGYPTIAN,
    StatuteCorpus.DEADLY_SIN: Civilization.EUROPEAN,
    StatuteCorpus.INFERNO: Civilization.EUROPEAN,
}
#: Two corpora may share a civilization — Chinese has both the empty HELL_LAW
#: and the seeded GONGGUOGE, and Europe has both DEADLY_SIN (the terraces) and
#: INFERNO (the circles) — so this is deliberately not inverted into a
#: civilization -> corpus lookup anywhere. `Statute.clean` reads it in the one
#: direction that is a function.


class StatutePolarity(models.TextChoices):
    """Whether citing this article counts against the soul or for it.

    MERIT has rows behind it again: the 35 功 of GONGGUOGE. It was kept while
    the corpus that had them was withdrawn (see StatuteCorpus) because the
    distinction is real wherever the Chinese material lands — 功過相抵, merit
    offsetting fault, is the arithmetic a 功過格 is entirely made of, and
    without a polarity a judgment citing 賑濟窮民 would read as an accusation
    of almsgiving. What was fabricated was a numbering, not the idea that a
    ledger has two columns.

    Note what MERIT/OFFENCE does NOT say: that any merit article offsets any
    offence article. 《文昌帝君功過格》凡例 rules the opposite outright —
    「功過有不可折者。如用財之百功，不可折致死人之百過」 — and each seeded
    row carries a `payload_json["fungibility_class"]` saying which pool it
    belongs to. See apps/ledger/fungibility.py.

    DENIAL is the Egyptian case and is deliberately not folded into OFFENCE:
    "I have not stolen" is a claim the deceased makes, and what a judgment
    cites is the failure of that claim, not a prohibition on theft.
    """
    OFFENCE = "OFFENCE", "Offence — counts against the soul"
    MERIT = "MERIT", "Merit — counts for the soul"
    DENIAL = "DENIAL", "Denial the deceased must sustain"


class Statute(AuditUserFields, models.Model):
    """One citable article of one cosmology's rulebook.

    A model rather than a text column on Judgment, for three reasons that are
    all about reuse rather than tidiness:

      1. An article is cited by many judgments. 杀生 is one rule; a free-text
         "依据：杀生" on each judgment is N spellings of it, and no query can
         ask "every case decided under this article" — which is the first
         question an explainable verdict invites.
      2. Articles are multilingual reference data and this codebase already has
         a shape for that: `title_zh/title_en/title_egy` + `get_localized_*`,
         the same convention Realm and Actor use. A JSON blob on Judgment would
         be a second, private one.
      3. The three corpora carry structurally different facts (a hell to serve
         in; a merit score; a terrace of Purgatory). `payload_json` holds the
         corpus-specific part, and `Statute` holds only what all three actually
         share: identity, provenance, and which way it cuts.

    DERIVED ARTICLES. `source_actor` is how the Egyptian 42 exist here without
    a second hand-maintained copy of the text. Those clauses are already in the
    database — `Actor.powers_json["negative_confession"]`, one per assessor,
    seeded from Budge with its edition recorded (see seed_mythology). A Statute
    row for assessor N carries the citation identity and points at that Actor;
    its body text is READ from the actor at display time by
    `get_localized_text`, and its own `text_*` columns stay empty. Copying the
    42 clauses across would make the seeder the second author of a text it does
    not own, and the two copies would drift the first time one was corrected.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    civilization = models.CharField(max_length=20, choices=Civilization.choices)
    corpus = models.CharField(max_length=30, choices=StatuteCorpus.choices)
    code = models.CharField(
        max_length=40,
        help_text=(
            "Stable citation key, e.g. CN-GGG-F-JJ-01 / EG-NC-07 / EU-DS-T3 / "
            "EU-INF-C8-B02. CN-HL-* and EU-DS-01..07 are withdrawn keys and "
            "are not reused."
        ),
    )
    #: Position within the corpus. Explicit, for the reason the assessors'
    #: `assessor_index` is explicit: alphabetical ordering of 42 gods, or of
    #: seven sins in Gregory's order, is wrong in a way that looks fine.
    ordinal = models.IntegerField(default=0)
    polarity = models.CharField(
        max_length=10,
        choices=StatutePolarity.choices,
        default=StatutePolarity.OFFENCE,
    )

    title_zh = models.CharField(max_length=255, blank=True)
    title_en = models.CharField(max_length=255, blank=True)
    title_egy = models.CharField(max_length=255, blank=True)
    text_zh = models.TextField(blank=True)
    text_en = models.TextField(blank=True)
    text_egy = models.TextField(blank=True)

    #: Where this article comes from, in enough detail to check it. Never
    #: blank on a seeded row — an article with no provenance is the failure
    #: this whole feature exists to avoid.
    source = models.CharField(max_length=500, blank=True)
    #: Verbatim caveats, carried rather than smoothed over — the same
    #: discipline as the assessors' `source_notes`. A list of strings.
    source_notes = models.JSONField(default=list, blank=True)
    #: Corpus-specific structured facts: `purgatorio_terrace`, `latin`,
    #: `opposing_virtue_*` and the terrace's realm_code for the seven sins,
    #: `assessor_index` for the Forty-Two, and for GONGGUOGE the two-level
    #: 門 classification plus the scoring structure a single scalar cannot
    #: hold — `clauses` (救濟門#4 alone carries twelve conditional values),
    #: `nullifiers` (「則無功」), `cap`, `derived`, `money_rate` and
    #: `fungibility_class`. Point values live in `clauses[].points` as JSON
    #: numbers rather than in a column, because 半功/半過 is 0.5 and the
    #: article is a table of conditions, not one number. For INFERNO it holds
    #: `circle`, the subdivision's kind/index/name, `parent_code` and
    #: `within_dis` — the wall of Dis, which is the poem's only real divider.
    #: NOT `dante_circle` — that key was retired with the first attempt at the
    #: seven, and `circle` on a circle article is not it: one was a coordinate
    #: invented for a sin, the other is the article's own identity. See
    #: StatuteCorpus.
    payload_json = models.JSONField(default=dict, blank=True)

    #: The row this article's text is derived from. Set for the Egyptian 42;
    #: null for everything transcribed from a document.
    source_actor = models.ForeignKey(
        "actors.Actor",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="derived_statutes",
        help_text="Derivation source; the article body is read from this row.",
    )
    #: Which key of `source_actor.powers_json` holds the body text.
    source_actor_field = models.CharField(max_length=50, blank=True)

    tenant = models.ForeignKey(
        "tenants.Tenant",
        on_delete=models.CASCADE,
        related_name="statutes",
        null=True,
    )

    class Meta:
        ordering = ["civilization", "corpus", "ordinal", "code"]
        verbose_name = "Statute"
        verbose_name_plural = "Statutes"
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "code"],
                name="unique_statute_tenant_code",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "corpus"]),
            models.Index(fields=["civilization", "corpus", "ordinal"]),
        ]

    all_objects = models.Manager()  # unfiltered; declared first so it's _base_manager
    objects = TenantManager()

    def __str__(self):
        return f"{self.code} {self.title_en or self.title_zh}"

    def clean(self):
        expected = CORPUS_CIVILIZATION.get(self.corpus)
        if expected is not None and self.civilization != expected:
            raise ValidationError(
                {
                    "corpus": (
                        f"{self.corpus} belongs to {expected}, not "
                        f"{self.civilization}. A corpus is one cosmology's "
                        f"rulebook; filing an article under another's states a "
                        f"rule that tradition does not have."
                    )
                }
            )

    @property
    def derived_text(self) -> str:
        """The body text held on `source_actor`, or "" when this is not a
        derived article.

        Reads through `source_actor_field` rather than hardcoding
        `negative_confession`, so a second derived corpus does not have to
        rename the Egyptian one to reuse this."""
        if self.source_actor_id is None or not self.source_actor_field:
            return ""
        payload = self.source_actor.powers_json or {}
        return payload.get(self.source_actor_field) or ""

    def get_localized_title(self, locale: str = "en") -> str:
        if locale.startswith("zh"):
            return self.title_zh or self.title_en or self.code
        if locale == "egy":
            return self.title_egy or self.title_en or self.code
        return self.title_en or self.title_zh or self.code

    def get_localized_text(self, locale: str = "en") -> str:
        """The article body in the requested locale.

        Falls through to `derived_text` last rather than first: a derived
        article that later acquires a real translation should show it, and the
        Egyptian clauses have no Chinese rendering at all (neither do the
        assessors' names — see seed_mythology on `name_zh`)."""
        if locale.startswith("zh"):
            return self.text_zh or self.text_en or self.derived_text
        if locale == "egy":
            return self.text_egy or self.text_en or self.derived_text
        return self.text_en or self.text_zh or self.derived_text


class JudgmentCitation(AuditUserFields, models.Model):
    """One article cited as the basis of one judgment.

    A through-model with its own columns rather than a plain M2M, because the
    interesting part is per-citation: *why* this article applies to this case
    (`note`), and who entered it and when — which AuditUserFields already
    carries, and which is the whole point of making a verdict explainable.

    `statute` is PROTECT. A cited article is evidence of how a case was
    decided; letting it be deleted out from under a concluded judgment would
    turn a recorded basis into a dangling id. Retiring an article means
    soft-deleting it (`is_deleted`), which keeps existing citations readable
    while taking it out of the picker.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    judgment = models.ForeignKey(
        Judgment,
        on_delete=models.CASCADE,
        related_name="citations",
    )
    statute = models.ForeignKey(
        Statute,
        on_delete=models.PROTECT,
        related_name="citations",
    )
    note = models.TextField(
        blank=True,
        help_text="How this article applies to this case.",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    tenant = models.ForeignKey(
        "tenants.Tenant",
        on_delete=models.CASCADE,
        related_name="judgment_citations",
        null=True,
    )

    class Meta:
        # Reads in the corpus's own order, not in the order somebody happened
        # to click them: a list of grounds is a list of articles, and the
        # 功過格/Forty-Two sequences are load-bearing.
        ordering = ["statute__corpus", "statute__ordinal", "created_at"]
        verbose_name = "Judgment citation"
        verbose_name_plural = "Judgment citations"
        constraints = [
            models.UniqueConstraint(
                fields=["judgment", "statute"],
                name="unique_citation_judgment_statute",
            ),
        ]
        indexes = [
            models.Index(fields=["judgment"]),
            models.Index(fields=["tenant", "created_at"]),
        ]

    all_objects = models.Manager()  # unfiltered; declared first so it's _base_manager
    objects = TenantManager()

    def __str__(self):
        return f"{self.judgment_id} cites {self.statute.code}"
