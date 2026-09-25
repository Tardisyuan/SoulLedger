"""
REST views for Disposition app.
"""
from django.db.models import Count, Exists, OuterRef
from django_filters import rest_framework as filters
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from apps.core.archive import DeletionNotAllowedError
from apps.core.mixins import TenantCreateMixin, TenantQuerySetMixin
from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.viewsets import AuditUserViewSetMixin, CodenameViewSetMixin, DataScopeViewSetMixin
from apps.disposition.models import SECTION_FILTERS, Disposition, DispositionSection
from apps.disposition.serializers import DispositionExecuteSerializer, DispositionSerializer
from apps.disposition.services import DispositionService
from apps.reincarnation.models import Reincarnation


class DispositionFilter(filters.FilterSet):
    """`section` 选页面的一段;`soul_reborn=false` 让「期满」段藏起已经转世的灵魂。

    `soul_reborn` 是普通过滤项,所以它也作用于分段计数(计数只忽略 `section`
    本身)—— 页面藏了哪些行,计数就不数哪些行。"""
    section = filters.ChoiceFilter(choices=DispositionSection.choices, method="filter_section")
    soul_reborn = filters.BooleanFilter(field_name="soul_reborn_flag")

    class Meta:
        model = Disposition
        fields = ["soul", "is_executed", "is_eternal", "memory_reset"]

    def filter_section(self, queryset, name, value):
        return queryset.filter(SECTION_FILTERS[value])


class DispositionPagination(PageNumberPagination):
    """The project page envelope plus `section_counts`: how many rows each of the
    three sections holds under the same filters as this page, ignoring
    `section` itself. The /disposition page shows these instead of counting the
    rows it happens to have loaded."""

    def paginate_queryset(self, queryset, request, view=None):
        self.section_counts = view.section_counts() if view is not None else None
        return super().paginate_queryset(queryset, request, view)

    def get_paginated_response(self, data):
        response = super().get_paginated_response(data)
        response.data["section_counts"] = self.section_counts
        return response

    def get_paginated_response_schema(self, schema):
        schema = super().get_paginated_response_schema(schema)
        schema["properties"]["section_counts"] = {
            "type": "object",
            "properties": {s.value: {"type": "integer"} for s in DispositionSection},
            "required": [s.value for s in DispositionSection],
        }
        schema["required"] = [*schema.get("required", []), "section_counts"]
        return schema


# TenantCreateMixin was absent, so POST wrote `tenant = NULL` and the row was
# invisible to its own tenant afterwards (`scope_to_tenant` filters `tenant=X`;
# NULL matches none). The serializer has no `tenant` field and the model has no
# `save()` override, so nothing else was going to fill it in.
class DispositionViewSet(CodenameViewSetMixin, TenantQuerySetMixin, DataScopeViewSetMixin, TenantCreateMixin, AuditUserViewSetMixin, viewsets.ModelViewSet):
    """
    Disposition CRUD + execute action.
    Tenant-isolated via TenantPermission.
    """
    # CodenamePermission is what finally enforces the codenames below; before
    # it, PermissionMiddleware never saw self.action and they gated nothing.
    # The binary shape below is what makes the change here uneven: `read` is
    # held by four of five roles so only VIEWER loses the list, while `execute`
    # is held by two, so JUDGE and GUARDIAN lose the writes they had. That is
    # the declared policy, not a side effect of attaching this class.
    permission_classes = [TenantPermission, CodenamePermission]
    # BINARY: read / execute. ROLE_PERMISSIONS defines exactly those two —
    # read for ADMIN, JUDGE, GUARDIAN and MODERATOR; execute for ADMIN and
    # MODERATOR — and there is no disposition.manage. The viewset is a
    # ModelViewSet, so the mixin was also generating disposition.create,
    # .update and .delete, which exist nowhere and are held by nobody.
    #
    # Those three writes map to disposition.execute, this module's only write
    # verb. Carrying out a disposition and authoring one are the same
    # privilege here in practice, and no third codename can be introduced
    # without seeding and granting it.
    permission_codename = "disposition"
    extra_permissions = {
        'execute': ['disposition.execute'],
        'create': ['disposition.execute'],
        'update': ['disposition.execute'],
        'partial_update': ['disposition.execute'],
        'destroy': ['disposition.execute'],
        'archive': ['disposition.execute'],
    }
    queryset = Disposition.objects.select_related(
        "soul", "soul__tenant", "destination_realm", "tenant", "judgment"
    ).annotate(
        # 这一世之后是否已经转世 —— 一个子查询,不是每行一次(serializer 的 get_soul_reborn)。
        soul_reborn_flag=Exists(
            Reincarnation.objects.filter(soul=OuterRef("soul"), cycle_count__gt=OuterRef("cycle"))
        ),
    )
    serializer_class = DispositionSerializer
    filterset_class = DispositionFilter
    pagination_class = DispositionPagination
    # 暂居只读例外(apps/core/tenant.py)。
    residence_read_actions = ("list", "retrieve")
    ordering_fields = ["created_at", "executed_at"]

    def get_queryset(self):
        """Archived dispositions are off the list unless asked for.

        `ArchivableMixin`'s docstring says "an archived record is removed from
        normal lists". That was true of Soul (`apps/souls/views.py` filters it)
        and **false here**: `TenantManager` filters `is_deleted` only, and this
        queryset filtered nothing, so `archive()` on a Disposition changed a
        flag and nothing else. Measured 2026-08-29 —
        `d.archive(reason="test")`, then `Disposition.objects.filter(pk=d.pk)`
        still returned it.

        `?show_archived=1` to see them, matching the `show_deleted` switch the
        Soul viewset already has: archiving is reversible and the rows are
        meant to stay readable, which is the whole difference between it and a
        delete.
        """
        qs = super().get_queryset()
        show_archived = self.request.query_params.get(
            "show_archived", ""
        ).lower() in ("1", "true", "yes")
        if not show_archived:
            qs = qs.filter(is_archived=False)
        return qs

    def perform_create(self, serializer):
        """A manual disposition with a destination realm moves the soul there (行程拓扑).

        Same verb and same transaction as `DispositionService.create_from_judgment`:
        `SoulPathService.enter` closes the open station and opens the realm
        (产品负责人 2026-09-25). Not for a disposition filed under an AMENDMENT or
        REOPEN judgment: those are heard while the soul serves a sentence plan,
        and where it stands is the plan's to move. No realm writes nothing.
        """
        from django.db import transaction

        from apps.judgment.models import JudgmentKind
        from apps.realms.path import SoulPathService

        with transaction.atomic():
            super().perform_create(serializer)
            disposition = serializer.instance
            if disposition.destination_realm_id is None:
                return
            if disposition.judgment is not None and disposition.judgment.kind != JudgmentKind.ORIGINAL:
                return
            SoulPathService.enter(disposition.soul, disposition.destination_realm, tenant_id=disposition.tenant_id)

    def section_counts(self) -> dict:
        """Per-section totals under this request's filters, minus `section`.

        One aggregate query. The filterset is rebuilt without `section` rather
        than counting the page's own queryset, which `section` has already cut
        down to one section."""
        params = self.request.query_params.copy()
        params.pop("section", None)
        qs = DispositionFilter(params, queryset=self.get_queryset(), request=self.request).qs
        counts = qs.aggregate(**{
            section.value: Count("pk", filter=q) for section, q in SECTION_FILTERS.items()
        })
        return {key: counts[key] or 0 for key in counts}

    @action(detail=True, methods=["post"])
    def execute(self, request, pk=None):
        """
        Execute a disposition: mark executed, transition soul to REINCARNATING.
        POST /disposition/{id}/execute/
        """
        disposition = self.get_object()

        serializer = DispositionExecuteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # THE `is_executed` CHECK HAS TO HAPPEN UNDER THE LOCK.
        #
        # It used to be an unlocked read at the top of this method. Two threads
        # both read `is_executed=False` and both went on to execute. Measured on
        # a PostgreSQL 16 clone:
        #
        #     P3 results = {'b': 'executed', 'a': 'executed'}   state = SETTLED
        #     P3 events  = ['REINCARNATION_TRIGGERED', 'REINCARNATION_TRIGGERED',
        #                   'STATE_CHANGED', 'SOUL_CREATED']
        #
        # The state machine held (one STATE_CHANGED), **but this guard stopped
        # nothing**: two executions, two events, `executed_at` written twice.
        # A guard that reads before the row is locked answers a question about
        # the past.
        #
        # AND THE EXECUTION HAS TO HAPPEN UNDER IT TOO (BD-15). The block used to
        # end at `disposition = locked`, so the service ran with the lock
        # released: a second executor passed the check above before the first
        # wrote `is_executed`, and only `transition_to`'s soul-row lock stopped
        # a double execution — reported as 409 instead of "Already executed".
        # Measured on postgres:16: {'b': 200, 'a': 409}; now {'a': 200, 'b': 400}.
        from django.db import transaction

        with transaction.atomic():
            locked = (
                Disposition.objects.select_for_update()
                .filter(pk=disposition.pk)
                .first()
            )
            if locked is None:
                return Response(status=status.HTTP_404_NOT_FOUND)
            if locked.is_executed:
                return Response(
                    {"error": "Already executed"}, status=status.HTTP_400_BAD_REQUEST
                )
            disposition = locked
            from apps.sentence_plan.services import SentencePlanService

            # 挂在受刑计划节点上的处置:转生 / 终局由计划完成时的 `advance` 做
            # (docs/ARCHITECTURE-sentence-plan.md §3.3,原来在这里的那次调用挪过去了)。
            on_plan = SentencePlanService.node_for_disposition(disposition) is not None
            executed = DispositionService.execute(disposition)
            if executed and not on_plan:
                # Souls whose cosmology has a next life go on to be reborn. The
                # call is unconditional on cosmology on purpose:
                # `ReincarnationService.execute` answers False for the terminal
                # ones rather than this view holding a second copy of that
                # list. It used to write REINCARNATION_TRIGGERED for every soul
                # including those -- see its docstring.
                #
                # INSIDE THE BLOCK, for BD-15's reason one call further down.
                # It ran after the block ended, with the soul already committed
                # as REINCARNATING and unlocked, so `/reincarnation/reborn/`
                # could complete the rebirth in the gap. Measured on
                # postgres:16: events [COMPLETED, TRIGGERED], {'a': 200,
                # 'b': 201} -- "triggered" logged for a soul already ALIVE.
                # Now the rebirth waits on the soul row and the trigger comes
                # first.
                from apps.reincarnation.services import ReincarnationService

                ReincarnationService.execute(disposition)

        if not executed:
            # `execute` now returns False, and writes nothing, when the soul is
            # not in a state the disposition can act on. It used to return True
            # unconditionally after having already saved `is_executed` -- the
            # record said "executed" while the soul had not moved, and this
            # view answered 200.
            return Response(
                {
                    "error": "Soul is not in a state this disposition can act on",
                    "detail": (
                        f"当前状态 {disposition.soul.current_state} 不允许执行该处置；"
                        f"处置未被标记为已执行"
                    ),
                    "soul_state": disposition.soul.current_state,
                },
                status=status.HTTP_409_CONFLICT,
            )

        return Response(DispositionSerializer(disposition).data)

    def destroy(self, request, *args, **kwargs):
        """Soft-delete a disposition, or refuse with a clear reason when
        it's tied to a concluded verdict (Stage 4 §4.7: archivable instead —
        in practice this is true of every Disposition, since one is only
        ever created once its Judgment has concluded)."""
        disposition = self.get_object()
        reason = request.data.get("reason", "") if hasattr(request, "data") else ""
        try:
            disposition.delete_or_raise(user=request.user, reason=reason)
        except DeletionNotAllowedError as exc:
            return Response(
                {"error": str(exc), "archivable": exc.archivable},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def archive(self, request, pk=None):
        """Archive a disposition tied to a concluded verdict. See
        Disposition.can_delete."""
        disposition = self.get_object()
        if disposition.can_delete:
            return Response(
                {"error": "This disposition has no concluded verdict; delete it instead of archiving."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        reason = request.data.get("reason", "")
        disposition.archive(user=request.user, reason=reason)
        return Response(DispositionSerializer(disposition).data)
