"""
REST views for dispatch app.
"""
from django.db import IntegrityError
from django.db.models import Prefetch
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.actors.models import Actor
from apps.core.exports import export_csv
from apps.core.idempotency import idempotent
from apps.core.permissions import CodenamePermission
from apps.core.request_local import clear_current_user, set_current_request, set_current_user
from apps.core.tenant import is_tenant_exempt
from apps.core.viewsets import AuditUserViewSetMixin, CodenameViewSetMixin, DataScopeViewSetMixin
from apps.dispatch.filters import CrossTenantJudgmentFilter, DispatchFilter
from apps.dispatch.models import (
    CrossTenantJudgment,
    CrossTenantJudgmentParticipant,
    DispatchRecord,
    DispatchStatus,
    JudgmentStatus,
    ParticipantRole,
)
from apps.dispatch.permissions import CrossJudgmentPartyPermission, DispatchPartyPermission
from apps.dispatch.serializers import (
    CrossTenantJudgmentCancelSerializer,
    CrossTenantJudgmentConcludeSerializer,
    CrossTenantJudgmentListSerializer,
    CrossTenantJudgmentOrderSerializer,
    CrossTenantJudgmentParticipateSerializer,
    CrossTenantJudgmentSentenceSerializer,
    CrossTenantJudgmentSerializer,
    DispatchCancelSerializer,
    DispatchDraftSerializer,
    DispatchRecordListSerializer,
    DispatchRecordSerializer,
    DispatchRejectSerializer,
    DispatchReturnSerializer,
    DispatchSubmitSerializer,
    SeatableActorSerializer,
)
from apps.dispatch.services import (
    CrossTenantJudgmentService,
    DispatchNotCancellableError,
    DispatchService,
    OrderLockedError,
    ResidenceReturnBlockedError,
    WorkflowRunningError,
)
from apps.perm.filters import DataScopeFilter
from apps.realms.serializers import RealmLocalizedSerializer
from apps.tenants.models import Tenant


def _refused(exc):
    """ValueError → 400 的响应体。带 `code` 的(`TargetHallClosedError`)一并写出,前端照 code 翻译。"""
    body = {"error": str(exc)}
    if getattr(exc, "code", None):
        body["code"] = exc.code
    return Response(body, status=status.HTTP_400_BAD_REQUEST)


def hide_others_drafts(qs, user):
    """草稿只给发起人看(ADMIN 例外)。别人的草稿从列表、历史、详情与每个详情动作里消失 ——
    `get_object` 读的就是这里,所以对别人的草稿一律 404,不是 403(不承认它存在)。

    `~Q(dispatched_by=user)` 在可空外键上把 `dispatched_by IS NULL` 也算进「不是我的」:
    发起人账号删了的草稿,除 ADMIN 之外谁都看不见。
    """
    from django.db.models import Q

    if is_tenant_exempt(user):
        return qs
    return qs.exclude(Q(status=DispatchStatus.DRAFT) & ~Q(dispatched_by=user))


class DispatchRecordViewSet(CodenameViewSetMixin, DataScopeViewSetMixin, AuditUserViewSetMixin, viewsets.ModelViewSet):
    """
    DispatchRecord CRUD + actions.
    """
    # CodenamePermission is what finally enforces the codenames below; before
    # it, PermissionMiddleware never saw self.action and they gated nothing.
    #
    # This is the largest move in the tranche, and it is JUDGE that carries it.
    # JUDGE holds no dispatch codename at all — not read, not manage, not any
    # of the three approval actions — so both viewsets close to it entirely,
    # the list included. VIEWER likewise. dispatch.manage is held by ADMIN,
    # MODERATOR and GUARDIAN; dispatch.approve/.reject/.execute by ADMIN and
    # MODERATOR only, so GUARDIAN keeps proposing and editing and loses the
    # three decisions.
    #
    # The two read moves (GET on this viewset and on CrossTenantJudgmentViewSet,
    # 200 -> 403 for JUDGE and VIEWER) are recorded in
    # apps/perm/test_matrix_snapshot.py::READ_MATRIX, not in the write
    # instrument — which is why the write instrument's prediction of 34 was
    # exact and still not the whole tranche. Note that adopting the unused
    # cross_judgment.* family, flagged as an open decision on the viewset
    # below, would reverse the JUDGE half of both read rows.
    #
    # CLOSED: those three denials WERE walkable around. `status` used to be
    # writable on DispatchRecordSerializer and partial_update maps to
    # dispatch.manage, so GUARDIAN could reach APPROVED, REJECTED and EXECUTED
    # through PATCH, and the record it left was FALSE rather than merely
    # unauthorized: the soul's tenant FK never moved, so a dispatch could read
    # EXECUTED for a soul that never changed hands. PATCH also skipped the
    # "only the target tenant may decide" guard below, which is not a
    # codename at all, and skipped the status state machine entirely.
    #
    # DispatchRecordSerializer now marks `status` and `dispatched_by`
    # read-only and its validate() turns an attempted PATCH of either into an
    # explicit 400 — see its docstring. Status can now only move through
    # approve()/reject()/execute() below, so the target-tenant and
    # transition_to() checks in those three methods are the only write path
    # for status there is; nothing has to duplicate them onto the model.
    #
    # See backend/tests/test_perm_write_snapshot_outside_matrix.py, "THE
    # DENIAL THAT CAN BE WALKED AROUND (dispatch)", for how this was
    # characterized before the fix, and its replacement assertions after.
    permission_classes = [DispatchPartyPermission, CodenamePermission]
    # BINARY read / manage, plus the three named approval actions. The dict
    # defines dispatch.read and dispatch.manage as the pair, then
    # dispatch.approve / .reject / .execute on top; it has never had a
    # create/update/delete family, so those three generated codenames existed
    # nowhere. They map to dispatch.manage — the codename that was defined to
    # mean "may alter dispatch records" — leaving approve/reject/execute as
    # the separate privileges they were meant to be.
    permission_codename = "dispatch"
    extra_permissions = {
        'proposed': ['dispatch.read'],
        'history': ['dispatch.read'],
        'export': ['dispatch.export'],
        'approve': ['dispatch.approve'],
        'reject': ['dispatch.reject'],
        'execute': ['dispatch.execute'],
        'return_home': ['dispatch.return'],
        # 草稿与界域选项都属于「发起」,与 create 同一权限。
        'create_draft': ['dispatch.manage'],
        'draft': ['dispatch.manage'],
        'submit': ['dispatch.manage'],
        # 发起方在对方批准前取消:与发起(create)同一权限。
        'cancel': ['dispatch.manage'],
        'realm_options': ['dispatch.manage'],
        'create': ['dispatch.manage'],
        'update': ['dispatch.manage'],
        'partial_update': ['dispatch.manage'],
        'destroy': ['dispatch.manage'],
    }
    queryset = DispatchRecord.objects.select_related(
        "source_tenant", "target_tenant", "soul", "dispatched_by", "decided_by"
    ).all()
    filterset_class = DispatchFilter
    search_fields = DispatchFilter.search_fields
    ordering_fields = DispatchFilter.ordering_fields
    serializer_class = DispatchRecordSerializer

    def get_queryset(self):
        """Fresh queryset each call — avoids TenantManager stale class-attr filter.
        _base_manager is the *unfiltered* manager (all_objects is declared first
        on this model precisely so it takes that role), so reaching for it to
        dodge the contextvar issue also drops the soft-delete filter — deleted
        dispatch records kept appearing in the list. Exclude them explicitly
        rather than going back to `objects`, which would reintroduce the
        contextvar problem this override exists to solve.

        Using _base_manager also means this bypasses DataScopeViewSetMixin's
        tenant filtering entirely (this viewset only lists DataScopeViewSetMixin
        among its bases for the mixin's other behavior — get_queryset is fully
        overridden here), so tenant scoping has to be reapplied explicitly: a
        non-ADMIN could otherwise list every tenant's dispatch records via plain
        GET. A DispatchRecord is inherently cross-tenant (a soul mid-transfer),
        so "the caller's tenant is involved" means either side of the transfer —
        source or target — matching the "only source/target tenant" checks the
        approve/reject/execute actions below already enforce at the object
        level. ADMIN keeps the unfiltered view, consistent with every other
        list in this codebase.
        """
        from django.db.models import Q

        qs = DispatchRecord._base_manager.filter(is_deleted=False).select_related(
            "source_tenant", "target_tenant", "soul", "dispatched_by", "decided_by"
        )
        user = self.request.user
        if is_tenant_exempt(user):
            return qs
        tenant = getattr(self.request, "tenant", None)
        if not tenant:
            return qs.none()
        # The data scope too (BD-10): the mixin this viewset lists never
        # runs, because this method replaces it rather than calling super().
        qs = qs.filter(Q(source_tenant=tenant) | Q(target_tenant=tenant))
        qs = hide_others_drafts(qs, user)
        return DataScopeFilter.filter_queryset(self.request, qs, DispatchRecord)

    def get_serializer_class(self):
        if self.action == "list":
            return DispatchRecordListSerializer
        return DispatchRecordSerializer

    @idempotent
    def create(self, request, *args, **kwargs):
        """
        Route creation through DispatchService.propose() instead of the
        default ModelViewSet.create() -> serializer.save() path, so the
        business checks it runs (soul belongs to source_tenant, no active
        dispatch for the soul) are enforced before hitting the DB, and its
        side effects (dispatched_by/status/tenant set correctly, target-tenant
        notification, SoulEvent log) actually happen. dispatched_by and status
        are ignored if present in the request body — propose() always sets
        dispatched_by=request.user and status=PROPOSED, so they can't be
        spoofed via payload.

        The app-level "no active dispatch" check in propose() can't fully
        replace the DB's unique_active_dispatch constraint (models.py:86-91):
        two concurrent requests for the same soul can both pass the app-level
        check before either commits, so the DB constraint is still the source
        of truth. IntegrityError from that race is caught here and turned
        into the same 400 response as the ordinary duplicate case.
        """
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        validated = serializer.validated_data

        # BD-02: the source tenant is the requester's, not whatever the body
        # says. `propose()` checks that the soul belongs to `source_tenant`,
        # and that was the only check — so a MODERATOR could name another
        # tenant as source, its soul as the soul, and itself as target, then
        # approve and execute as the target. Three requests, every one 2xx,
        # and the soul was theirs. A transfer is proposed by the tenant that
        # holds the soul; ADMIN keeps the global exemption. 403 like the party
        # checks on approve/reject/execute below, which this is one of.
        if not is_tenant_exempt(request.user):
            requester_tenant = getattr(request, "tenant", None) or getattr(request.user, "tenant", None)
            source = validated.get("source_tenant")
            if requester_tenant is None or source is None or source.pk != requester_tenant.pk:
                return Response(
                    {"error": "Only the tenant that holds the soul may propose its dispatch"},
                    status=status.HTTP_403_FORBIDDEN,
                )

        # Q3:受刑计划进行中的灵魂只能走计划(系统按节点发起调拨);无计划的照旧可手动调拨。
        from apps.sentence_plan.services import in_progress_plan

        soul = validated.get("soul")
        if soul is not None and in_progress_plan(soul) is not None:
            return Response(
                {"error": "This soul has a sentence plan in progress; dispatches follow the plan",
                 "code": "sentence_plan_active"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        set_current_user(request.user)
        set_current_request(request)
        try:
            dispatch_record = DispatchService.propose(
                validated.get("source_tenant"),
                validated.get("target_tenant"),
                validated.get("soul"),
                request.user,
                validated.get("reason", ""),
                target_realm=validated.get("target_realm"),
            )
        except ValueError as e:
            return _refused(e)
        except IntegrityError:
            return Response(
                {"error": "An active dispatch already exists for this soul"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        finally:
            clear_current_user()

        output_serializer = DispatchRecordSerializer(dispatch_record, context=self.get_serializer_context())
        headers = self.get_success_headers(output_serializer.data)
        return Response(output_serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def destroy(self, request, *args, **kwargs):
        """只有草稿能删(= 放弃)。其余状态答 409 `not_a_draft`:此前 PROPOSED / APPROVED / EXECUTED 的记录
        DELETE 也是 204 并被删掉(2026-10-11 复现),绕过了状态机 —— 一条已批准 / 已执行的移交不该能这样消失;
        要结束一次移交,走 `cancel` / `reject` / `return-home`。"""
        instance = self.get_object()
        if instance.status != DispatchStatus.DRAFT:
            return Response(
                {"error": f"Only a draft can be deleted; this dispatch is {instance.status}", "code": "not_a_draft"},
                status=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)

    # CRUD 更新只剩 `reason` 能改(其余字段 `validate()` 拦),而理由是发起方写的:
    # 目标方能进 `get_object()` 是为了批 / 驳 / 执行,不是为了改对方的理由(此前目标方 PATCH 也是 200)。
    # `partial_update` 经由这里。ADMIN 照 `create` 豁免。注释而非 docstring:见上。
    def update(self, request, *args, **kwargs):
        record = self.get_object()
        if not is_tenant_exempt(request.user):
            tenant = self._requester_tenant(request)
            if tenant is None or record.source_tenant_id != tenant.pk:
                return Response({"error": "Only the proposing tenant may edit this dispatch"},
                                status=status.HTTP_403_FORBIDDEN)
        # 目标殿据以批准的理由,批准 / 执行之后不能再改(RBAC 严查 2026-10-29 L2)。ADMIN 也一样。
        if record.status not in (DispatchStatus.DRAFT, DispatchStatus.PROPOSED):
            return Response(
                {"error": f"The reason can no longer be edited; this dispatch is {record.status}",
                 "code": "reason_locked"},
                status=status.HTTP_409_CONFLICT,
            )
        return super().update(request, *args, **kwargs)

    def perform_destroy(self, instance):
        """放弃草稿 = 软删并记下是谁(`deleted_by`),进回收站(`apps/dispatch/apps.py` 注册了
        `dispatch_draft`),ADMIN 可从那里恢复。"""
        instance.soft_delete(user=self.request.user)

    @staticmethod
    def _not_target_or_403(request, record, verb):
        """批准 / 驳回 / 执行只给目标殿。无殿 ADMIN 视为满足(决定 25,与 `cancel`、`create` 一致)。"""
        # 绑殿 ADMIN 不算:它在别殿的提案上仍是第三方,不能借 ADMIN 身份替目标殿拍板。
        if is_tenant_exempt(request.user) and getattr(request.user, "tenant_id", None) is None:
            return None
        tenant = getattr(request, "tenant", None)
        if record.source_tenant != tenant and record.target_tenant != tenant:
            return Response({"error": "Not authorized to modify this dispatch"}, status=403)
        if record.target_tenant != tenant:
            return Response({"error": f"Only target tenant can {verb} dispatch"}, status=403)
        return None

    def _requester_tenant(self, request):
        return getattr(request, "tenant", None) or getattr(request.user, "tenant", None)

    def _own_draft_or_error(self, request, record):
        """草稿只由发起人改、提交。ADMIN 看得见别人的草稿,但不替人改。"""
        if record.status != DispatchStatus.DRAFT:
            return Response({"error": f"This dispatch is {record.status}, not a draft"},
                            status=status.HTTP_409_CONFLICT)
        if record.dispatched_by_id != request.user.pk:
            return Response({"error": "Only the person who saved a draft may change or submit it"},
                            status=status.HTTP_403_FORBIDDEN)
        return None

    @extend_schema(request=DispatchDraftSerializer, responses={201: DispatchRecordSerializer})
    @action(detail=False, methods=["post"], url_path="drafts")
    def create_draft(self, request):
        """存草稿(新建)。四个字段全可省;不进审批流、不通知任何人。来源是发起人自己的租户。"""
        tenant = self._requester_tenant(request)
        if tenant is None:
            return Response({"error": "No tenant context"}, status=status.HTTP_400_BAD_REQUEST)
        body = DispatchDraftSerializer(data=request.data, context={"request": request})
        body.is_valid(raise_exception=True)
        set_current_user(request.user)
        set_current_request(request)
        try:
            record = DispatchService.save_draft(
                None, source_tenant=tenant, dispatcher=request.user, **body.validated_data,
            )
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        finally:
            clear_current_user()
        return Response(DispatchRecordSerializer(record, context=self.get_serializer_context()).data, status=status.HTTP_201_CREATED)

    @extend_schema(request=DispatchDraftSerializer, responses=DispatchRecordSerializer)
    @action(detail=True, methods=["patch"])
    def draft(self, request, pk=None):
        """存草稿(改)。只改请求体里给了的字段;仍是草稿。"""
        record = self.get_object()
        refused = self._own_draft_or_error(request, record)
        if refused is not None:
            return refused
        body = DispatchDraftSerializer(data=request.data, context={"request": request, "draft": record})
        body.is_valid(raise_exception=True)
        set_current_user(request.user)
        set_current_request(request)
        try:
            record = DispatchService.save_draft(
                record, source_tenant=record.source_tenant, dispatcher=request.user, **body.validated_data,
            )
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        finally:
            clear_current_user()
        return Response(DispatchRecordSerializer(record, context=self.get_serializer_context()).data)

    @extend_schema(request=DispatchDraftSerializer, responses=DispatchRecordSerializer)
    @action(detail=True, methods=["post"])
    def submit(self, request, pk=None):
        """草稿提交审批:DRAFT → PROPOSED。请求体可带最后一次的表单内容(同存草稿的四个字段),
        先写上再校验;合起来要和直接发起(`create`)一样完整 —— 灵魂、目标文明、至少 20 字的理由。
        """
        record = self.get_object()
        refused = self._own_draft_or_error(request, record)
        if refused is not None:
            return refused
        merged = {
            "soul": record.soul_id,
            "target_tenant": record.target_tenant_id,
            "target_realm": record.target_realm_id,
            "reason": record.reason,
            **{k: request.data[k] for k in DispatchService.DRAFT_FIELDS if k in request.data},
        }
        body = DispatchSubmitSerializer(data=merged, context={"request": request, "draft": record})
        body.is_valid(raise_exception=True)

        from apps.sentence_plan.services import in_progress_plan

        if in_progress_plan(body.validated_data["soul"]) is not None:
            return Response(
                {"error": "This soul has a sentence plan in progress; dispatches follow the plan",
                 "code": "sentence_plan_active"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        set_current_user(request.user)
        set_current_request(request)
        try:
            record = DispatchService.submit(record, request.user, **body.validated_data)
        except ValueError as e:
            return _refused(e)
        except IntegrityError:
            return Response(
                {"error": "An active dispatch already exists for this soul"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        finally:
            clear_current_user()
        return Response(DispatchRecordSerializer(record, context=self.get_serializer_context()).data)

    @extend_schema(
        parameters=[
            OpenApiParameter("target_tenant_code", str, OpenApiParameter.QUERY, required=True,
                             description="The target civilization's tenant code."),
        ],
        responses=RealmLocalizedSerializer(many=True),
    )
    @action(detail=False, methods=["get"], url_path="realm-options", pagination_class=None, filter_backends=[])
    def realm_options(self, request):
        """目标文明里可作为移交目的地的界域(`DispatchService.eligible_realms`),供「目标界域」下拉。

        这是 `RealmViewSet` 之外唯一一处跨租户读界域的地方:只读、只给目标租户那一个文明的、
        `eligible_realms` 判定过的行。`display_name` 按 Accept-Language。
        """
        tenant = Tenant.objects.filter(code=request.query_params.get("target_tenant_code") or "").first()
        if tenant is None:
            return Response({"error": "Tenant not found"}, status=status.HTTP_404_NOT_FOUND)
        realms = DispatchService.eligible_realms(tenant)
        return Response(RealmLocalizedSerializer(realms, many=True, context={"request": request}).data)

    @staticmethod
    def _proposed_queryset(tenant):
        return DispatchRecord._base_manager.filter(
            target_tenant=tenant,
            status=DispatchStatus.PROPOSED,
            is_deleted=False,
        ).select_related("source_tenant", "soul", "dispatched_by").order_by("proposed_at")

    @staticmethod
    def _history_queryset(tenant, user):
        return hide_others_drafts(DispatchRecord._base_manager.filter(
            source_tenant=tenant,
            is_deleted=False,
        ), user).select_related("target_tenant", "soul").order_by("-proposed_at")

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "section", str, enum=["proposed", "history"], required=False,
                description="proposed = 待我审批 (the approval inbox), history = 我方发起的; omit for everything `list` returns",
            ),
        ],
        responses={(200, "text/csv"): OpenApiTypes.BINARY, 400: OpenApiTypes.OBJECT},
    )
    @action(detail=False, methods=["get"], url_path="export", pagination_class=None)
    def export(self, request):
        """导出当前列表(或 `?section=` 那一段)的 CSV:同一租户划界、同一筛选、同一权限(dispatch.read)。
        草稿仍只给发起人。列取自列表序列化器。"""
        section = request.query_params.get("section")
        if section in ("proposed", "history"):
            tenant = getattr(request, "tenant", None)
            if not tenant:
                return Response({"error": "No tenant context"}, status=status.HTTP_400_BAD_REQUEST)
            qs = (
                self._proposed_queryset(tenant) if section == "proposed"
                else self._history_queryset(tenant, request.user)
            )
        elif section:
            raise serializers.ValidationError({"section": ["proposed or history."]})
        else:
            qs = self.get_queryset()
        return export_csv(
            request,
            qs=self.filter_queryset(qs),
            serializer_class=DispatchRecordListSerializer,
            columns=[
                ("Dispatch ID", "id"), ("Soul", "soul_name"), ("From", "source_tenant_code"),
                ("To", "target_tenant_code"), ("Target Realm", "target_realm"), ("Status", "status"),
                ("Proposed At", "proposed_at"), ("Executed At", "executed_at"), ("Returned At", "returned_at"),
            ],
            filename="dispatch_export.csv",
            resource="dispatch",
        )

    @extend_schema(responses=DispatchRecordListSerializer(many=True))
    @action(detail=False, methods=["get"])
    def proposed(self, request):
        """
        Get pending proposals for the current tenant (as target).

        This is the approval inbox. `list` deliberately returns both sides of a
        transfer — you want to see your own outgoing proposals — but `approve`
        refuses anyone who is not the target, so a client that builds its
        approval queue from `list?status=PROPOSED` shows rows whose Approve
        button can only ever 403. Which is what `frontend/app/dispatch` did
        until it was pointed here. The predicate belongs on the server: a
        client should not have to know its own tenant code to ask "what is
        waiting on me".

        FIFO on `proposed_at`, against the model's default `-proposed_at`. Two
        reasons, the second of which is not optional: this is a work queue and
        the oldest proposal has waited longest (the same argument
        `JudgmentViewSet._pending_queue` records); and the queryset had no
        ordering at all, which under pagination means rows can repeat or vanish
        between pages.
        """
        tenant = getattr(request, "tenant", None)
        if not tenant:
            return Response({"error": "No tenant context"}, status=status.HTTP_400_BAD_REQUEST)

        # _base_manager (unfiltered) dodges the contextvar issue but also
        # drops the soft-delete filter — exclude deleted records explicitly.
        # 与列表同一套筛选(`DispatchFilter`):页面的筛选栏对两张表都生效。
        proposals = self.filter_queryset(self._proposed_queryset(tenant))

        page = self.paginate_queryset(proposals)
        if page is not None:
            return self.get_paginated_response(
                DispatchRecordListSerializer(page, many=True).data
            )
        return Response(DispatchRecordListSerializer(proposals, many=True).data)

    @extend_schema(responses=DispatchRecordListSerializer(many=True))
    @action(detail=False, methods=["get"])
    def history(self, request):
        """
        Get dispatch history for the current tenant.

        Paginated for the same reason as its sibling above, and mainly so the
        two are the same: a history list grows without bound, and two actions
        on one viewset returning the same serializer through different
        envelopes is the kind of asymmetry a client author discovers at
        runtime.
        """
        tenant = getattr(request, "tenant", None)
        if not tenant:
            return Response({"error": "No tenant context"}, status=status.HTTP_400_BAD_REQUEST)

        # _base_manager (unfiltered) dodges the contextvar issue but also
        # drops the soft-delete filter — exclude deleted records explicitly.
        history = self.filter_queryset(self._history_queryset(tenant, request.user))

        page = self.paginate_queryset(history)
        if page is not None:
            return self.get_paginated_response(
                DispatchRecordListSerializer(page, many=True).data
            )
        return Response(DispatchRecordListSerializer(history, many=True).data)

    @action(detail=True, methods=["post"])
    @idempotent
    def approve(self, request, pk=None):
        """
        Approve a proposed dispatch.
        """
        dispatch_record = self.get_object()
        # S-M2: Verify tenant is involved in this dispatch
        refused = self._not_target_or_403(request, dispatch_record, "approve")
        if refused is not None:
            return refused
        approver = request.user

        try:
            dispatch_record = DispatchService.approve(dispatch_record, approver)
            return Response(DispatchRecordSerializer(dispatch_record, context=self.get_serializer_context()).data)
        except ValueError as e:
            return _refused(e)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        """
        Reject a proposed dispatch.
        """
        dispatch_record = self.get_object()
        # 只有目标殿能驳回(与 approve / execute 同一条)。RBAC 严查 2026-10-29 M4:此前发起殿也能
        # 驳回自己的提案,记录写成 REJECTED、通知只回发起殿,目标殿的待批里它悄悄消失。撤回走 `cancel`。
        refused = self._not_target_or_403(request, dispatch_record, "reject")
        if refused is not None:
            return refused
        serializer = DispatchRejectSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        rejector = request.user
        reason = serializer.validated_data.get("reason", "")

        try:
            dispatch_record = DispatchService.reject(dispatch_record, rejector, reason)
            return Response(DispatchRecordSerializer(dispatch_record, context=self.get_serializer_context()).data)
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @extend_schema(request=DispatchCancelSerializer, responses=DispatchRecordSerializer)
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        """
        The sending hall withdraws a proposal the target has not yet approved (PROPOSED only).

        Only the hall that proposed it (ADMIN excepted, as on `create`): the target party reaches the
        record but gets 403, a third tenant never sees it (404). 409 `not_cancellable` once the target
        has approved, rejected or the record is anything but PROPOSED — the state machine still lets
        APPROVED be cancelled (a cancelled sentence plan needs that), this endpoint does not.
        """
        dispatch_record = self.get_object()
        if not is_tenant_exempt(request.user):
            tenant = self._requester_tenant(request)
            if tenant is None or tenant.pk != dispatch_record.source_tenant_id:
                return Response({"error": "Only the sending tenant may cancel this dispatch"},
                                status=status.HTTP_403_FORBIDDEN)
        body = DispatchCancelSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            dispatch_record = DispatchService.cancel_proposed(
                dispatch_record, request.user, body.validated_data["reason"],
            )
        except DispatchNotCancellableError as exc:
            return Response({"error": str(exc), "code": exc.code, "status": exc.status},
                            status=status.HTTP_409_CONFLICT)
        return Response(DispatchRecordSerializer(dispatch_record, context=self.get_serializer_context()).data)

    @action(detail=True, methods=["post"])
    @idempotent
    def execute(self, request, pk=None):
        """
        Execute an approved dispatch: the soul starts residing in the target
        tenant. Not a change of citizenship — it returns home automatically when
        its disposition there is executed, or through `return-home`.
        """
        dispatch_record = self.get_object()
        # S-C1: Verify executor is from target tenant
        refused = self._not_target_or_403(request, dispatch_record, "execute")
        if refused is not None:
            return refused
        executor = request.user

        try:
            dispatch_record = DispatchService.execute(dispatch_record, executor)
            return Response(DispatchRecordSerializer(dispatch_record, context=self.get_serializer_context()).data)
        except ValueError as e:
            return _refused(e)

    @extend_schema(request=DispatchReturnSerializer, responses=DispatchRecordSerializer)
    @action(detail=True, methods=["post"], url_path="return-home")
    def return_home(self, request, pk=None):
        """
        End a residence early: the soul goes back to its home tenant.

        Only the soul's home tenant (or ADMIN) may do this. The residence tenant
        cannot send a soul home on its own say-so — that is what executing its
        disposition does — and a third tenant never sees the record at all.
        """
        dispatch_record = self.get_object()
        soul = dispatch_record.soul
        if not is_tenant_exempt(request.user):
            requester_tenant = getattr(request, "tenant", None) or getattr(request.user, "tenant", None)
            if requester_tenant is None or requester_tenant.pk != soul.home_tenant_id:
                return Response(
                    {"error": "Only the soul's home tenant may end its residence"},
                    status=status.HTTP_403_FORBIDDEN,
                )
        if dispatch_record.status != DispatchStatus.EXECUTED or soul.tenant_id != dispatch_record.target_tenant_id:
            return Response(
                {"error": "This dispatch is not an ongoing residence"},
                status=status.HTTP_409_CONFLICT,
            )
        body = DispatchReturnSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        try:
            DispatchService.end_residence(
                soul, actor=request.user, trigger=DispatchService.RETURN_MANUAL,
                reason=body.validated_data["reason"],
            )
        except ResidenceReturnBlockedError as blocked:
            return Response(
                {"error": str(blocked), "code": blocked.code, "open_judgment_ids": blocked.judgment_ids},
                status=status.HTTP_409_CONFLICT,
            )
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_409_CONFLICT)
        dispatch_record.refresh_from_db()
        return Response(DispatchRecordSerializer(dispatch_record, context=self.get_serializer_context()).data)


def _participants_with_names():
    """The participant serializer reads `participant_tenant.code` and
    `participant_actor.name`; a bare `prefetch_related("participants")` paid one
    query per seat for each (PQ-01)."""
    return Prefetch(
        "participants",
        queryset=CrossTenantJudgmentParticipant.objects.select_related("participant_tenant", "participant_actor"),
    )


class CrossTenantJudgmentViewSet(AuditUserViewSetMixin, CodenameViewSetMixin,
                                 DataScopeViewSetMixin, viewsets.ModelViewSet):
    """
    CrossTenantJudgment CRUD + actions.
    """
    # CodenamePermission, on the cross_judgment family rather than dispatch.
    #
    # DECIDED (was an open decision through tranche 3): cross-tenant judgment
    # is a judgment activity — the same civilization that hears a soul's own
    # case should hear its cross-tenant one — so it moves to JUDGE rather than
    # staying with GUARDIAN's operational dispatch role. cross_judgment.read
    # and cross_judgment.create are held by the same three roles (ADMIN,
    # MODERATOR, JUDGE — see apps/perm/models.py), so this is a clean binary
    # swap: GUARDIAN loses cross-tenant judgments entirely, JUDGE gains full
    # access (view, participate, conclude), matching how it already reads and
    # decides on ordinary judgments. Both reads and writes moved together —
    # deliberately not split — because participate/conclude are the judgment
    # itself, not an administrative action layered on top of one.
    #
    # There is no cross_judgment.update/delete/participate/conclude codename,
    # only read/create, so every write action maps to create — the same shape
    # DispatchRecordViewSet uses for dispatch.manage. Because read and every
    # write share one codename here (as they did on dispatch.manage before),
    # this viewset cannot exhibit the narrow-action/wide-CRUD PERMISSION
    # bypass found on its sibling — there is no narrower codename for PATCH to
    # route around today. But CrossTenantJudgmentSerializer used to leave
    # `status` and `conclusion_type` writable too, and a PATCH reaching them
    # skipped `concluded_at` and the participant notifications `conclude()`
    # sends — the same "record lies" failure dispatch had, just not (yet)
    # also a permission bypass. Closed the same way (read-only + explicit
    # validate()), so it can't become one the moment `conclude` gets its own
    # narrower codename. See CrossTenantJudgmentSerializer's docstring.
    permission_classes = [CrossJudgmentPartyPermission, CodenamePermission]
    permission_codename = "cross_judgment"
    extra_permissions = {
        'export': ['cross_judgment.export'],
        'participate': ['cross_judgment.create'],
        'activate': ['cross_judgment.create'],
        'conclude': ['cross_judgment.create'],
        'cancel': ['cross_judgment.create'],
        'sentence': ['cross_judgment.create'],
        'seatable_actors': ['cross_judgment.create'],
        'order': ['cross_judgment.create'],
        'create': ['cross_judgment.create'],
        'update': ['cross_judgment.create'],
        'partial_update': ['cross_judgment.create'],
        'destroy': ['cross_judgment.create'],
    }
    queryset = CrossTenantJudgment.objects.select_related(
        "initiating_tenant"
    ).prefetch_related(_participants_with_names()).all()
    serializer_class = CrossTenantJudgmentSerializer
    # 行的范围由 `get_queryset` 的 Q 展开定(发起方或参与方);筛选只在那之内再分(状态 / 我方发起或参与 / 标题)。
    filterset_class = CrossTenantJudgmentFilter
    ordering_fields = ["create_time", "status"]
    # pagination_class = None  # Removed: paginate to prevent large payloads

    def get_serializer_class(self):
        if self.action == "list":
            return CrossTenantJudgmentListSerializer
        return CrossTenantJudgmentSerializer

    @extend_schema(responses={(200, "text/csv"): OpenApiTypes.BINARY, 400: OpenApiTypes.OBJECT})
    @action(detail=False, methods=["get"], url_path="export", pagination_class=None)
    def export(self, request):
        """导出本殿看得见的跨殿审判 CSV:行取自 `get_queryset()`(发起方或参与方),
        列只取列表序列化器给本殿的那些 —— 参与方名单、描述、判词细节不在文件里。"""
        return export_csv(
            request,
            qs=self.filter_queryset(self.get_queryset()),
            serializer_class=CrossTenantJudgmentListSerializer,
            columns=[
                ("Case ID", "id"), ("Title", "title"), ("Initiating Hall", "initiating_tenant_code"),
                ("Initiating Hall Name", "initiating_tenant_display_name"), ("Status", "status"),
                ("Concluded At", "concluded_at"), ("Conclusion", "conclusion_type"),
            ],
            filename="cross_judgments_export.csv",
            resource="cross_judgment",
        )

    def get_queryset(self):
        # Design decision: CrossTenantJudgment records are accessible to both
        # the initiating tenant and participating tenants. DataScopeViewSetMixin
        # applies tenant isolation via qs.filter(tenant=tenant) as a baseline.
        # We then expand the queryset via Q-filter to include records where the
        # current tenant is either the initiator or a participant. This is
        # intentional for cross-tenant records that need broader access.
        from django.db.models import Q
        # Fresh queryset each call — avoids TenantManager stale class-attr filter.
        # _base_manager is the *unfiltered* manager (all_objects is declared
        # first on this model precisely so it takes that role), so reaching
        # for it to dodge the contextvar issue also drops the soft-delete
        # filter — exclude deleted records explicitly rather than going back
        # to `objects`, which would reintroduce the contextvar problem this
        # override exists to solve.
        #
        # Using _base_manager also means this bypasses DataScopeViewSetMixin's
        # tenant filtering entirely (this viewset only lists DataScopeViewSetMixin
        # among its bases for the mixin's other behavior — get_queryset is fully
        # overridden here), so the ADMIN bypass has to be reapplied explicitly
        # too — matching DispatchRecordViewSet.get_queryset above and every
        # other ADMIN-bypass in this codebase. Without it, ADMIN was being
        # scoped down to only judgments touching ADMIN's own tenant, same as
        # every non-ADMIN caller.
        qs = CrossTenantJudgment._base_manager.filter(is_deleted=False).select_related(
            "initiating_tenant"
        ).prefetch_related(_participants_with_names())
        user = self.request.user
        if is_tenant_exempt(user):
            return qs
        tenant = getattr(self.request, "tenant", None)
        if tenant:
            # `.distinct()`: the right-hand `Q` joins `participants`, and a row
            # comes back **once per matching participant**. `add_participant`
            # enforces no uniqueness, so a tenant added twice to the same
            # judgment sees that judgment twice — in the page body and in the
            # paginated `count`, which is the number the UI prints.
            qs = qs.filter(
                Q(initiating_tenant=tenant) | Q(participants__participant_tenant=tenant)
            ).distinct()
            # 数据范围也要过(rbac-scope 第 9 条):同文件 DispatchRecord 补过,这里覆写后一直没补。
            return DataScopeFilter.filter_queryset(self.request, qs, CrossTenantJudgment)
        return qs.none()

    def perform_create(self, serializer):
        """Stamp both tenant columns from the requester, never from the body.

        `initiating_tenant` used to be a plain writable field while this method
        pinned only `tenant`. Since `get_queryset` filters on
        `initiating_tenant` and object permissions compare `tenant`, a caller
        could set the two to different tenants and land a row in someone
        else's list that that tenant could not open and the creator could not
        see. Both columns now come from the same place, so they cannot
        disagree.

        The fallback to `request.user.tenant` matters: `request.tenant` is set
        by TenantMiddleware from the token's `tenant_code` claim, and any
        caller that reaches a view without passing through the middleware
        (DRF's `force_authenticate`, used by a good deal of this suite) has it
        as None. Reading the user's own tenant column is the same answer by a
        route that cannot be skipped.
        """
        tenant = getattr(self.request, "tenant", None) or getattr(
            self.request.user, "tenant", None
        )
        if tenant is None:
            raise serializers.ValidationError({
                "initiating_tenant": (
                    "No tenant on the request or the user. A cross-tenant "
                    "judgment has to be opened by some tenant."
                )
            })
        serializer.save(tenant=tenant, initiating_tenant=tenant)

    def _initiator_or_403(self, request, judgment):
        """The initiating tenant seats the bench and convenes it; nobody else.

        A participant used to be able to add participants too (BD-06). It is
        invited; it does not extend the invitation. No ADMIN bypass here, as
        there was none on the check this replaces: an ADMIN acts for the
        tenant on its token (`test_uninvolved_tenant_cannot_participate` pins
        an ADMIN of a third tenant at 403). Returns a Response to send, or None.
        """
        request_tenant = getattr(request, "tenant", None) or getattr(request.user, "tenant", None)
        if not request_tenant:
            return Response({"error": "Tenant context required"}, status=status.HTTP_403_FORBIDDEN)
        if judgment.initiating_tenant_id != request_tenant.pk:
            return Response(
                {"error": "Only the initiating tenant may do this"}, status=status.HTTP_403_FORBIDDEN
            )
        return None

    # 改标题 / 描述只归发起方:`CrossJudgmentPartyPermission` 放参与方进 `get_object()` 是为了看与入席,
    # 不是为了改别人发起的案子(此前受邀方 PUT/PATCH 也是 200)。`partial_update` 经由这里。
    # (注释而非 docstring:drf-spectacular 会把 docstring 写进已提交的 schema。)
    def update(self, request, *args, **kwargs):
        refused = self._initiator_or_403(request, self.get_object())
        return refused if refused is not None else super().update(request, *args, **kwargs)

    # 删除同上,只归发起方(此前受邀方 DELETE 也是 204)。
    def destroy(self, request, *args, **kwargs):
        refused = self._initiator_or_403(request, self.get_object())
        return refused if refused is not None else super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=["post"])
    def participate(self, request, pk=None):
        """
        Seat a participant on a cross-tenant judgment (initiating tenant only,
        while PROPOSED). Does not activate — see `activate`.
        """
        judgment = self.get_object()
        refused = self._initiator_or_403(request, judgment)
        if refused is not None:
            return refused
        serializer = CrossTenantJudgmentParticipateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        actor_id = serializer.validated_data.get("participant_actor")
        role = serializer.validated_data["role"]

        if "participant_tenant_code" in serializer.validated_data:
            tenant = Tenant.objects.filter(code=serializer.validated_data["participant_tenant_code"]).first()
        else:
            tenant = Tenant.objects.filter(id=serializer.validated_data["participant_tenant"]).first()
        if not tenant:
            return Response({"error": "Tenant not found"}, status=status.HTTP_404_NOT_FOUND)

        # 席位上的神祇属**被邀文明**(2026-09-20 用户决定)。此前这里按**发起方**租户找,
        # 且字段是整数而 Actor 主键是 UUID —— 永远找不到,静默落成 None。现在找不到或不可担任
        # 席位就 400(`add_participant` 里判),什么都不写。
        actor = None
        if actor_id:
            actor = Actor.all_objects.filter(pk=actor_id, is_deleted=False).first()
            if actor is None:
                return Response({"error": "Actor not found"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            CrossTenantJudgmentService.add_participant(
                judgment, tenant, actor, role,
                node_order=serializer.validated_data.get("node_order"),
            )
            judgment.refresh_from_db()
            return Response(CrossTenantJudgmentSerializer(judgment, context={"request": request}).data)
        except OrderLockedError as e:
            return Response({"error": str(e), "code": e.code}, status=status.HTTP_409_CONFLICT)
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @extend_schema(
        parameters=[
            OpenApiParameter("tenant_code", str, OpenApiParameter.QUERY, required=True,
                             description="The civilization being invited."),
            OpenApiParameter("role", str, OpenApiParameter.QUERY, required=True,
                             enum=["ADVISOR", "CO_JUDGE", "CHAIRMAN"],
                             description="The seat: CO_JUDGE / CHAIRMAN take JUDGE actors only; ADVISOR any role."),
        ],
        responses=SeatableActorSerializer(many=True),
    )
    @action(detail=True, methods=["get"], url_path="seatable-actors", pagination_class=None)
    def seatable_actors(self, request, pk=None):
        """被邀文明里可担任席位的神祇,供发起方入席时选(2026-09-20 用户决定)。

        只给能入席的人:`cross_judgment.create`、发起方租户、联审 PROPOSED;被邀的不能是发起方自己。
        只读、字段最小(id 与名字)。**不放宽 `ActorViewSet` 的租户过滤** —— 跨租户读神祇只在这里,
        且只读这一个被邀租户的、`seatable_actors` 判定过的那些行。
        """
        judgment = self.get_object()
        refused = self._initiator_or_403(request, judgment)
        if refused is not None:
            return refused
        if judgment.status != JudgmentStatus.PROPOSED:
            return Response({"error": "Seats are chosen only before the bench is convened"},
                            status=status.HTTP_400_BAD_REQUEST)
        tenant = Tenant.objects.filter(code=request.query_params.get("tenant_code") or "").first()
        if tenant is None:
            return Response({"error": "Tenant not found"}, status=status.HTTP_404_NOT_FOUND)
        if tenant.pk == judgment.initiating_tenant_id:
            return Response({"error": "The initiating tenant does not seat itself"},
                            status=status.HTTP_400_BAD_REQUEST)
        seat_role = request.query_params.get("role") or ""
        if seat_role not in ParticipantRole.values:
            return Response({"error": "role must be ADVISOR, CO_JUDGE or CHAIRMAN"},
                            status=status.HTTP_400_BAD_REQUEST)
        actors = CrossTenantJudgmentService.seatable_actors(tenant, seat_role)
        return Response(SeatableActorSerializer(actors, many=True).data)

    @extend_schema(request=CrossTenantJudgmentSentenceSerializer, responses=CrossTenantJudgmentSerializer)
    @action(detail=True, methods=["post"])
    def sentence(self, request, pk=None):
        """参与方填**自己文明**那一站的处置内容(docs/ARCHITECTURE-sentence-plan.md §2.1,Q1/Q12)。

        只有该席位所属租户能填,ADMIN 也按令牌上的租户算 —— 与 `_initiator_or_403` 同一立场:
        各文明定自己的节点,别人不能代填。
        """
        judgment = self.get_object()
        serializer = CrossTenantJudgmentSentenceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        participant = judgment.participants.select_related("participant_tenant").filter(
            pk=data["participant"], is_deleted=False,
        ).first()
        if participant is None:
            return Response({"error": "Participant not found"}, status=status.HTTP_404_NOT_FOUND)
        request_tenant = getattr(request, "tenant", None) or getattr(request.user, "tenant", None)
        if request_tenant is None or participant.participant_tenant_id != request_tenant.pk:
            return Response(
                {"error": "Only the participant's own tenant may submit its sentence"},
                status=status.HTTP_403_FORBIDDEN,
            )
        try:
            CrossTenantJudgmentService.submit_sentence(
                participant, data["realm_code"], data.get("sentence_years"), data["notes"], request.user,
            )
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        judgment.refresh_from_db()
        return Response(CrossTenantJudgmentSerializer(judgment, context={"request": request}).data)

    @extend_schema(request=CrossTenantJudgmentOrderSerializer, responses=CrossTenantJudgmentSerializer)
    @action(detail=True, methods=["post"])
    def order(self, request, pk=None):
        """发起方重排各站顺序(PROPOSED 时;原属恒为 1,参与方从 2 起)。永久刑期只能排最后(Q5)。"""
        judgment = self.get_object()
        refused = self._initiator_or_403(request, judgment)
        if refused is not None:
            return refused
        serializer = CrossTenantJudgmentOrderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            CrossTenantJudgmentService.reorder_nodes(judgment, serializer.validated_data["participants"])
        except OrderLockedError as e:
            # 第四十三批:审批流程已按这个顺序建了各域的段。
            return Response({"error": str(e), "code": e.code}, status=status.HTTP_409_CONFLICT)
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        judgment = self.get_queryset().get(pk=judgment.pk)
        return Response(CrossTenantJudgmentSerializer(judgment, context={"request": request}).data)

    @extend_schema(request=None, responses=CrossTenantJudgmentSerializer)
    @action(detail=True, methods=["post"])
    def activate(self, request, pk=None):
        """
        Convene the judgment: PROPOSED -> ACTIVE. Initiating tenant only, and
        only once at least one participant is seated (BD-06). Activation used
        to be a side effect of the first `participate`, which capped the bench
        at one.
        """
        judgment = self.get_object()
        refused = self._initiator_or_403(request, judgment)
        if refused is not None:
            return refused
        try:
            judgment = CrossTenantJudgmentService.activate(judgment)
            return Response(CrossTenantJudgmentSerializer(judgment, context={"request": request}).data)
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["post"])
    def conclude(self, request, pk=None):
        """
        Conclude a cross-tenant judgment.
        """
        judgment = self.get_object()

        # 结束与取消同一道:召集人,或发起殿的 ADMIN / 殿主。参与方入席表态,不替召集人收场。
        if not CrossTenantJudgmentService.can_end(judgment, request.user, getattr(request, "tenant", None)):
            return Response(
                {"error": "Only the convener or this hall's admin may conclude"}, status=status.HTTP_403_FORBIDDEN
            )

        serializer = CrossTenantJudgmentConcludeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        conclusion_type = serializer.validated_data["conclusion_type"]

        try:
            judgment = CrossTenantJudgmentService.conclude(
                judgment, conclusion_type, request.user, note=serializer.validated_data.get("note", ""),
            )
            return Response(CrossTenantJudgmentSerializer(judgment, context={"request": request}).data)
        except WorkflowRunningError as e:
            # 2026-10-18:挂着的审批流程还在走,审判随流程结束;要提前收场用「取消」。
            return Response({"error": str(e), "code": e.code}, status=status.HTTP_409_CONFLICT)
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @extend_schema(request=CrossTenantJudgmentCancelSerializer, responses=CrossTenantJudgmentSerializer)
    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        """取消会审(第四十批 W-a):理由必填;召集人或发起殿的管理员(`CrossTenantJudgmentService.can_end`)。

        PROPOSED / ACTIVE → CANCELLED,不会有结论;席上各站保留、只读。原审判随后照常结案
        (`check_cross_judgment` 不再挡)。已结束 / 已取消答 409。
        """
        judgment = self.get_object()
        if not CrossTenantJudgmentService.can_end(judgment, request.user, getattr(request, "tenant", None)):
            return Response(
                {"error": "Only the convener or this hall's admin may cancel"}, status=status.HTTP_403_FORBIDDEN
            )
        serializer = CrossTenantJudgmentCancelSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            judgment = CrossTenantJudgmentService.cancel(judgment, serializer.validated_data["reason"], request.user)
        except ValueError as e:
            return Response({"error": str(e), "code": "not_cancellable"}, status=status.HTTP_409_CONFLICT)
        return Response(CrossTenantJudgmentSerializer(judgment, context={"request": request}).data)
