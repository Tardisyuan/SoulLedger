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
            citation.save(update_fields=["note"])
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

    @staticmethod
    def snapshot(judgment, *, at):
        """Freeze what each cited article says right now onto its citation.

        Called by `conclude` inside its transaction, after the grounds are
        final (`assert_amendable` refuses any change from here on), so the
        snapshot is the text the verdict was actually given against."""
        from apps.judgment import snapshot
        from apps.judgment.models import CitationSnapshotKind, JudgmentCitation

        rows = list(
            JudgmentCitation.all_objects
            .filter(judgment=judgment, is_deleted=False)
            .select_related("statute", "statute__source_actor")
        )
        for c in rows:
            snapshot.fill(c, c.statute, CitationSnapshotKind.CONCLUDED, at)
        JudgmentCitation.all_objects.bulk_update(rows, snapshot.SNAPSHOT_FIELDS)

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
        create_workflow: bool | None = None,
        statute_ids=None,
        plan_changes=None,
        destination_realm_id=None,
        term_years=None,
        eternal=None,
        by=None,
        skip_node_orders=(),
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

        `create_workflow` is None when the caller did not say (第四十三批). 2026-10-29: an ORIGINAL judgment that
        places the soul always concludes with its approval workflow; an explicit False is refused (400
        `approval_flow_required`, Egyptian `weighing_flow_required`). An ORIGINAL judgment with a cross-realm
        judgment still open (PROPOSED / ACTIVE) concludes WITH an approval workflow, which merges that bench; an
        explicit False is refused (400 `workflow_required`). `skip_node_orders` are the stations of this realm's
        flow the judge unticked (W-1); the final review cannot be one of them.
        """
        from apps.sentence_plan.services import CrossJudgmentOpenError, SentencePlanService

        with transaction.atomic():
            # Step -2: the row lock, and who may conclude a claimed case. Only
            # when a caller is named — the API always names one; in-process
            # callers (seeders, test helpers) act as the system, not as an officer.
            from apps.judgment.claims import _lock, assert_concludable, lock_for_conclude

            if by is not None:
                lock_for_conclude(judgment.pk, by)
            else:
                assert_concludable(_lock(judgment.pk))

            # Step -1 (Q17): an attached cross-tenant judgment must have ended —
            # its PASS nodes are copied into the plan below. Raises before
            # anything is written. 第四十三批: one that has NOT ended no longer blocks an original judgment; the
            # approval workflow is generated and merges it (rule 8), and its stops join the plan when it ends PASS.
            from apps.judgment.models import JudgmentKind

            open_cross = (SentencePlanService.open_cross_judgment(judgment)
                          if judgment.kind == JudgmentKind.ORIGINAL else None)
            if open_cross is not None:
                if create_workflow is False:
                    raise CrossJudgmentOpenError(
                        "A cross-realm judgment is open on this case; it is concluded through the approval "
                        "workflow, so the conclusion must generate one", code="workflow_required", status=400)
                create_workflow = True
                cross = None
            else:
                cross = SentencePlanService.check_cross_judgment(judgment)

            # Step -¾ (埃及): the scale gives the verdict (docs/02 §5; apps/judgment/weighing.py). Before the
            # placement: a wavering scale sends the soul nowhere, so a destination with it is refused.
            from apps.judgment import weighing

            weighed = weighing.weigh(judgment, verdict) if weighing.applies(judgment) else None
            wavering = weighed is not None and weighed[0] == weighing.WeighingResult.WAVERING
            if wavering and (destination_realm_id is not None or term_years is not None or eternal is not None):
                raise weighing.WeighingRefusedError(
                    "The scale wavers: the case is weighed again and the soul is sent nowhere yet",
                    "wavering_has_no_destination")
            if wavering and open_cross is not None:
                raise weighing.WeighingRefusedError(
                    "A cross-realm judgment is open on this case; conclude it before weighing again",
                    "wavering_with_open_cross", status=409)

            # 重审(用户 2026-10-29 四文明统一,`hears_again`):RETRY,及欧洲以外的 PURGATORY,重开一案。
            # 照埃及天平摇摆的做法(见下):不建处置、不动计划与灵魂状态。欧洲原来就这样(炼狱只收确定得救者,
            # docs/01_欧洲 §1.2,RETRY 送进炼狱期满就升了天堂);地府的待审所、希腊的草地同样不是刑罚,
            # 只是「还没被送走」(docs/02_希腊 §5.2),docs/11 第八步「重新审理」。欧洲的 PURGATORY 照旧送炼狱。
            # 重开 / 申诉改判成这些裁决在 sentence_plan/requests.py 拒绝(那两条路本身就是再审)。
            from apps.judgment.models import acquitted_to_rebirth, hears_again
            from apps.souls.models import Civilization

            retry = judgment.kind == JudgmentKind.ORIGINAL and hears_again(judgment.soul.civilization, verdict)
            # 地府判无罪(`acquitted_to_rebirth`):不发落、不建刑期节点,流程走完直接候转世(docs/11 第六步)。
            acquitted = (judgment.kind == JudgmentKind.ORIGINAL
                         and acquitted_to_rebirth(judgment.soul.civilization, verdict))
            if acquitted and (destination_realm_id is not None or term_years is not None or eternal is not None):
                from apps.disposition.destination import DestinationRefusedError
                raise DestinationRefusedError(
                    "Acquitted in Diyu: the soul goes straight to rebirth, with no destination or term",
                    "passed_has_no_destination")
            if retry and not wavering and (
                    destination_realm_id is not None or term_years is not None or eternal is not None):
                from apps.disposition.destination import DestinationRefusedError
                raise DestinationRefusedError(
                    "A RETRY verdict hears the case again and sends the soul nowhere yet",
                    "retry_has_no_destination")
            if retry and not wavering and open_cross is not None:
                from apps.sentence_plan.requests import PlanChangeRefusedError
                raise PlanChangeRefusedError(
                    "A cross-realm judgment is open on this case; conclude it before hearing the case again",
                    "retry_with_open_cross", status=409)

            # 欧洲 大罪 / 小罪(2026-10-28,docs/01 §1.2-1.3、03 §二):未悔的大罪下地狱,小罪与已告解的大罪进炼狱。
            # 与已采信的证据不符的裁决拒绝(400 `mortal_sin_unrepented` / `no_mortal_sin`),什么都没写。
            # 读的文明与这件案子的路由同一个(2026-10-29 审查):原审按管辖文明路由(`DispositionService._route_to_realm`
            # 读 `soul.civilization`),重开审判按原属文明路由(`conclude_reopened` → `_route_home_realm`)。
            # 此前两种都读管辖文明,暂居他乡的欧洲灵魂重开时核对与路由不是同一套宇宙观。
            gravity_civilization = (judgment.soul.home_civilization if judgment.kind == JudgmentKind.REOPEN
                                    else judgment.soul.civilization)
            if (judgment.kind != JudgmentKind.AMENDMENT
                    and gravity_civilization == Civilization.EUROPEAN):
                from apps.disposition.services import DispositionService
                DispositionService.refuse_against_gravity(
                    judgment.soul, verdict, excluded=EvidenceAdmissionService.not_admitted_ids(judgment))

            # 埃及 42 条否定告白(用户 2026-10-28,docs/02 §2.2、§四、§5.1):有一条记为「不实」就不能判 PASSED
            # (400 `untruthful_confession`,带判官序号)。原审与重开都在这里;申诉改判在 sentence_plan/requests.py。
            # 告白只记在称重的案子上(加减项审判没有),所以不用再判文明与种类。
            from apps.judgment.confessions import refuse_passed_if_untruthful
            refuse_passed_if_untruthful(judgment, verdict)
            # 五逆不能判 PASSED(用户 2026-10-29,审查 J;400 `five_heinous_must_fail`)。
            from apps.judgment.models import refuse_passed_if_five_heinous
            refuse_passed_if_five_heinous(judgment, verdict)

            # 原审一律走审批流程(用户 2026-10-29,四文明):处置等流程 COMPLETED 才执行
            # (`weighing.unfinished_flow`),流程驳回就撤回处置、重开一案(`weighing.reweigh_after_rejection`)。
            # 埃及那条是称心流程(docs/02 §2.1、§5.1–5.2)。再审(天平摇摆、`hears_again`)和早夭直入芦苇原
            # (不受审,docs/01 §4.2)不在此列;重开、申诉改判、加减项不是原审,照旧。地府判无罪不建处置,但要流程:
            # 没有原属节点的计划等流程走完(`on_origin_flow_completed`)才候转世,驳回则撤回计划、重开一案。
            # 枉死城超度(`wangsi._deliver`,申诉已记 DELIVERED)同早夭一样是免审出口:不受审,所以不走审批流程。
            # 没有殿(租户)的灵魂没有文明,也就没有流程模板可走(只有手搭的数据才这样),不在此列。
            from apps.judgment.models import DuatStage, GrievanceStatus
            from apps.workflow.templates import VALID_CASE_TYPES_BY_CIVILIZATION

            if (judgment.kind == JudgmentKind.ORIGINAL and not wavering and not retry
                    and judgment.duat_stage != DuatStage.EARLY_DEATH
                    and judgment.grievance_status != GrievanceStatus.DELIVERED
                    and judgment.soul.civilization in VALID_CASE_TYPES_BY_CIVILIZATION):
                if create_workflow is False:
                    if weighed is not None:
                        raise weighing.WeighingRefusedError(
                            "An Egyptian case is concluded through the weighing flow", "weighing_flow_required")
                    raise weighing.WeighingRefusedError(
                        "An original judgment is concluded through its approval workflow", "approval_flow_required")
                create_workflow = True

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
            # 落判的人:申诉复核排除他(apps/judgment/appeals.py)。进程内调用(by=None)不记。
            if getattr(by, "pk", None) is not None:
                judgment.concluded_by = by
            # 草稿随结案作废:裁决与发落已经写进结案本身。判词草稿就是 `notes`,
            # 上面已被定稿覆盖;`draft_saved_at` / `draft_version` 是历史,不清。
            judgment.draft_verdict = None
            judgment.draft_destination_realm = None
            judgment.draft_term_years = None
            judgment.draft_eternal = False
            # The admitted balance, frozen with the verdict — the rulings are
            # frozen from here on too (`_assert_open`).
            judgment.concluded_balance = EvidenceAdmissionService.admitted_net(judgment)
            if weighed is not None:
                judgment.weighing_result, judgment.heart_weight = weighed
            judgment.save()
            # 引用条文当时的文字,与裁决同一事务落盘(apps/judgment/snapshot.py)。
            StatuteCitationService.snapshot(judgment, at=judgment.concluded_at)

            # 天平摇摆(02 §5.3):托特记下,再称一次。不建处置、不动计划、不动灵魂状态 —— 灵魂留在审判中,
            # 新的一件案子回到队列(用户 2026-10-27:不自动发落,不能落成 SETTLED 而不在任何一站)。
            if wavering or retry:
                if wavering:
                    weighing.open_retrial(judgment)
                else:
                    weighing.open_retrial(judgment, reason=str(verdict), method=judgment.judgment_method)
                from apps.events.services import EventService
                EventService.log_judgment_concluded(judgment)
                return True

            # An AMENDMENT (the stop's own case, situation 1) or a REOPEN (the
            # home judge's retrial) changes the sentence plan instead: no
            # disposition, no soul state move — the soul is already DISPOSED,
            # which is why this used to be unconcludable (design doc G1).
            # Same transaction: a refusal below rolls the verdict back with it.
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
            disposition = None if acquitted else DispositionService.create_from_judgment(judgment, **placement)

            # Step 2b: the sentence plan this conclusion opens — one home node,
            # carrying the disposition just made (docs/ARCHITECTURE-sentence-plan.md).
            # Same transaction: a plan without its conclusion, or the reverse,
            # is the half-written record the saga exists to prevent.
            SentencePlanService.create_from_conclusion(judgment, disposition, cross, open_cross=open_cross)

            # Step 3: Optionally create workflow (cross-context: judgment → workflow)
            if create_workflow:
                from apps.workflow.services import WorkflowService
                WorkflowService.create_from_judgment(judgment, skip_node_orders=skip_node_orders, picked_by=by)

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

            # Step 5: the event row is part of the conclusion's record: written in the same transaction, so a
            # failed insert rolls the whole conclusion back and reaches the caller (tests/test_event_log_*).
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

    @classmethod
    def admitted_in_concluded_case(cls, record) -> bool:
        """Whether a concluded case of this soul's life weighed `record` as evidence: a merit / demerit record of
        the case's soul and life, on the books when the verdict came, and not ruled not-admitted there. Such a record
        is part of a decided case and no longer edited (user 2026-10-29, item 19); a wrong one is corrected through
        reopening or a settlement correction."""
        from apps.judgment.models import EvidenceAdmission, Judgment

        if record.record_type not in cls.SCORED_TYPES:
            return False
        cases = Judgment.all_objects.filter(
            soul_id=record.soul_id, cycle=record.cycle, verdict__isnull=False, is_deleted=False,
        ).exclude(concluded_at__lt=record.create_time)
        refused = EvidenceAdmission.objects.filter(record=record, admitted=False).values("judgment_id")
        return cases.exclude(pk__in=refused).exists()

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
        # 埃及:天平此刻给的裁决(docs/02 §5)—— 审判台据此预选,`conclude/` 不收与它相反的裁决。
        from apps.judgment import weighing

        if weighing.applies(judgment):
            reading = weighing.scale(judgment)
            result["weighing"] = {
                "heart_weight": reading["heart_weight"], "counterweight": reading["counterweight"],
                "heavier_than_feather": reading["heavier_than_feather"],
                "weighed_verdict": weighing.weighed_verdict(reading),
            }
        return result

    @classmethod
    def admitted_net(cls, judgment) -> int | None:
        """Admitted merit − demerit for this case, for every cosmology; None
        when the case is not from the soul's current life."""
        from apps.ledger.services import LedgerService

        return LedgerService.get_admitted_net(judgment.soul, judgment.cycle, cls.not_admitted_ids(judgment))


class JudgmentDraftService:
    """Autosave of the verdict text (`notes`), the chosen verdict, and the
    「戊 · 发落」 choice (destination realm, term, eternal).

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

    FIELDS = ("notes", "draft_verdict", "draft_destination_realm_id", "draft_term_years", "draft_eternal")

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
        # 写判词草稿也是进展:这里不走 `Judgment.save()`,所以滞留标记要在这里一并清掉。
        values = dict(changes, draft_saved_at=now, update_time=now, stale_since=None,
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


# ── Opening a case ───────────────────────────────────────────────────────────


class OpenCaseRefusedError(Exception):
    """`code`: `not_in_tenant` / `open_case` / `cannot_enter_judgment`; `open_ids` for `open_case`."""

    def __init__(self, message, code, open_ids=()):
        super().__init__(message)
        self.code, self.open_ids = code, list(open_ids)


def enter_judgment_realm(soul, judgment):
    """The soul stands in the court its open ORIGINAL case is heard in.

    Only an open case (no verdict yet): a concluded one whose `realm` is
    corrected afterwards says where the case *was* heard, and the soul has
    since moved on. Only ORIGINAL: an AMENDMENT is heard while the soul serves
    a sentence plan stop, and a REOPEN while it is DISPOSED — in both the soul
    is in its sentence realm, and whether a retrial walks it back to a court is
    an open question (云端报告 realm-path-fields(已移出仓库,存于项目记忆目录)), not something to
    decide here. A case with no realm writes nothing.
    """
    from apps.judgment.models import JudgmentKind
    from apps.realms.path import SoulPathService

    if judgment.realm_id is None or judgment.verdict is not None or judgment.kind != JudgmentKind.ORIGINAL:
        return
    SoulPathService.enter(soul, judgment.realm, tenant_id=judgment.tenant_id)


class JudgmentService:
    @staticmethod
    def open_case(soul, *, actor=None, in_tenant=None, tenant=None, **fields):
        """Open one case for `soul` under its row lock; the rules every case-opening door shares
        (cq-backend 第 8 条, 2026-10-30; used by `POST /judgment/` and a sentence plan's REOPEN).

        * `in_tenant`: refuse unless the soul is in that hall *now*, under the lock (G7, sentence-plan §8).
        * One open case per soul, asked under the same lock; ADMIN is exempt (2026-09-12: it repairs a stuck case).
        * `tenant` (default: the soul's hall at lock time) is where the case is filed.
        * No `kind` given and the soul serves a sentence plan: an AMENDMENT of that plan (§4.1), decided here, not
          by the caller.
        * A living soul: opening it is a death recorded today — the 枉死城 / 城隍 columns `Soul.die` writes, the
          JUDGING transition, and the 城隍 notice (2026-10-27, review #7).

        Not used by `Soul.die` (the death registration is itself the transition and writes its own opening fields
        from the recorded death date), nor by `weighing.open_retrial` (opened inside the conclusion of the case it
        hears again, which is still the open one at that moment).
        """
        from apps.judgment.models import Judgment, JudgmentKind, open_judgments
        from apps.sentence_plan.services import in_progress_plan
        from apps.souls.models import Soul

        with transaction.atomic():
            soul = Soul.lock(soul.pk)
            if in_tenant is not None and soul.tenant_id != in_tenant.pk:
                raise OpenCaseRefusedError("No such soul in this tenant.", "not_in_tenant")
            if getattr(actor, "role", None) != "ADMIN":
                open_ids = [str(pk) for pk in open_judgments(soul).values_list("pk", flat=True)]
                if open_ids:
                    raise OpenCaseRefusedError(
                        "This soul already has an open case. Conclude it before opening another.", "open_case", open_ids)
            if "kind" not in fields:
                plan = in_progress_plan(soul)
                if plan is not None:
                    fields.update(kind=JudgmentKind.AMENDMENT, amends_plan_id=plan.pk)
            was_alive = soul.current_state == SoulState.ALIVE
            if was_alive:
                fields.update(soul.opening_fields(timezone.now().date()))
            judgment = Judgment.objects.create(soul=soul, tenant=tenant or soul.tenant, **fields)
            if was_alive:
                from apps.judgment import city_gods

                if not soul.transition_to(SoulState.JUDGING, f"Judgment {judgment.id} initiated"):
                    raise OpenCaseRefusedError(
                        f"The soul is {soul.current_state}; it cannot enter judgment.", "cannot_enter_judgment")
                city_gods.received(judgment)
            enter_judgment_realm(soul, judgment)
            return judgment
