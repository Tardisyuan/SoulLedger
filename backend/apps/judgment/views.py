"""
REST views for Judgment app.
"""
import uuid

from django.db.models import Count, Q
from django_filters import rest_framework as filters
from django_filters.utils import translate_validation
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.filters import SearchFilter
from rest_framework.response import Response

from apps.core.archive import DeletionNotAllowedError
from apps.core.mixins import TenantCreateMixin, TenantQuerySetMixin
from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.request_local import clear_current_user, set_current_request, set_current_user
from apps.core.tenant import scope_to_tenant, tenant_aggregate_filter
from apps.core.viewsets import AuditUserViewSetMixin, CodenameViewSetMixin, DataScopeViewSetMixin
from apps.judgment import claims
from apps.judgment.claims import ClaimRefusedError
from apps.judgment.models import Judgment, Statute
from apps.judgment.precedents import DEFAULT_LIMIT as DEFAULT_PRECEDENTS
from apps.judgment.precedents import MAX_LIMIT as MAX_PRECEDENTS
from apps.judgment.precedents import precedents_for
from apps.judgment.serializers import (
    EvidenceRulingResultSerializer,
    EvidenceRulingWriteSerializer,
    JudgmentBatchResultSerializer,
    JudgmentBatchSerializer,
    JudgmentCitationSerializer,
    JudgmentCitationWriteSerializer,
    JudgmentClaimRefusalSerializer,
    JudgmentConcludeSerializer,
    JudgmentDeferSerializer,
    JudgmentDetailSerializer,
    JudgmentDraftConflictSerializer,
    JudgmentDraftSerializer,
    JudgmentDraftWriteSerializer,
    JudgmentPrecedentSerializer,
    JudgmentQueueCountsSerializer,
    JudgmentQueueCursorSerializer,
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

    class Meta:
        model = Judgment
        fields = ["soul", "civilization", "verdict", "is_final"]

    def filter_group(self, queryset, name, value):
        return queryset.filter(PENDING & group_q(value, self.request.user))


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
        # 批量:与单件同一码名。`operation=reassign` 在动作体里再要 `judgment.assign` ——
        # 这里是静态表,看不见请求体。
        'batch': ['judgment.execute'],
        'queue_counts': ['judgment.read'],
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

        `notes` is also the verdict draft (see `Judgment.draft_version`). A write
        to it through the plain PATCH/PUT moves the draft version too, so an
        autosave that loaded the old text is refused instead of overwriting.
        """
        from django.db import transaction

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
        return queue.order_by("created_at")

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
        remaining_qs = queue.exclude(id__in=skips) if skips else queue
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
                ahead = remaining_qs.filter(created_at__lt=judgment.created_at).count()
                payload["position"] = total - remaining + ahead + 1
        if judgment is None:
            judgment = cursor.first()
        if judgment is None:
            return Response(payload)

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
        then closest balance, then shared cited statutes. The ranking and what
        is excluded are written down in apps/judgment/precedents.py. A bare
        array, not a page: it is a short ranked list, not a collection to walk.
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
        responses={200: JudgmentDraftSerializer, 409: JudgmentDraftConflictSerializer},
    )
    @action(detail=True, methods=["patch"], url_path="draft")
    def save_draft(self, request, pk=None):
        """Autosave the verdict text (`notes`) and the chosen verdict.

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

    @action(detail=True, methods=["post"])
    def conclude(self, request, pk=None):
        """
        Conclude a judgment with a verdict.
        Calls Judgment.conclude() which creates disposition and transitions soul to DISPOSED.
        Optionally creates an ApprovalWorkflow if create_workflow=true.

        `statute_ids` files the grounds with the verdict, in one transaction —
        an unciteable article aborts the whole conclusion rather than leaving a
        concluded judgment whose stated basis never landed.
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
            )
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
        a correctly-scoped row. `tenant_aggregate_filter` is that filter, kept
        in the same module for the same reason the scoping is.

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
                    "citations",
                    filter=tenant_aggregate_filter(
                        self.request, field="citations__tenant"
                    ),
                    distinct=True,
                )
            )
            .order_by(*Statute._meta.ordering)
        )
