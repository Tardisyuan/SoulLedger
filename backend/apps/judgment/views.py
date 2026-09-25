"""
REST views for Judgment app.
"""
import uuid

from django.db.models import Case, Count, IntegerField, Q, Value, When
from django_filters import rest_framework as filters
from django_filters.utils import translate_validation
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import APIException
from rest_framework.filters import SearchFilter
from rest_framework.response import Response

from apps.core.archive import DeletionNotAllowedError
from apps.core.mixins import TenantCreateMixin, TenantQuerySetMixin
from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.request_local import clear_current_user, set_current_request, set_current_user
from apps.core.tenant import scope_to_tenant
from apps.core.viewsets import AuditUserViewSetMixin, CodenameViewSetMixin, DataScopeViewSetMixin
from apps.disposition.destination import DestinationRefusedError, destination_options, inapplicable_destinations
from apps.disposition.services import DispositionService
from apps.judgment import claims
from apps.judgment.claims import ClaimRefusedError
from apps.judgment.models import Judgment, JudgmentKind, Statute, Verdict
from apps.judgment.precedents import DEFAULT_LIMIT as DEFAULT_PRECEDENTS
from apps.judgment.precedents import MAX_LIMIT as MAX_PRECEDENTS
from apps.judgment.precedents import precedents_for
from apps.judgment.serializers import (
    AssignableOfficerSerializer,
    EvidenceRulingResultSerializer,
    EvidenceRulingWriteSerializer,
    JudgmentBatchResultSerializer,
    JudgmentBatchSerializer,
    JudgmentCitationSerializer,
    JudgmentCitationWriteSerializer,
    JudgmentClaimRefusalSerializer,
    JudgmentConcludeSerializer,
    JudgmentCourtSerializer,
    JudgmentDeferSerializer,
    JudgmentDestinationOptionSerializer,
    JudgmentDestinationsSerializer,
    JudgmentDetailSerializer,
    JudgmentDraftConflictSerializer,
    JudgmentDraftSerializer,
    JudgmentDraftWriteSerializer,
    JudgmentPrecedentSerializer,
    JudgmentQueueCountsSerializer,
    JudgmentQueueCursorSerializer,
    JudgmentRateLimitedSerializer,
    JudgmentReassignRequestResultSerializer,
    JudgmentReassignSerializer,
    JudgmentSerializer,
    QueueGroup,
    StatuteSerializer,
)
from apps.judgment.services import (
    CitationRefusedError,
    DraftConflictError,
    EvidenceAdmissionService,
    EvidenceRefusedError,
    JudgmentDraftService,
    JudgmentFrozenError,
    JudgmentNotConcludableError,
    StatuteCitationService,
)
from apps.ledger.services import LedgerService
from apps.realms.models import Realm
from apps.realms.serializers import RealmLocalizedSerializer
from apps.reincarnation.serializers import ReincarnationSerializer
from apps.sentence_plan.requests import PlanChangeRefusedError
from apps.sentence_plan.services import CrossJudgmentOpenError
from apps.souls.models import SoulState
from apps.souls.serializers import SoulSerializer

#: Upper bound on how many ids a caller may ask us to skip in one request.
#: The skip set is session state the *client* holds (see `next_pending`), so
#: it arrives on every poll and would otherwise grow without limit into the
#: `NOT IN (...)` clause. 200 is well past any single sitting at a queue.
QUEUE_SKIP_LIMIT = 200


#: 「未结案」在队列里的定义。与 `_pending_queue` 同一组列,写一次。
PENDING = Q(verdict__isnull=True, is_final=False, is_archived=False)


def group_q(group: str, user) -> Q:
    """一个队列组的谓词(不含 `PENDING`)。四个组互斥:暂缓优先,其余按认领人分。"""
    not_deferred = Q(deferred_at__isnull=True)
    if group == QueueGroup.MINE:
        return not_deferred & Q(claimed_by=user)
    if group == QueueGroup.UNCLAIMED:
        return not_deferred & Q(claimed_by__isnull=True)
    if group == QueueGroup.OTHERS:
        return not_deferred & Q(claimed_by__isnull=False) & ~Q(claimed_by=user)
    if group == QueueGroup.DEFERRED:
        return Q(deferred_at__isnull=False)
    raise ValueError(group)


class JudgmentFilter(filters.FilterSet):
    """Custom filter for Judgment - handles verdict=null for pending judgments."""
    has_verdict = filters.BooleanFilter(field_name="verdict", lookup_expr="isnull", exclude=True)
    verdict_null = filters.BooleanFilter(field_name="verdict", lookup_expr="isnull")
    # 队列分组。**隐含「未结案」**:「待认领」问的是还有谁没人办,一件已结案、认领人
    # 为空的旧案子不在其中。
    group = filters.ChoiceFilter(choices=QueueGroup.CHOICES, method="filter_group")
    # 殿。`court` 是自由文本列(「第一殿」),按原值精确匹配。
    court = filters.CharFilter(field_name="court", lookup_expr="exact")
    # 引用了这条律条的判决(语料页「被引用」清单)。与 `StatuteViewSet` 的
    # `citation_count` 同一口径:存活的引用行,落在调用者看得见的判决上。
    statute = filters.UUIDFilter(method="filter_statute")

    class Meta:
        model = Judgment
        fields = ["soul", "civilization", "verdict", "is_final"]

    def filter_group(self, queryset, name, value):
        return queryset.filter(PENDING & group_q(value, self.request.user))

    def filter_statute(self, queryset, name, value):
        return queryset.filter(pk__in=citing_judgments(value))


def citing_judgments(statute_id):
    """Judgment ids with a live citation of this article — the list side of the
    corpus's 「被引用 N 件」. `StatuteViewSet.get_queryset` counts the same rows."""
    from apps.judgment.models import JudgmentCitation

    return JudgmentCitation.all_objects.filter(statute_id=statute_id, is_deleted=False).values("judgment_id")


def visible_judgments(request):
    """The judgments this caller's judgment LIST would show — tenant scope,
    residence reads and row-level DataScope, by running the list's own
    `get_queryset` rather than restating it. `citation_count` counts inside
    this set so the count and `?statute=` list cannot disagree."""
    view = JudgmentViewSet(request=request, action="list", kwargs={}, format_kwarg=None)
    return view.get_queryset().values("pk")


class NotesOnOpenCaseError(APIException):
    """`notes` on an open case goes through the draft endpoint (see `perform_update`)."""
    status_code = status.HTTP_409_CONFLICT
    default_code = "use_draft_endpoint"

    def __init__(self):
        super().__init__({
            "error": "The verdict text of an open case is saved through PATCH /judgment/{id}/draft/.",
            "code": "use_draft_endpoint",
        })


def _enter_judgment_realm(soul, judgment):
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


class JudgmentViewSet(CodenameViewSetMixin, TenantQuerySetMixin, DataScopeViewSetMixin, TenantCreateMixin, AuditUserViewSetMixin, viewsets.ModelViewSet):
    """
    Judgment CRUD + conclude action.
    Tenant-isolated via TenantPermission.
    """
    # CodenamePermission is what finally enforces the codenames below. Until it
    # was added they were declarative only: PermissionMiddleware never saw
    # self.action, so any role reaching this viewset with a tenant could open a
    # judgment proceeding against a soul — and perform_create then walks that
    # soul ALIVE -> JUDGING, so the write landed on two tables. GUARDIAN and
    # VIEWER hold no judgment.* codename at all and are now refused both the
    # list and the create. See apps/core/permissions.py for why middleware
    # could not do this.
    permission_classes = [TenantPermission, CodenamePermission]
    # The judgment family is read / create / execute — those three exist and
    # are granted; there is no judgment.update or judgment.delete anywhere, yet
    # this is a ModelViewSet and the mixin was generating both.
    #
    # They map to judgment.execute. The choice between judgment.execute and
    # judgment.create is not a guess and cannot go wrong: both are held by
    # exactly {ADMIN, JUDGE, MODERATOR}, so no role's access differs between
    # them. execute is the closer fit — amending or withdrawing a filed
    # judgment is an act on the case, and conclude already maps here.
    permission_codename = "judgment"
    extra_permissions = {
        'conclude': ['judgment.execute'],
        # Reading the head of the triage queue is a read. It deliberately does
        # NOT require judgment.execute: an operator who may look at the queue
        # but not rule on it still gets the screen, and the verdict button is
        # then the thing they cannot use — CodenameViewSetMixin's default for
        # an unmapped action would have generated `judgment.next_pending`,
        # which no role holds and no migration seeds, so the queue would have
        # 403'd for everyone including ADMIN.
        'next_pending': ['judgment.read'],
        # 上一件:与 next_pending 同一个队列、同一个读。
        'previous_pending': ['judgment.read'],
        # 「戊 · 发落」的候选目的地:只读,给判官挑;真正落判仍要 conclude 的 judgment.execute。
        'destinations': ['judgment.read'],
        'update': ['judgment.execute'],
        'partial_update': ['judgment.execute'],
        'destroy': ['judgment.execute'],
        'archive': ['judgment.execute'],
        # Reading the grounds is a read; entering or withdrawing one is an act
        # on the case, the same call `conclude` maps to. GET and POST share one
        # route (DRF `mapping`) but NOT one codename — declaring both on a
        # single action would make the cumulative check in CodenamePermission
        # demand judgment.execute in order to *read* the grounds, which is the
        # opposite of the split next_pending exists to preserve.
        'citations': ['judgment.read'],
        # 「据 · 先例」是读:给判官看的参考,不改任何东西。
        'precedents': ['judgment.read'],
        'cite_statute': ['judgment.execute'],
        'uncite': ['judgment.execute'],
        # Ruling evidence in or out and saving the verdict draft are part of
        # deciding the case, so they need exactly what `conclude` needs: the
        # officer who may conclude may do these, and nobody else. Same
        # codename, same tenant scoping through `get_object`.
        'rule_evidence': ['judgment.execute'],
        'save_draft': ['judgment.execute'],
        # 认领 / 释放 / 暂缓 / 撤销暂缓是办案人对自己手上的案子做的事,与结案同一码名。
        # 替别人释放或暂缓不另立码名:动作体里要求 `judgment.assign`(见 `_may_override`)。
        'claim': ['judgment.execute'],
        'release': ['judgment.execute'],
        'defer': ['judgment.execute'],
        'undefer': ['judgment.execute'],
        # 改派是分配别人的工作,比办案更严:`judgment.assign`,默认只 ADMIN 与 MODERATOR
        # (殿主)持有。JUDGE 有 `judgment.execute` 而没有它 —— 审判官之间不能互相派活。
        'reassign': ['judgment.assign'],
        # 改派弹层的名单:谁能被改派到这些案子上。问的人就是能改派的人。
        'assignable_officers': ['judgment.assign'],
        # 「请管理员改派」:名单空了时请 ADMIN 来改派。能办这件案子的人就能为它求助。
        'request_reassign': ['judgment.execute'],
        # 批量:与单件同一码名。`operation=reassign` 在动作体里再要 `judgment.assign` ——
        # 这里是静态表,看不见请求体。
        'batch': ['judgment.execute'],
        'queue_counts': ['judgment.read'],
        # 殿筛选的选项:与队列同一个读。
        'courts': ['judgment.read'],
    }
    queryset = (
        Judgment.objects
        .select_related("soul", "soul__tenant", "tenant", "judge", "claimed_by", "deferred_by")
        .prefetch_related("citations__statute", "citations__statute__source_actor")
        .all()
    )
    serializer_class = JudgmentSerializer
    filterset_class = JudgmentFilter
    # 按灵魂名(包含)或 id(灵魂的或案子的,精确)搜。`=` 是 iexact,对 UUID 列
    # 不经 `get_prep_value`,所以一个不是 UUID 的词只是匹配不到,不会 500。
    search_fields = ["soul__name", "=soul__id", "=id"]
    # 暂居只读例外(apps/core/tenant.py)。不含 `next_pending`:那是待办队列,
    # 原属租户对暂居地的案子什么都做不了。
    residence_read_actions = ("list", "retrieve", "citations")
    ordering_fields = ["created_at", "concluded_at"]

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action == "retrieve":
            qs = qs.prefetch_related("evidence_admissions")
        return qs

    def get_serializer_class(self):
        # Detail only: the admitted balance walks the soul's ledger.
        if self.action == "retrieve":
            return JudgmentDetailSerializer
        return super().get_serializer_class()

    def perform_create(self, serializer):
        # `super()`, not a bare `serializer.save()`.
        #
        # This class lists TenantCreateMixin among its bases, which is why the
        # omission read as harmless — but overriding `perform_create` without
        # chaining took the mixin out of the call path entirely, so every
        # Judgment was written with `tenant = NULL`. The column is `null=True`,
        # so nothing complained; the row simply became invisible to its own
        # tenant, because `scope_to_tenant` filters `tenant=X` and NULL matches
        # no tenant. Measured 2026-09-07: non-ADMIN创建后 list / next / conclude
        # 全部 404, while `soul.transition_to(JUDGING)` below had already moved
        # the soul out of ALIVE — a case nobody in that tenant could close.
        #
        # `tests/test_judgment_api.py` did not catch it because both of its
        # clients are ADMIN, and ADMIN bypasses scoping.
        #
        # G7 (docs/ARCHITECTURE-sentence-plan.md §8): the serializer's two
        # checks — the soul is in this tenant, and it has no open case — ran
        # without a lock, so a concurrent return home (`end_residence`, which
        # asks `open_judgments` under the soul row lock) could slip between
        # them and the insert: the soul goes home while a case is filed where
        # it no longer is. Both are asked again here, under the same lock.
        from django.db import transaction
        from rest_framework.exceptions import ValidationError

        from apps.core.tenant import is_tenant_exempt
        from apps.judgment.models import open_judgments
        from apps.souls.models import Soul

        with transaction.atomic():
            soul = Soul.all_objects.select_for_update(of=("self",)).get(pk=serializer.validated_data["soul"].pk)
            if not is_tenant_exempt(self.request.user):
                tenant = getattr(self.request, "tenant", None) or getattr(self.request.user, "tenant", None)
                if tenant is None or soul.tenant_id != tenant.pk:
                    raise ValidationError({"soul": ["No such soul in this tenant."]})
                if open_judgments(soul).exists():
                    raise ValidationError(
                        {"soul": ["This soul already has an open case. Conclude it before opening another."]}
                    )
            super().perform_create(serializer)
            judgment = serializer.instance
            # 受刑计划进行中的灵魂,这件案子是对计划的加 / 减项(情况 1,§4.1):结案生成请求,
            # 不建处置、不动灵魂状态。服务端定,不由 body 定。
            from apps.sentence_plan.services import in_progress_plan

            plan = in_progress_plan(soul)
            if plan is not None:
                from apps.judgment.models import Judgment, JudgmentKind

                Judgment.all_objects.filter(pk=judgment.pk).update(kind=JudgmentKind.AMENDMENT, amends_plan_id=plan.pk)
                judgment.kind, judgment.amends_plan_id = JudgmentKind.AMENDMENT, plan.pk
            if soul.current_state == SoulState.ALIVE:
                soul.transition_to(SoulState.JUDGING, f"Judgment {judgment.id} initiated")
            _enter_judgment_realm(soul, judgment)

    def perform_update(self, serializer):
        """Moving an open case to another court moves the soul there too (行程拓扑).

        `notes` is also the verdict draft (see `Judgment.draft_version`). On an
        OPEN case it is written only through `PATCH /judgment/{id}/draft/`
        (产品负责人 2026-09-25): the plain PATCH/PUT carrying `notes` is a 409
        `use_draft_endpoint` and writes nothing, because it has no version to
        check and would overwrite an autosave. On a concluded case the plain
        write is unchanged — it still moves the draft version.
        """
        from django.db import transaction

        instance = serializer.instance
        if "notes" in serializer.validated_data and instance.verdict is None and not instance.is_final:
            raise NotesOnOpenCaseError()

        with transaction.atomic():
            realm_before = serializer.instance.realm_id
            notes_before = serializer.instance.notes
            super().perform_update(serializer)
            judgment = serializer.instance
            if "notes" in serializer.validated_data and judgment.notes != notes_before:
                JudgmentDraftService.touch_after_plain_update(judgment)
            if judgment.realm_id != realm_before:
                _enter_judgment_realm(judgment.soul, judgment)

    def destroy(self, request, *args, **kwargs):
        """Soft-delete a pending judgment, or refuse with a clear reason
        once it carries a verdict (Stage 4 §4.7: archivable instead)."""
        judgment = self.get_object()
        reason = request.data.get("reason", "") if hasattr(request, "data") else ""
        try:
            judgment.delete_or_raise(user=request.user, reason=reason)
        except DeletionNotAllowedError as exc:
            return Response(
                {"error": str(exc), "archivable": exc.archivable},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def archive(self, request, pk=None):
        """Archive a judgment that carries a verdict and so cannot be
        deleted. See Judgment.can_delete."""
        judgment = self.get_object()
        if judgment.can_delete:
            return Response(
                {"error": "This judgment has no verdict; delete it instead of archiving."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        reason = request.data.get("reason", "")
        judgment.archive(user=request.user, reason=reason)
        return Response(JudgmentSerializer(judgment).data)

    def _pending_queue(self):
        """Every judgment awaiting a verdict that this caller may see, oldest first.

        Built on `self.get_queryset()` rather than on `Judgment.objects`, so
        the tenant isolation is exactly the one every other action on this
        viewset gets: DataScopeViewSetMixin.get_queryset() runs
        `apps.core.tenant.scope_to_tenant` (plus the row-level DataScope
        rules) and fails closed. Nothing below the viewset would scope this —
        TenantManager only applies `is_deleted=False`.

        FIFO on `created_at`, not the model's default `-created_at`: a queue a
        user works through must not reshuffle under them when someone else
        opens a new proceeding, and the oldest pending case is the one that has
        been waiting longest.
        """
        queue = self.get_queryset().filter(PENDING)
        # 暂缓的案子默认不在队列里 —— 暂缓的意思就是「现在别递给我」。
        # `?include_deferred=true` 显式要回它们(去「暂缓」组里处理某一件时)。
        if self.request.query_params.get("include_deferred", "").lower() not in ("1", "true", "yes"):
            queue = queue.filter(deferred_at__isnull=True)
        # `id` breaks created_at ties so `next/` and `previous/` walk one total order.
        return queue.order_by("created_at", "id")

    def _cursor_order(self, queue):
        """The one total order `next/` and `previous/` walk: the caller's own
        claimed cases (group `mine`) first, then everything else in the existing
        FIFO order (`created_at`, ties by `id`) — 产品负责人 2026-09-25."""
        return queue.annotate(
            not_mine_rank=Case(
                When(claimed_by=self.request.user, then=Value(0)), default=Value(1), output_field=IntegerField(),
            )
        ).order_by("not_mine_rank", "created_at", "id")

    def _before(self, judgment) -> Q:
        """Rows strictly before `judgment` in `_cursor_order` (needs its annotation)."""
        rank = 0 if judgment.claimed_by_id == self.request.user.pk else 1
        return (
            Q(not_mine_rank__lt=rank)
            | Q(not_mine_rank=rank, created_at__lt=judgment.created_at)
            | Q(not_mine_rank=rank, created_at=judgment.created_at, id__lt=judgment.id)
        )

    @staticmethod
    def _requested_skips(request):
        """The client's session-local skip set, from `?skip=` (repeatable, and
        comma-separated within one value).

        Skipping is deliberately NOT persisted. "Defer this one" is a statement
        about the operator's sitting, not about the case: nothing on the
        judgment changes, no audit row is written, and the item is back in the
        queue for the next person (or for the same person after a reload).
        Holding that state on the server would make it a data change, which is
        precisely what §4.2's "skip or defer" must not be.

        Unparseable ids are dropped rather than 400'd — the parameter is an
        optimisation of the caller's own view, and a stale or truncated entry
        should show the item again, never fail the request that renders it.
        """
        raw: list[str] = []
        for value in request.query_params.getlist("skip"):
            raw.extend(part.strip() for part in value.split(","))
        seen: list[uuid.UUID] = []
        for part in raw:
            if not part:
                continue
            try:
                seen.append(uuid.UUID(part))
            except (ValueError, AttributeError, TypeError):
                continue
            if len(seen) >= QUEUE_SKIP_LIMIT:
                break
        return seen

    @extend_schema(
        responses=JudgmentQueueCursorSerializer,
        parameters=[
            OpenApiParameter(
                "after", OpenApiTypes.UUID, OpenApiParameter.QUERY,
                description="The case the caller is on; the answer is the pending case just after it (「下一件」). "
                "Overrides `at`.",
            ),
            OpenApiParameter(
                "include_deferred",
                OpenApiTypes.BOOL,
                OpenApiParameter.QUERY,
                description="Also hand out deferred (暂缓) cases. Off by default.",
            ),
        ],
    )
    @action(detail=False, methods=["get"], url_path="next")
    def next_pending(self, request):
        """The next case to rule on, with everything needed to rule on it.

        `GET /api/v1/judgment/next/?skip=<id>&skip=<id>,<id>`

        BRIEF §4.2 decided a queue/triage mode over multi-select: each verdict
        is a judgement call, so the cost to remove is the cost of moving
        *between* items. The paginated list this app already had cannot do
        that — it answers "which judgments exist", not "what do I decide next
        and what do I need in front of me to decide it". Hence one response
        carrying the whole decision surface instead of the five round-trips
        (judgment, soul, ledger, prior cycles, realms) the detail page makes:

          judgment      — the proceeding itself (JudgmentSerializer)
          soul          — identity, dates, state, karmic_balance (SoulSerializer)
          ledger        — the merit/demerit reading, decayed, from
                          LedgerService.get_ledger_summary — the same body
                          /souls/{id}/karma/ returns
          prior_cycles  — previous reincarnations, newest first
          realm_options — the realms this soul's civilization can send it to

        Every one of those is an existing serializer/service called as-is;
        nothing here re-implements a read that already exists elsewhere.

        Order. The caller's own claimed cases (「我认领」) come first, oldest
        first; then the rest of the queue in FIFO order. `previous/` walks the
        same order backwards. Deferred cases stay out either way.

        Progress. `total` is how many cases are pending in scope right now,
        `remaining` how many of those the caller has not skipped, and
        `position` = total - remaining + 1, i.e. "the Nth of M". These are
        counts of live rows, so `total` falls by one each time a verdict lands
        — the client should latch the first `total` it sees if it wants a
        denominator that stays put for the sitting.

        An empty queue is a 200 with `judgment: null`, not a 404. "You are
        done" is a successful, renderable answer and the counts still matter
        (they say whether the queue was empty or merely skipped dry); a 404
        would drive the client's error boundary instead.
        """
        queue = self._pending_queue()
        total = queue.count()

        skips = self._requested_skips(request)
        remaining_qs = self._cursor_order(queue.exclude(id__in=skips) if skips else queue)
        remaining = remaining_qs.count()

        payload = {
            "total": total,
            "remaining": remaining,
            # What the caller actually skipped *within this scope* — not
            # len(skips), which would count ids that are already concluded,
            # deleted, or another tenant's.
            "skipped": total - remaining,
            "position": total - remaining + 1 if remaining else None,
            "judgment": None,
            "soul": None,
            "ledger": None,
            "prior_cycles": [],
            "realm_options": [],
        }

        # `?at=<id>` — enter the queue on a named case (the "open in the
        # judgment queue" link on a soul's lifecycle spine). It is a preference,
        # not a filter: an id that is concluded, deleted, skipped or another
        # tenant's simply falls through to the head of the queue rather than
        # 404ing, because the caller's intent ("work this queue, starting
        # here") is still satisfiable and the alternative is a dead end on a
        # link that was valid when the page rendered.
        cursor = remaining_qs.select_related("soul", "soul__tenant")
        if "after" in request.query_params:
            return self._after_response(payload, remaining_qs, cursor, total, remaining)
        at = request.query_params.get("at")
        judgment = None
        if at:
            try:
                judgment = cursor.filter(id=uuid.UUID(at)).first()
            except (ValueError, AttributeError, TypeError):
                judgment = None
            if judgment is not None:
                # Jumping the queue means `position` is no longer "the first
                # one left"; report where this case actually sits so N-of-M
                # stays true rather than convenient.
                ahead = remaining_qs.filter(self._before(judgment)).count()
                payload["position"] = total - remaining + ahead + 1
        if judgment is None:
            judgment = cursor.first()
        return self._cursor_response(payload, judgment)

    def _after_response(self, payload, remaining_qs, cursor, total, remaining):
        """`next/?after=<id>` — 「下一件」 from the desk: the pending case just after `after`
        in the same order `previous/` walks backwards. `?skip=X` alone cannot answer this:
        it hands out the head of the queue, which is only X's successor when X is the head.

        `after` is looked up in the caller's scope in any state (so 「下一件」 still works
        from a case just concluded), the same as `previous/?at=`; missing, malformed or
        not visible answers the empty cursor rather than 404.
        """
        payload["position"] = None
        try:
            anchor = self.get_queryset().filter(id=uuid.UUID(self.request.query_params.get("after", ""))).first()
        except (ValueError, AttributeError, TypeError):
            anchor = None
        judgment = None
        if anchor is not None:
            judgment = cursor.exclude(self._before(anchor)).exclude(id=anchor.id).first()
        if judgment is not None:
            ahead = remaining_qs.filter(self._before(judgment)).count()
            payload["position"] = total - remaining + ahead + 1
        return self._cursor_response(payload, judgment)

    def _cursor_response(self, payload, judgment):
        """Fill the cursor envelope with `judgment`'s decision surface (or leave it empty)."""
        if judgment is None:
            return Response(payload)

        request = self.request
        soul = judgment.soul
        context = self.get_serializer_context()
        payload["judgment"] = JudgmentSerializer(judgment, context=context).data
        payload["soul"] = SoulSerializer(soul, context=context).data
        payload["ledger"] = LedgerService.get_ledger_summary(soul)
        payload["prior_cycles"] = ReincarnationSerializer(
            soul.reincarnations.all().order_by("-cycle_count"),
            many=True,
            context=context,
        ).data
        # Realms are reference data but they are tenant-owned rows (RealmViewSet
        # scopes them the same way), so the options offered here go through the
        # same helper rather than being handed out unfiltered.
        realms = scope_to_tenant(
            Realm.objects.filter(civilization=soul.civilization), request
        )
        payload["realm_options"] = RealmLocalizedSerializer(
            realms.order_by("tier", "realm_code"), many=True, context=context
        ).data
        return Response(payload)

    @extend_schema(
        responses=JudgmentQueueCursorSerializer,
        parameters=[
            OpenApiParameter(
                "at", OpenApiTypes.UUID, OpenApiParameter.QUERY,
                description="The case the caller is on; the answer is the pending case just before it.",
            ),
            OpenApiParameter(
                "include_deferred",
                OpenApiTypes.BOOL,
                OpenApiParameter.QUERY,
                description="Also hand out deferred (暂缓) cases. Off by default.",
            ),
        ],
    )
    @action(detail=False, methods=["get"], url_path="previous")
    def previous_pending(self, request):
        """The pending case just before `?at=<id>` in queue order — 「上一件」.

        Same queue and order as `next/`: the same tenant/DataScope scoping, the
        caller's claimed cases first, then FIFO on `created_at` (ties by `id`),
        deferred cases left out unless
        `include_deferred`, `?skip=` honoured. `at` itself is looked up in the
        caller's scope in any state, so 「上一件」 still works from a case that
        has just been concluded. `at` missing, malformed, or not visible to the
        caller has no "before", and answers the empty cursor (`judgment: null`)
        rather than 404 — the same renderable "nothing there" `next/` gives.

        Not symmetric in one respect, deliberately: `next/?at=X` answers X
        itself (enter the queue on X), `previous/?at=X` answers the case before
        X. Moving forward from X is `next/?after=X`.
        """
        queue = self._pending_queue()
        total = queue.count()
        skips = self._requested_skips(request)
        remaining_qs = self._cursor_order(queue.exclude(id__in=skips) if skips else queue)
        remaining = remaining_qs.count()
        payload = {
            "total": total,
            "remaining": remaining,
            "skipped": total - remaining,
            "position": None,
            "judgment": None,
            "soul": None,
            "ledger": None,
            "prior_cycles": [],
            "realm_options": [],
        }
        try:
            anchor = self.get_queryset().filter(id=uuid.UUID(request.query_params.get("at", ""))).first()
        except (ValueError, AttributeError, TypeError):
            anchor = None
        judgment = None
        if anchor is not None:
            judgment = (
                remaining_qs.select_related("soul", "soul__tenant")
                .filter(self._before(anchor))
                .order_by("-not_mine_rank", "-created_at", "-id")
                .first()
            )
        if judgment is not None:
            ahead = remaining_qs.filter(self._before(judgment)).count()
            payload["position"] = total - remaining + ahead + 1
        return self._cursor_response(payload, judgment)

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "candidate_verdict", OpenApiTypes.STR, OpenApiParameter.QUERY, required=True,
                enum=[v.value for v in Verdict],
                description="The candidate verdict; only realms it can route to are listed.",
            ),
        ],
        responses=JudgmentDestinationsSerializer,
    )
    @action(detail=True, methods=["get"], url_path="destinations")
    def destinations(self, request, pk=None):
        """「戊 · 发落」's picker: where this case may be sent under `?candidate_verdict=`.

        The options are the realms of this judgment's tenant and civilization
        that the automatic routing can reach for that verdict — the same set
        `conclude` accepts as `destination_realm_id` (see
        apps/disposition/destination.py). Not an original judgment (amendment,
        reopen) → no options, since those conclude without a disposition.

        `default_realm_id` is where `conclude` sends the soul with no choice
        made: the automatic routing on the ledger *without* this case's
        non-admitted evidence (`DispositionService._route_to_realm`), so the
        picker's default is the conclusion's.
        """
        judgment = self.get_object()
        # Not `?verdict=`: that name is a JudgmentFilter field, and `get_object`
        # runs the filters — a pending case filtered by verdict=FAILED is a 404.
        verdict = request.query_params.get("candidate_verdict", "")
        if verdict not in Verdict.values:
            return Response(
                {"error": f"candidate_verdict must be one of {', '.join(Verdict.values)}", "code": "invalid_verdict"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        options = []
        not_applicable = []
        default_realm_id = None
        if judgment.kind == JudgmentKind.ORIGINAL:
            options = list(destination_options(judgment, verdict))
            not_applicable = list(inapplicable_destinations(judgment, verdict))
            default = DispositionService.route_realm(judgment.soul, verdict, judgment.judgment_method, judgment=judgment)
            if default is not None and any(r.pk == default.pk for r in options):
                default_realm_id = default.pk
        return Response({
            "verdict": verdict,
            "default_realm_id": default_realm_id,
            "default_term_years": None,
            "options": JudgmentDestinationOptionSerializer(
                options, many=True, context=self.get_serializer_context()).data,
            "not_applicable": JudgmentDestinationOptionSerializer(
                not_applicable, many=True, context=self.get_serializer_context()).data,
        })

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "limit", OpenApiTypes.INT, OpenApiParameter.QUERY,
                description=f"How many precedents (default {DEFAULT_PRECEDENTS}, at most {MAX_PRECEDENTS}).",
            ),
        ],
        responses=JudgmentPrecedentSerializer(many=True),
    )
    @action(
        detail=True, methods=["get"], url_path="precedents",
        # A bare ranked list: no page envelope, and the list's filters
        # (verdict, civilization, ...) do not apply — the ranking picks.
        pagination_class=None, filter_backends=[],
    )
    def precedents(self, request, pk=None):
        """Concluded judgments like this one — the judgment desk's 「据 · 先例」.

        `GET /api/v1/judgment/{id}/precedents/?limit=5`

        Same tenant and civilization as this judgment, ranked by same court,
        then closest balance **bucketed by 10** (`floor(balance / 10)`, so two
        precedents 2 and 8 away tie), then shared cited statutes — which is
        what breaks a tie inside a bucket — then newest conclusion. `balance`
        is the one frozen at conclusion (`concluded_balance`), or the soul's
        current balance for a case concluded before that column. The ranking
        and what is excluded are written down in apps/judgment/precedents.py.
        A bare array, not a page: it is a short ranked list, not a collection
        to walk.
        """
        judgment = self.get_object()
        try:
            limit = int(request.query_params.get("limit", DEFAULT_PRECEDENTS))
        except (TypeError, ValueError):
            return Response({"limit": ["Must be an integer."]}, status=status.HTTP_400_BAD_REQUEST)
        limit = max(1, min(limit, MAX_PRECEDENTS))
        rows = precedents_for(judgment, limit=limit)
        return Response(
            JudgmentPrecedentSerializer(rows, many=True, context=self.get_serializer_context()).data
        )

    # ------------------------------------------------------------------
    # Claim / release / reassign / defer (apps/judgment/claims.py)
    # ------------------------------------------------------------------

    def _may_override(self) -> bool:
        """能替别人释放、暂缓、改派 —— 即持有 `judgment.assign`。"""
        from apps.perm.checker import check_permission

        return check_permission(self.request.user, "judgment.assign")

    def _claim_response(self, run):
        """跑一个认领类动作;拒绝转成带 `code` 的响应,成功返回案子本身。

        `get_object()` 在前:它走 DataScopeViewSetMixin 的租户范围,别的租户的案子
        在这里就是 404,根本到不了行锁。
        """
        judgment = self.get_object()
        try:
            updated = run(judgment.pk)
        except ClaimRefusedError as exc:
            return Response(exc.as_payload(), status=exc.status)
        return Response(JudgmentSerializer(
            self.get_queryset().get(pk=updated.pk), context=self.get_serializer_context()
        ).data)

    _CLAIM_RESPONSES = {200: JudgmentSerializer, 403: JudgmentClaimRefusalSerializer, 409: JudgmentClaimRefusalSerializer}

    @extend_schema(request=None, responses=_CLAIM_RESPONSES)
    @action(detail=True, methods=["post"])
    def claim(self, request, pk=None):
        """认领这件案子。已被别人认领 → 409 `already_claimed`;重复认领自己的 → 200,不写。"""
        return self._claim_response(lambda pk: claims.claim(pk, request.user))

    @extend_schema(request=None, responses=_CLAIM_RESPONSES)
    @action(detail=True, methods=["post"])
    def release(self, request, pk=None):
        """释放认领。别人的认领只有持 `judgment.assign` 的人能释放(否则 403 `not_claimant`)。"""
        override = self._may_override()
        return self._claim_response(lambda pk: claims.release(pk, request.user, may_override=override))

    @extend_schema(
        request=JudgmentReassignSerializer,
        responses={**_CLAIM_RESPONSES, 400: JudgmentClaimRefusalSerializer},
    )
    @action(detail=True, methods=["post"])
    def reassign(self, request, pk=None):
        """改派给同一租户里能办案的另一位官员。`{"to": <user id>}`。"""
        serializer = JudgmentReassignSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        target = self._assignee(serializer.validated_data["to"])
        return self._claim_response(lambda pk: claims.reassign(pk, target))

    @extend_schema(request=JudgmentDeferSerializer, responses=_CLAIM_RESPONSES)
    @action(detail=True, methods=["post"])
    def defer(self, request, pk=None):
        """暂缓。`{"reason": "…"}` 必填。暂缓的案子默认不再出现在 `next/`。"""
        serializer = JudgmentDeferSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        reason = serializer.validated_data["reason"]
        override = self._may_override()
        return self._claim_response(
            lambda pk: claims.defer(pk, request.user, reason, may_override=override)
        )

    @extend_schema(request=None, responses=_CLAIM_RESPONSES)
    @action(detail=True, methods=["post"])
    def undefer(self, request, pk=None):
        """撤销暂缓,案子回到它按认领人所属的组。"""
        override = self._may_override()
        return self._claim_response(lambda pk: claims.undefer(pk, request.user, may_override=override))

    @extend_schema(
        responses={
            200: AssignableOfficerSerializer(many=True),
            400: OpenApiTypes.OBJECT,
            404: JudgmentClaimRefusalSerializer,
        },
        parameters=[
            OpenApiParameter(
                "judgment", OpenApiTypes.UUID, OpenApiParameter.QUERY, required=True, many=True,
                description="The case(s) about to be reassigned. Repeat for a batch (at most 100).",
            ),
        ],
    )
    # 不分页、不挂列表的过滤器:这里答的是人,不是案子,`court` / `search` 这些对它没有意义。
    @action(
        detail=False, methods=["get"], url_path="assignable-officers",
        pagination_class=None, filter_backends=[],
    )
    def assignable_officers(self, request):
        """改派弹层的名单:能被改派到这些案子上的官员 —— 与 `reassign` 校验对象用的是同一个
        `claims.is_assignable`,名单里的人改派必收,不在名单里的必拒。

        租户取自案子,不取自调用者:ADMIN 没有租户,案子有。案子要在 `self.get_queryset()`
        里 —— 与批量同一条范围,不在就整体 404 并列出 `missing`。一批跨了租户时没有人能
        接下全部,答空名单(批量改派也会逐件拒)。

        不分页、不搜索:一个租户的官员是几十人的量级,弹层要一次拿全;上了几百人再加 `search`。
        """
        from apps.authentication.models import User

        raw = request.query_params.getlist("judgment")
        ids = []
        for value in raw:
            try:
                ids.append(uuid.UUID(value))
            except ValueError:
                return Response({"judgment": [f"Not a UUID: {value!r}."]}, status=status.HTTP_400_BAD_REQUEST)
        if not ids or len(set(ids)) > claims.BATCH_LIMIT:
            return Response(
                {"judgment": [f"Give 1 to {claims.BATCH_LIMIT} judgment ids."]}, status=status.HTTP_400_BAD_REQUEST
            )

        tenants = dict(self.get_queryset().filter(pk__in=ids).values_list("pk", "tenant_id"))
        missing = [str(pk) for pk in ids if pk not in tenants]
        if missing:
            return Response(
                {"error": "Some judgments were not found.", "code": "not_found", "missing": missing},
                status=status.HTTP_404_NOT_FOUND,
            )
        tenant_ids = set(tenants.values())
        if len(tenant_ids) != 1:
            return Response([])
        # 调用者自己的租户范围再收一道:非 ADMIN 只可能看见自己租户的人。
        users = scope_to_tenant(User.objects.all(), request)
        tenant_id = tenant_ids.pop()
        officers = claims.assignable_officers(users, tenant_id)
        # 「在手」:每人手上认领着、还没结案的件数,与队列同一个 PENDING。一条聚合,不逐人查。
        in_hand = dict(
            Judgment.objects.filter(PENDING, tenant_id=tenant_id, claimed_by__in=officers)
            .order_by()
            .values_list("claimed_by")
            .annotate(n=Count("pk"))
        )
        for officer in officers:
            officer.in_hand = in_hand.get(officer.pk, 0)
        return Response(AssignableOfficerSerializer(officers, many=True).data)

    @extend_schema(
        request=None,
        responses={200: JudgmentReassignRequestResultSerializer, 429: JudgmentRateLimitedSerializer},
    )
    @action(detail=True, methods=["post"], url_path="request-reassign")
    def request_reassign(self, request, pk=None):
        """「请管理员改派」:改派名单空了(本殿没有别人能接),请案子所在租户的 ADMIN 来改派。

        `judgment.execute` 与 `get_object()` 的租户范围:能办这件案子的人才能为它求助。
        同一人对同一件案子 10 分钟一次,多了 429 `rate_limited` 带 `retry_after`。
        通知走 `claims.request_reassign`(既有的官员通知路径)。
        """
        import math
        import time

        from django.core.cache import cache

        judgment = self.get_object()
        key = f"judgment_reassign_request:{judgment.pk}:{request.user.pk}"
        until = time.time() + claims.REASSIGN_REQUEST_WINDOW_SECONDS
        # `add` is atomic: two clicks at once cannot both pass. The value is when the
        # window ends, because the cache API cannot read a key's remaining TTL.
        if not cache.add(key, until, timeout=claims.REASSIGN_REQUEST_WINDOW_SECONDS):
            held = cache.get(key)
            retry_after = max(1, math.ceil(held - time.time())) if held else claims.REASSIGN_REQUEST_WINDOW_SECONDS
            return Response(
                {"error": "Already asked for this case; try again later.", "code": "rate_limited",
                 "retry_after": retry_after},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
                headers={"Retry-After": str(retry_after)},
            )
        notified = claims.request_reassign(judgment, request.user)
        return Response({"notified": len(notified)})

    @staticmethod
    def _assignee(user_id):
        """改派对象。找不到就是 None,由 `claims.assert_assignable` 答 400 —— 与「在别的
        租户」同一句话,不在这里提前答出不同的状态码。"""
        from apps.authentication.models import User

        return User.objects.filter(pk=user_id).first()

    @extend_schema(
        request=JudgmentBatchSerializer,
        responses={
            200: JudgmentBatchResultSerializer,
            400: JudgmentClaimRefusalSerializer,
            403: JudgmentClaimRefusalSerializer,
            404: JudgmentClaimRefusalSerializer,
            409: JudgmentClaimRefusalSerializer,
        },
    )
    @action(detail=False, methods=["post"])
    def batch(self, request):
        """一次认领 / 改派 / 暂缓至多 100 件。**全有或全无。**

        `POST /judgment/batch/` `{"operation": "claim"|"reassign"|"defer", "ids": [...],
        "to": <user id>, "reason": "…"}`

        范围:每个 id 都必须在 `self.get_queryset()` 里 —— 与单件动作的 `get_object()`
        同一条租户范围。有任何一个不在(别的租户、已删除、不存在),整批 404,并在
        `missing` 里列出是哪些;不做「能做的先做」,因为那会让一次越权的请求改掉一部分。

        拒绝:任何一件被拒(已被别人认领、已结案…),整个事务回滚,响应带那件的 `id`。
        """
        serializer = JudgmentBatchSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        operation, ids = data["operation"], data["ids"]
        override = self._may_override()
        if operation == "reassign" and not override:
            return Response(
                {"error": "Permission denied: judgment.assign", "code": "permission_denied"},
                status=status.HTTP_403_FORBIDDEN,
            )

        visible = set(self.get_queryset().filter(pk__in=ids).values_list("pk", flat=True))
        missing = [str(pk) for pk in ids if pk not in visible]
        if missing:
            return Response(
                {"error": "Some judgments were not found.", "code": "not_found", "missing": missing},
                status=status.HTTP_404_NOT_FOUND,
            )

        target = self._assignee(data["to"]) if operation == "reassign" else None
        try:
            done = claims.batch(
                ids, operation, request.user,
                target=target, reason=data.get("reason", ""), may_override=override,
            )
        except ClaimRefusedError as exc:
            return Response(exc.as_payload(), status=exc.status)
        return Response({"operation": operation, "count": len(done), "ids": [str(j.pk) for j in done]})

    @extend_schema(
        responses=JudgmentQueueCountsSerializer,
        parameters=[
            OpenApiParameter("court", OpenApiTypes.STR, OpenApiParameter.QUERY, description="殿, exact."),
            OpenApiParameter(
                "search", OpenApiTypes.STR, OpenApiParameter.QUERY,
                description="Soul name (contains) or soul / judgment id (exact).",
            ),
        ],
    )
    @action(detail=False, methods=["get"], url_path="queue-counts")
    def queue_counts(self, request):
        """四个组各几件,一条查询。

        `court` 与 `search` 与列表同样生效(标签上的数跟着当前筛选走);`group` 被忽略。
        范围与列表相同:`self.get_queryset()`,即 DataScopeViewSetMixin 的租户范围。
        """
        params = request.query_params.copy()
        params.pop("group", None)
        filterset = JudgmentFilter(params, queryset=self.get_queryset().filter(PENDING), request=request)
        if not filterset.is_valid():
            raise translate_validation(filterset.errors)
        queryset = filterset.qs
        queryset = SearchFilter().filter_queryset(request, queryset, self)
        user = request.user
        counts = queryset.aggregate(
            total=Count("pk"),
            **{
                group: Count("pk", filter=group_q(group, user))
                for group, _label in QueueGroup.CHOICES
            },
        )
        return Response(counts)

    @extend_schema(responses=JudgmentCourtSerializer(many=True))
    # 不分页、不挂列表的过滤器:这是筛选条的选项,不随当前筛选收窄 —— 否则选了一个殿,
    # 下拉里就只剩那一个。
    @action(detail=False, methods=["get"], url_path="courts", pagination_class=None, filter_backends=[])
    def courts(self, request):
        """队列殿筛选的选项:调用者范围内出现过的每一个殿(非空),各带未结案件数。

        此前选项取自当前已加载的几页行,翻不到的殿就选不到。范围是 `self.get_queryset()`
        —— DataScopeViewSetMixin 经 `scope_to_tenant` 收到调用者的租户,与列表同一条。
        已结案件的殿也列出(`pending` 为 0):殿是场所,不因眼下没有案子而消失。
        """
        rows = (
            self.get_queryset()
            .exclude(court="")
            .order_by()
            .values("court")
            .annotate(pending=Count("pk", filter=PENDING))
            .order_by("court")
        )
        return Response(JudgmentCourtSerializer(rows, many=True).data)

    # ------------------------------------------------------------------
    # Cited grounds
    # ------------------------------------------------------------------

    @extend_schema(responses=JudgmentCitationSerializer(many=True))
    @action(
        detail=True,
        methods=["get"],
        url_path="citations",
        # The grounds of one judgment are a handful of rows and are returned
        # whole. Said explicitly because drf-spectacular documents any
        # `many=True` response on a paginated viewset as a page envelope,
        # and this action returns a bare array.
        pagination_class=None,
    )
    def citations(self, request, pk=None):
        """The articles this verdict rests on, in their corpus's own order.

        `GET /api/v1/judgment/{id}/citations/`

        Reached through `self.get_object()`, so the judgment is tenant-scoped
        by the same DataScopeViewSetMixin path as every other action here;
        citations hang off it and inherit that scope rather than being queried
        (and separately scoped) on their own.
        """
        judgment = self.get_object()
        return Response(
            JudgmentCitationSerializer(
                judgment.citations.select_related("statute", "statute__source_actor"),
                many=True,
                context=self.get_serializer_context(),
            ).data
        )

    @extend_schema(
        request=JudgmentCitationWriteSerializer,
        responses={201: JudgmentCitationSerializer},
    )
    @citations.mapping.post
    def cite_statute(self, request, pk=None):
        """Record one article as a ground of this judgment.

        `POST /api/v1/judgment/{id}/citations/` `{"statute": "<uuid>", "note": ""}`

        409, not 400, on a refusal about the judgment's *state* ("already
        concluded") — that is the same distinction `destroy` draws for an
        archivable judgment: the request is well-formed and the caller is
        allowed, the record is simply past the point where it accepts this.
        A refusal about the statute itself stays a 400.
        """
        judgment = self.get_object()
        serializer = JudgmentCitationWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            StatuteCitationService.assert_amendable(judgment)
        except CitationRefusedError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_409_CONFLICT)
        try:
            citation = StatuteCitationService.cite(
                judgment,
                serializer.validated_data["statute"],
                serializer.validated_data.get("note", ""),
            )
        except CitationRefusedError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(
            JudgmentCitationSerializer(citation, context=self.get_serializer_context()).data,
            status=status.HTTP_201_CREATED,
        )

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "statute_id",
                OpenApiTypes.UUID,
                OpenApiParameter.PATH,
                description=(
                    "The Statute to withdraw as a ground. Not inferable: the "
                    "generator resolves path parameters against the viewset's "
                    "model, and `Judgment` has no `statute_id` — the citation "
                    "is a row in between. Defaults to `string` without this."
                ),
            )
        ]
    )
    @action(
        detail=True,
        methods=["delete"],
        url_path=r"citations/(?P<statute_id>[^/.]+)",
    )
    def uncite(self, request, pk=None, statute_id=None):
        """Withdraw a ground from a judgment that has not been concluded."""
        judgment = self.get_object()
        try:
            StatuteCitationService.assert_amendable(judgment)
        except CitationRefusedError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_409_CONFLICT)
        try:
            removed = StatuteCitationService.uncite(judgment, statute_id)
        except CitationRefusedError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        if not removed:
            return Response(
                {"error": "This judgment does not cite that statute."},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)

    # ------------------------------------------------------------------
    # Evidence admission and the verdict draft
    # ------------------------------------------------------------------

    @extend_schema(
        request=EvidenceRulingWriteSerializer,
        responses={200: EvidenceRulingResultSerializer},
        parameters=[
            OpenApiParameter(
                "record_id",
                OpenApiTypes.UUID,
                OpenApiParameter.PATH,
                description="The ledger record (SoulRecord) being ruled on.",
            )
        ],
    )
    @action(detail=True, methods=["put"], url_path=r"evidence/(?P<record_id>[^/.]+)")
    def rule_evidence(self, request, pk=None, record_id=None):
        """Admit or not admit one ledger record as evidence in this case.

        `PUT /api/v1/judgment/{id}/evidence/{record_id}/`
        `{"admitted": false, "reason": "..."}` — a reason is required when not
        admitting. PUT because the ruling is a state, and repeating it is a
        no-op. 409 once the case is concluded; 400 for a record that is not
        evidence in this case (another soul's, another life's, another
        tenant's, or a non-scoring entry).
        """
        judgment = self.get_object()
        serializer = EvidenceRulingWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # A custom action is not `perform_*`, so AuditUserViewSetMixin does
        # not set the author for it; without this the row's create_user is None.
        set_current_user(request.user)
        set_current_request(request)
        try:
            admission = EvidenceAdmissionService.rule(
                judgment, record_id,
                serializer.validated_data["admitted"], serializer.validated_data.get("reason", ""),
            )
        except JudgmentFrozenError as exc:
            return Response({"error": str(exc), "code": "concluded"}, status=status.HTTP_409_CONFLICT)
        except EvidenceRefusedError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        finally:
            clear_current_user()
        return Response(EvidenceRulingResultSerializer({
            "admission": admission,
            "admitted_balance": EvidenceAdmissionService.admitted_balance(judgment),
        }).data)

    @extend_schema(
        request=JudgmentDraftWriteSerializer,
        responses={200: JudgmentDraftSerializer, 400: OpenApiTypes.OBJECT, 409: JudgmentDraftConflictSerializer},
    )
    @action(detail=True, methods=["patch"], url_path="draft")
    def save_draft(self, request, pk=None):
        """Autosave the verdict text (`notes`), the chosen verdict, and the
        「戊 · 发落」 choice (`draft_destination_realm_id` / `draft_term_years` /
        `draft_eternal`; cleared when the case is concluded).

        `PATCH /api/v1/judgment/{id}/draft/` `{"version": 3, "notes": "...",
        "draft_verdict": "FAILED"}` — `version` is the `draft_version` the
        caller last saw. 200 returns the stored draft with the new version and
        `draft_saved_at`; a save that changes nothing is a 200 no-op, so a
        retry is safe. 409 `draft_conflict` when someone saved first (the
        body carries what they saved), 409 `concluded` once the verdict is in.
        """
        judgment = self.get_object()
        serializer = JudgmentDraftWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        version = data.pop("version")
        realm_id = data.get("draft_destination_realm_id")
        # 草稿的界域也只能是结案时会收的那一类:本案租户、本文明、未软删。别的租户的界域与
        # 不存在的同一个回答(与 `resolve_placement` 的 realm_not_found 一样,不透露它存在)。
        if realm_id is not None and not Realm.objects.filter(
            pk=realm_id, tenant_id=judgment.tenant_id, civilization=judgment.soul.civilization,
        ).exists():
            return Response(
                {"draft_destination_realm_id": ["No such realm in this judgment's tenant."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        set_current_user(request.user)
        set_current_request(request)
        try:
            saved = JudgmentDraftService.save(judgment, version, data)
        except JudgmentFrozenError as exc:
            return Response(
                {"error": str(exc), "code": "concluded", "current": None},
                status=status.HTTP_409_CONFLICT,
            )
        except DraftConflictError as exc:
            return Response(
                {"error": str(exc), "code": "draft_conflict",
                 "current": JudgmentDraftSerializer(exc.judgment).data},
                status=status.HTTP_409_CONFLICT,
            )
        finally:
            clear_current_user()
        return Response(JudgmentDraftSerializer(saved).data)

    @extend_schema(
        request=JudgmentConcludeSerializer,
        responses={200: JudgmentSerializer, 409: JudgmentClaimRefusalSerializer},
    )
    @action(detail=True, methods=["post"])
    def conclude(self, request, pk=None):
        """
        Conclude a judgment with a verdict.
        Calls Judgment.conclude() which creates disposition and transitions soul to DISPOSED.
        Optionally creates an ApprovalWorkflow if create_workflow=true.

        `statute_ids` files the grounds with the verdict, in one transaction —
        an unciteable article aborts the whole conclusion rather than leaving a
        concluded judgment whose stated basis never landed.

        `destination_realm_id` / `term_years` / `eternal` (审判台「戊 · 发落」)
        are optional; none given = the automatic routing, unchanged. Refusals
        carry a `code`: realm_not_found, realm_not_allowed, realm_full (409),
        term_conflict, eternal_not_allowed, destination_not_applicable. There is
        no undo window: the conclusion is written when this call returns.
        """
        judgment = self.get_object()
        if judgment.is_final:
            return Response({"error": "Judgment already concluded"}, status=status.HTTP_400_BAD_REQUEST)

        serializer = JudgmentConcludeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        verdict = serializer.validated_data["verdict"]
        notes = serializer.validated_data.get("notes", "")
        create_workflow = serializer.validated_data.get("create_workflow", False)
        statute_ids = serializer.validated_data.get("statute_ids") or []
        plan_changes = serializer.validated_data.get("plan_changes") or None

        try:
            judgment.conclude(
                verdict, notes, create_workflow=create_workflow, statute_ids=statute_ids,
                plan_changes=plan_changes,
                destination_realm_id=serializer.validated_data.get("destination_realm_id"),
                term_years=serializer.validated_data.get("term_years"),
                eternal=serializer.validated_data.get("eternal"),
                by=request.user,
            )
        except ClaimRefusedError as exc:
            # 409 `claimed_by_other`:别人认领的案子,只有认领人、ADMIN、殿主能结。什么都没写。
            return Response(exc.as_payload(), status=exc.status)
        except DestinationRefusedError as exc:
            # 「戊 · 发落」选的门或刑期不成立。什么都没写(同一事务)。
            return Response({"error": str(exc), "code": exc.code}, status=exc.status)
        except PlanChangeRefusedError as exc:
            # 加减项 / 重开审判结案时对计划的改动被拒:什么都没写(同一事务)。
            return Response({"error": str(exc), "code": exc.code, **exc.extra}, status=exc.status)
        except CitationRefusedError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except CrossJudgmentOpenError as exc:
            # Q17:挂着的联审没结束(或它的节点内容不再通过校验)。什么都没写。
            return Response({"error": str(exc), "code": exc.code}, status=status.HTTP_409_CONFLICT)
        except JudgmentNotConcludableError as exc:
            # The soul cannot make the move a conclusion requires — it is not
            # under judgment. This used to be **silent**: `transition_to`'s
            # answer was dropped, so the endpoint answered 200 with a judgment
            # marked final, a disposition created, and a soul still ALIVE.
            # 400, not 500: the caller asked for something the case's state
            # does not allow, and the message says which state it is in.
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        judgment.refresh_from_db()
        return Response(
            JudgmentSerializer(judgment, context=self.get_serializer_context()).data
        )


class StatuteViewSet(CodenameViewSetMixin, TenantQuerySetMixin, DataScopeViewSetMixin,
                     viewsets.ReadOnlyModelViewSet):
    """The articles a verdict can be founded on — read-only reference data.

    Read-only on purpose. These rows are seeded from documents whose provenance
    is recorded on every row (`source`, `source_notes`); an API that let an
    operator type a new "冥律 article" would produce exactly the fabricated
    statutes this feature was specified not to have. Corrections go through
    `manage.py seed_mythology --update`, next to the text they came from.

    `permission_codename = "judgment"` rather than a new `statute.*` family:
    reading the rulebook is part of reading a case, the codename is already
    defined and granted, and inventing `statute.read` would seed an orphan no
    role holds (apps/perm/test_codename_coverage.py catches exactly that).
    """
    permission_classes = [TenantPermission, CodenamePermission]
    permission_codename = "judgment"
    queryset = Statute.objects.select_related("source_actor", "tenant").all()
    serializer_class = StatuteSerializer
    filterset_fields = ["civilization", "corpus", "polarity", "code"]
    search_fields = ["code", "title_zh", "title_en", "text_zh", "text_en"]
    ordering_fields = ["ordinal", "code", "citation_count"]

    def get_queryset(self):
        """Scoped articles, each carrying how many times *this tenant* cited it.

        The corpus browser ranks articles by how often they have actually been
        relied on, which is the one number that separates a rulebook from a
        list. It has to be an annotation: `JudgmentCitation` is a through-model
        with its own rows, so there is nothing on `Statute` to read it from.

        `super()` is `TenantQuerySetMixin`, so the article rows are scoped
        through `apps/core/tenant.py` — `tests/test_tenant_scoping_contract.py`
        walks every routed viewset and fails a tenant-bearing model whose
        `get_queryset` does not. The annotation needs its own filter for a
        reason that scoping the queryset does not cover: a reverse aggregate is
        resolved against the relation, not through the related model's manager,
        so a bare `Count("citations")` would report every tenant's citations on
        a correctly-scoped row.

        The filter is **the caller's judgment list**, not only its tenant
        (`visible_judgments`): the corpus rail shows 「被引用 N 件」 next to the
        list `GET /judgment/?statute=<id>` returns, and a row-level DataScope
        that hides some of this tenant's judgments must shrink the number too.
        A tenant-only filter counted judgments the list would never show. It
        subsumes the tenant filter this used to carry (`tenant_aggregate_filter`):
        a judgment outside the caller's tenant is not in the list either.
        Counted as distinct judgments, which is what the list returns.

        `distinct=True` because `filterset_fields`/`search_fields` can add a
        join before the aggregate runs, and a multiplied join silently inflates
        a COUNT rather than failing.

        `order_by` restates `Statute.Meta.ordering` because **`annotate()` with
        an aggregate discards it**. Django drops the model default rather than
        let it join the GROUP BY, so the annotated queryset comes back with
        `.ordered == False` and no ORDER BY in the SQL — measured, not assumed.
        Un-ordered pagination is not a cosmetic warning: page 2 of the corpus
        is computed from a fresh LIMIT/OFFSET over a set the database may order
        differently each time, so articles repeat on one page and vanish from
        another. With 172 rows and a browser that pages through them, that is
        the whole feature. Keep this list identical to `Meta.ordering`;
        `tests/test_judgment_statutes.py::TestCitationCount` pins the pair.
        """
        return (
            super()
            .get_queryset()
            .annotate(
                citation_count=Count(
                    "citations__judgment",
                    filter=Q(
                        citations__is_deleted=False,
                        citations__judgment__in=visible_judgments(self.request),
                    ),
                    distinct=True,
                )
            )
            .order_by(*Statute._meta.ordering)
        )
