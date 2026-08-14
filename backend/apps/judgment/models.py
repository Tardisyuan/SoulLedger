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
        not contain. It is the only corpus with data in it.
      * HELL_LAW (冥律) and DEADLY_SIN are EMPTY, and their emptiness is a
        finding rather than a backlog item. Both were seeded in 6017f04 and
        withdrawn: there is no codified 冥律 to transcribe (《玉历宝钞》 is a
        hall-by-hall morality tract with no articles, no numbering and no
        sentence lengths), and the Inferno is not stratified by the seven
        capital sins (Dante layers hell on Aristotle's tripartite scheme, and
        pride, envy and sloth get no circle at all). The withdrawal note in
        seed_mythology.py has the detail; migration judgment/0012 retired the
        rows.

    THE TWO EMPTY VALUES ARE KEPT ON PURPOSE. Rows still carry them — the ones
    0012 soft-deleted, and any it refused to touch because a judgment had
    already cited them — and a value that has left the enum is a row whose
    `corpus` no longer renders, no longer validates, and no longer reverses.
    An empty choice costs nothing; an unreadable stored value costs a decided
    case its stated grounds.

    ADDING THE NEXT ONE. If the Chinese side returns via 《太微仙君功過格》 —
    a merit ledger with genuinely enumerated, signed entries — it very likely
    wants a NEW value rather than a refill of HELL_LAW. A 功過格 is an account
    book the living keep on themselves; 冥律 claims to be a penal code hell
    administers. Reusing the name would file the one under the other and
    resurrect exactly the framing that had to be withdrawn.

    So `corpus` says what kind of thing the reader is looking at, and
    CORPUS_CIVILIZATION below pins each one to the single cosmology it belongs
    to. A statute may not be filed under a corpus its civilization does not
    have; `Statute.clean` refuses it.
    """
    HELL_LAW = "HELL_LAW", "冥律 — Hell Law (Chinese)"
    NEGATIVE_CONFESSION = "NEGATIVE_CONFESSION", "Declaration of Innocence (Egyptian)"
    DEADLY_SIN = "DEADLY_SIN", "Seven Deadly Sins (European)"


#: The one civilization each corpus belongs to. A dict rather than a naming
#: convention on the code, so adding a corpus is one line here and an obvious
#: one to review.
CORPUS_CIVILIZATION = {
    StatuteCorpus.HELL_LAW: Civilization.CHINESE,
    StatuteCorpus.NEGATIVE_CONFESSION: Civilization.EGYPTIAN,
    StatuteCorpus.DEADLY_SIN: Civilization.EUROPEAN,
}


class StatutePolarity(models.TextChoices):
    """Whether citing this article counts against the soul or for it.

    MERIT has no rows behind it at the moment — the corpus that had them was
    withdrawn (see StatuteCorpus) — and it stays because the distinction is
    real wherever the Chinese material eventually lands: 功過相抵, merit
    offsetting fault, is the arithmetic a 功過格 is entirely made of, and
    without a polarity a judgment citing 孝养父母 would read as an accusation
    of filial piety. What was fabricated was a numbering, not the idea that a
    ledger has two columns.

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
         in; a merit score; a circle of the Inferno). `payload_json` holds the
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
        help_text="Stable citation key, e.g. CN-HL-O01 / EG-NC-07 / EU-DS-03",
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
    #: Corpus-specific structured facts: `punishment_hell` and `merit_points`
    #: for 冥律, `dante_circle`/`latin`/`opposing_virtue` for the seven sins,
    #: `assessor_index` for the Forty-Two.
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
        # 冥律/Forty-Two sequences are load-bearing.
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
