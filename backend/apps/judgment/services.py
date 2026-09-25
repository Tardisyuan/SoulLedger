"""
Judgment domain services — cross-context orchestration for judgment lifecycle.
"""
from django.db import transaction
from django.utils import timezone

from apps.souls.models import SoulState


class CitationRefusedError(Exception):
    """A statute may not be cited on this judgment, with the reason why.

    An exception rather than a boolean because every refusal here is something
    the operator has to be told: a cross-tenant article, an article from
    another cosmology, and an article that does not exist are three different
    mistakes and only one of them is a typo.
    """


class StatuteCitationService:
    """Attaching and detaching the articles a verdict rests on.

    Every rule below is enforced HERE rather than in the serializer, because
    citations are written from two places — the `citations` action and the
    `conclude` payload — and a check that lives in one serializer is a check
    the other path does not have. That is the shape of the tenant gaps
    apps/core/tenant.py was written to close, one layer up.
    """

    @staticmethod
    def resolve(judgment, statute_id):
        """The Statute this judgment may cite, or `CitationRefusedError`.

        Looked up through `Statute.all_objects` and then checked, rather than
        through a pre-filtered queryset: "no such article" and "that article
        belongs to another tenant" must not collapse into the same 404, or a
        cross-tenant reference reads to the operator as a bad id and gets
        retried forever.
        """
        from apps.judgment.models import Statute

        statute = Statute.all_objects.filter(pk=statute_id).first()
        if statute is None:
            raise CitationRefusedError(f"No statute with id {statute_id}.")
        if statute.is_deleted:
            raise CitationRefusedError(
                f"Statute {statute.code} has been retired and cannot be newly "
                f"cited. Citations already recorded against it stand."
            )
        if statute.tenant_id != judgment.tenant_id:
            raise CitationRefusedError(
                f"Statute {statute.code} belongs to another tenant. A verdict "
                f"can only rest on its own jurisdiction's articles."
            )
        if statute.civilization != judgment.civilization:
            raise CitationRefusedError(
                f"Statute {statute.code} is {statute.civilization} and this "
                f"judgment is {judgment.civilization}. The three cosmologies "
                f"do not share a rulebook."
            )
        return statute

    @staticmethod
    def assert_amendable(judgment):
        """Refuse to edit the grounds of a judgment that has already been given.

        Same stance as `Judgment.can_delete`: once a verdict is recorded the
        proceeding is judicial history. Grounds added afterwards would be a
        rationalisation written after the fact, which is the opposite of what
        an explainable verdict is for — so they go in with the verdict
        (`conclude(..., statute_ids=[...])`) or not at all.
        """
        if judgment.is_final or judgment.verdict is not None:
            raise CitationRefusedError(
                "This judgment has been concluded; its cited grounds are part "
                "of the record and can no longer be changed."
            )

    @classmethod
    def cite(cls, judgment, statute_id, note="", *, enforce_amendable=True):
        """Record one article as a ground of this judgment. Idempotent."""
        from apps.judgment.models import JudgmentCitation

        if enforce_amendable:
            cls.assert_amendable(judgment)
        statute = cls.resolve(judgment, statute_id)
        citation, created = JudgmentCitation.all_objects.get_or_create(
            judgment=judgment,
            statute=statute,
            defaults={"note": note, "tenant": judgment.tenant},
        )
        if not created and note and citation.note != note:
            citation.note = note
            citation.save(update_fields=["note", "update_time", "update_user", "version"])
        return citation

    @classmethod
    def cite_many(cls, judgment, statute_ids, *, enforce_amendable=True):
        """Record several grounds at once — the ordinary case, since a verdict
        usually rests on more than one article.

        All-or-nothing: one bad id refuses the whole set rather than leaving a
        partially cited judgment behind. The caller is inside
        `conclude_judgment`'s transaction when this runs at conclusion time,
        so a refusal there rolls the verdict back with it.
        """
        if enforce_amendable:
            cls.assert_amendable(judgment)
        statutes = [cls.resolve(judgment, statute_id) for statute_id in statute_ids]
        return [
            cls.cite(judgment, statute.pk, enforce_amendable=False)
            for statute in statutes
        ]

    @classmethod
    def uncite(cls, judgment, statute_id):
        """Remove a ground. Returns True when something was removed.

        A real delete, not a soft one, and deliberately: `assert_amendable`
        has already established the judgment carries no verdict, so what is
        being removed is draft reasoning on an open case — the same category as
        the triage queue's skip set, which §4.2 keeps off the server precisely
        so that working through a queue does not write history. Grounds become
        history at the moment the verdict does.
        """
        from apps.judgment.models import JudgmentCitation

        cls.assert_amendable(judgment)
        # Resolve first, so removing a cross-tenant id reports the same refusal
        # adding it would have — never a silent "nothing to do".
        statute = cls.resolve(judgment, statute_id)
        deleted, _ = JudgmentCitation.all_objects.filter(
            judgment=judgment, statute=statute
        ).delete()
        return bool(deleted)


class JudgmentNotConcludableError(Exception):
    """The soul cannot take the state change concluding a judgment requires.

    Raised inside `conclude`'s transaction so the judgment, the disposition and
    the workflow it has already created roll back with it.
    """


class JudgmentConclusionService:
    """
    Orchestrates the judgment conclusion saga across multiple bounded contexts:
    judgment → disposition → workflow → soul state → event log.
    """

    @staticmethod
    def conclude_judgment(
        judgment,
        verdict: str,
        notes: str = "",
        create_workflow: bool = False,
        statute_ids=None,
        plan_changes=None,
        destination_realm_id=None,
        term_years=None,
        eternal=None,
        by=None,
    ) -> bool:
        """
        Execute the full judgment conclusion saga.
        Wrapped in transaction.atomic() for consistency.

        Steps:
        0. Record the cited articles the verdict rests on
        1. Update judgment state (verdict, notes, final flag)
        2. Create disposition from judgment
        3. Optionally create approval workflow
        4. Transition soul to DISPOSED
        5. Log domain event

        `statute_ids` is recorded FIRST and inside the same transaction. Two
        consequences, both wanted: a refusal (unknown article, another
        tenant's, another cosmology's) aborts the conclusion rather than
        producing a verdict whose stated grounds silently failed to land; and
        the citations are written while the judgment is still amendable, which
        is the only window `StatuteCitationService.assert_amendable` allows.
        """
        from apps.sentence_plan.services import SentencePlanService

        with transaction.atomic():
            # Step -2: the row lock, and who may conclude a claimed case. Only
            # when a caller is named — the API always names one; in-process
            # callers (seeders, test helpers) act as the system, not as an officer.
            if by is not None:
                from apps.judgment.claims import lock_for_conclude
                lock_for_conclude(judgment.pk, by)

            # Step -1 (Q17): an attached cross-tenant judgment must have ended —
            # its PASS nodes are copied into the plan below. Raises before
            # anything is written.
            cross = SentencePlanService.check_cross_judgment(judgment)

            # Step -½: the officer's own destination / term (审判台「戊 · 发落」).
            # Validated — and the chosen realm row locked for its capacity —
            # before anything is written. None of the three given = the
            # automatic routing, untouched.
            placement = {}
            if destination_realm_id is not None or term_years is not None or eternal is not None:
                from apps.disposition.destination import resolve_placement
                placement = resolve_placement(
                    judgment, verdict, realm_id=destination_realm_id,
                    term_years=term_years, eternal=eternal,
                )

            # Step 0: Grounds, before the verdict they explain.
            if statute_ids:
                StatuteCitationService.cite_many(judgment, statute_ids)

            # Step 1: Update judgment state
            judgment.verdict = verdict
            judgment.notes = notes
            judgment.is_final = True
            judgment.concluded_at = timezone.now()
            # The admitted balance, frozen with the verdict — the rulings are
            # frozen from here on too (`_assert_open`).
            judgment.concluded_balance = EvidenceAdmissionService.admitted_net(judgment)
            judgment.save()

            # An AMENDMENT (the stop's own case, situation 1) or a REOPEN (the
            # home judge's retrial) changes the sentence plan instead: no
            # disposition, no soul state move — the soul is already DISPOSED,
            # which is why this used to be unconcludable (design doc G1).
            # Same transaction: a refusal below rolls the verdict back with it.
            from apps.judgment.models import JudgmentKind
            from apps.sentence_plan import requests as plan_requests

            if judgment.kind != JudgmentKind.ORIGINAL:
                if judgment.kind == JudgmentKind.AMENDMENT:
                    plan_requests.request_from_amendment(judgment, plan_changes, notes)
                else:
                    if plan_changes:
                        raise plan_requests.PlanChangeRefusedError(
                            "A reopened judgment changes the plan through its verdict (a new home node), "
                            "not through plan_changes", "invalid_changes")
                    plan_requests.conclude_reopened(judgment)
                SentencePlanService.advance(judgment.soul)
                from apps.events.services import EventService
                EventService.log_judgment_concluded(judgment)
                return True
            if plan_changes:
                raise plan_requests.PlanChangeRefusedError(
                    "plan_changes apply only to an amendment judgment", "invalid_changes")

            # Step 2: Create disposition (cross-context: judgment → disposition)
            from apps.disposition.services import DispositionService
            disposition = DispositionService.create_from_judgment(judgment, **placement)

            # Step 2b: the sentence plan this conclusion opens — one home node,
            # carrying the disposition just made (docs/ARCHITECTURE-sentence-plan.md).
            # Same transaction: a plan without its conclusion, or the reverse,
            # is the half-written record the saga exists to prevent.
            SentencePlanService.create_from_conclusion(judgment, disposition, cross)

            # Step 3: Optionally create workflow (cross-context: judgment → workflow)
            if create_workflow:
                from apps.workflow.services import WorkflowService
                WorkflowService.create_from_judgment(judgment)

            # Step 4: Transition soul state (cross-context: judgment → souls)
            # Checked, not dropped. A soul that cannot move to DISPOSED
            # leaves this block with a concluded judgment, a disposition and
            # possibly a workflow all committed around it — and `conclude`
            # returned True either way, so no caller could tell.
            if not judgment.soul.transition_to(
                SoulState.DISPOSED, f"Judgment concluded: {verdict}"
            ):
                raise JudgmentNotConcludableError(
                    f"Soul {judgment.soul.pk} is {judgment.soul.current_state}; "
                    f"a judgment cannot conclude from there. Nothing was written."
                )

            # Step 4b: any conclusion may be the last thing a sentence plan was
            # waiting on (docs/ARCHITECTURE-sentence-plan.md §3.3).
            SentencePlanService.advance(judgment.soul)

        # Step 5: Log domain event (outside transaction for performance)
        from apps.events.services import EventService
        EventService.log_judgment_concluded(judgment)

        return True


class JudgmentFrozenError(Exception):
    """The judgment has been concluded; its evidence rulings and draft are
    part of the record. 409, the same answer `assert_amendable` gives the
    grounds — the request is well-formed, the case is past accepting it."""


class EvidenceRefusedError(Exception):
    """This record cannot be ruled on in this case, or the ruling is incomplete
    (not admitted without a reason). 400."""


class DraftConflictError(Exception):
    """The draft moved since the caller loaded it. Carries the judgment as it
    now stands so the 409 can hand the caller the current text and version."""

    def __init__(self, judgment):
        super().__init__("The draft was saved by someone else since you loaded it.")
        self.judgment = judgment


def _assert_open(judgment):
    if judgment.is_final or judgment.verdict is not None:
        raise JudgmentFrozenError(
            "This judgment has been concluded; its evidence and draft can no longer be changed."
        )


class EvidenceAdmissionService:
    """Ruling one ledger record admitted or not admitted in one judgment.

    The judgment row is locked before the open-case check, so a ruling racing
    `conclude/` either lands before the verdict or is refused after it —
    never written onto a concluded case.
    """

    SCORED_TYPES = ("MERIT", "DEMERIT")

    @classmethod
    def rule(cls, judgment, record_id, admitted: bool, reason: str = ""):
        from apps.judgment.models import EvidenceAdmission, Judgment
        from apps.ledger.models import SoulRecord

        reason = (reason or "").strip()
        if not admitted and not reason:
            raise EvidenceRefusedError("A reason is required when a record is not admitted.")
        with transaction.atomic():
            locked = Judgment.all_objects.select_for_update().get(pk=judgment.pk)
            _assert_open(locked)
            # One message whether the id is unknown, another soul's or another
            # tenant's: the caller learns nothing about records outside this case.
            record = SoulRecord.objects.filter(
                pk=record_id, soul_id=locked.soul_id, cycle=locked.cycle,
            ).first()
            if record is None:
                raise EvidenceRefusedError(f"Record {record_id} is not evidence in this case.")
            if record.record_type not in cls.SCORED_TYPES:
                raise EvidenceRefusedError(
                    f"Record {record_id} is a {record.record_type} entry; only merit and "
                    f"demerit records are evidence that can be admitted or not."
                )
            row = EvidenceAdmission.objects.filter(judgment=locked, record=record).first()
            if row is None:
                row = EvidenceAdmission(judgment=locked, record=record, tenant=locked.tenant)
            row.admitted = admitted
            row.reason = "" if admitted else reason
            row.save()
            return row

    @staticmethod
    def not_admitted_ids(judgment):
        return list(
            judgment.evidence_admissions.filter(admitted=False).values_list("record_id", flat=True)
        )

    @classmethod
    def admitted_balance(cls, judgment) -> dict:
        """The desk's 「采信后余额」. A concluded case with a snapshot shows the
        snapshot (`Judgment.concluded_balance`) where the reading is a balance,
        not today's figure — the soul's ledger keeps moving after the verdict."""
        from apps.ledger.services import LedgerService

        result = LedgerService.get_admitted_balance(
            judgment.soul, judgment.cycle, cls.not_admitted_ids(judgment)
        )
        # `current_balance`: today's admitted figure, beside the snapshot — the
        # desk's 「结案时余额 / 现值」. Null while the case is open (then
        # `balance` already is today's figure) or when there is no snapshot.
        result["current_balance"] = None
        if (
            judgment.verdict is not None
            and judgment.concluded_balance is not None
            and result["reading_kind"] == "BALANCE"
        ):
            result["current_balance"] = result["balance"]
            result["balance"] = judgment.concluded_balance
        return result

    @classmethod
    def admitted_net(cls, judgment) -> int | None:
        """Admitted merit − demerit for this case, for every cosmology; None
        when the case is not from the soul's current life."""
        from apps.ledger.services import LedgerService

        return LedgerService.get_admitted_net(judgment.soul, judgment.cycle, cls.not_admitted_ids(judgment))


class JudgmentDraftService:
    """Autosave of the verdict text (`notes`) and the chosen verdict.

    OPTIMISTIC CONCURRENCY ON `draft_version`. The write is one conditional
    UPDATE — `WHERE draft_version = <expected> AND verdict IS NULL AND NOT
    is_final` — so two officers saving against the same version cannot both
    win on any database: the second matches no row and gets a 409 carrying
    the text that beat it. Last-write-wins is what this replaces.

    IDEMPOTENT. A save whose fields already equal what is stored is a no-op
    that answers 200 with the stored state, whatever version it carries: a
    retried request whose first attempt landed must not come back as a
    conflict with itself, and it overwrites nothing.
    """

    FIELDS = ("notes", "draft_verdict")

    @classmethod
    def save(cls, judgment, expected_version: int, changes: dict):
        from django.db.models import F

        from apps.core.request_local import get_current_user
        from apps.judgment.models import Judgment

        changes = {k: v for k, v in changes.items() if k in cls.FIELDS}
        current = Judgment.all_objects.get(pk=judgment.pk)
        _assert_open(current)
        if all(getattr(current, k) == v for k, v in changes.items()):
            return current
        if current.draft_version != expected_version:
            raise DraftConflictError(current)

        now = timezone.now()
        values = dict(changes, draft_saved_at=now, update_time=now,
                      draft_version=F("draft_version") + 1, version=F("version") + 1)
        user = get_current_user()
        if user is not None and user.is_authenticated:
            values["update_user"] = user
        updated = Judgment.all_objects.filter(
            pk=judgment.pk, draft_version=expected_version,
            verdict__isnull=True, is_final=False,
        ).update(**values)
        current = Judgment.all_objects.get(pk=judgment.pk)
        if not updated:
            # Lost a race between the read above and the write: say which one.
            _assert_open(current)
            raise DraftConflictError(current)
        return current

    @staticmethod
    def touch_after_plain_update(judgment):
        """A `notes` write through the plain PATCH/PUT still moves the draft
        version, so an autosave loaded before it gets a 409 instead of
        silently replacing it."""
        from django.db.models import F

        from apps.judgment.models import Judgment

        Judgment.all_objects.filter(pk=judgment.pk).update(
            draft_version=F("draft_version") + 1, draft_saved_at=timezone.now(),
        )
