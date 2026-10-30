"""
REST views for Soul app.
"""
import csv
import uuid

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.http import HttpResponse
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.core.archive import DeletionNotAllowedError
from apps.core.csv_safe import csv_safe
from apps.core.exports import record_export, refuse_if_too_many
from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.tenant import is_tenant_exempt, residence_read_allowed, scope_to_tenant
from apps.core.viewsets import AuditUserViewSetMixin, CodenameViewSetMixin, DataScopeViewSetMixin
from apps.ledger.serializers import LedgerSummarySerializer
from apps.ledger.services import LedgerService
from apps.realms.serializers import SoulPathEntrySerializer
from apps.souls import importer, region_update
from apps.souls.dates import (
    ERROR,
    check_record_date,
    check_soul_dates,
    date_warning_fingerprint,
    parse_historical_date,
)
from apps.souls.filters import SoulFilter
from apps.souls.models import Soul, SoulState
from apps.souls.record_models import SoulRecord
from apps.souls.serializers import (
    SOUL_BATCH_RECYCLE_MAX,
    SoulBatchRecycleErrorSerializer,
    SoulBatchRecycleResultSerializer,
    SoulBatchRecycleSerializer,
    SoulImportCommitSerializer,
    SoulImportFileErrorSerializer,
    SoulImportPreviewSerializer,
    SoulImportUploadSerializer,
    SoulListSerializer,
    SoulRecordSerializer,
    SoulRegionUpdateCommitSerializer,
    SoulRegionUpdatePreviewSerializer,
    SoulSerializer,
    SoulStationMoveSerializer,
    SoulStationRefusalSerializer,
    SoulTransitionSerializer,
)


def _record_errors(serializer):
    """400 for a record write: the usual `{field: [message]}` plus `error_codes` — `{field: [code]}` in the
    same order — so a client maps the stable code to its own words instead of matching English text."""
    # `serializer.errors` holds DRF ErrorDetail strings, each carrying its `.code`. (A serializer has no
    # `get_full_details()` — that is on ValidationError; calling it here was a 500 on every invalid write.)
    codes = {
        field: [getattr(d, "code", None) or "invalid" for d in (details if isinstance(details, list) else [details])]
        for field, details in serializer.errors.items()
    }
    return Response({**serializer.errors, "error_codes": codes}, status=status.HTTP_400_BAD_REQUEST)


class _ImportRefusedError(Exception):
    """A file-level import refusal. Returned as a plain 400 body rather than raised as DRF's
    ValidationError, which coerces every value to a string list (`max_rows` arrived as "1000")."""

    def __init__(self, payload):
        super().__init__(payload.get("code"))
        self.payload = payload

    def response(self):
        return Response(self.payload, status=status.HTTP_400_BAD_REQUEST)


class SoulViewSet(CodenameViewSetMixin, DataScopeViewSetMixin, AuditUserViewSetMixin, viewsets.ModelViewSet):
    """
    Soul CRUD + state transitions + record management.
    Tenant-isolated via TenantPermission + select_related for N+1 elimination.
    """
    # CodenamePermission is what finally enforces the codenames below. Until it
    # was added they were declarative only: PermissionMiddleware never saw
    # self.action, so every role reaching this viewset with a tenant could
    # create, rename, kill and delete souls regardless of what it held. See
    # apps/core/permissions.py for why middleware could not do this.
    permission_classes = [TenantPermission, CodenamePermission]
    permission_codename = "soul"
    extra_permissions = {
        'die': ['soul.die'],
        'transition': ['soul.transition'],
        'karma': ['soul.read'],
        # 功过是审判净值与证据的来源,增改挂账簿的码 `ledger.manage`(用户 2026-10-29 第 19 条;此前是
        # `soul.update`,守护者不持任何 judgment.* 却能改已被采信的证据)。souls/0053 把它授给原来靠 soul.update 写功过的角色。
        'add_record': ['ledger.manage'],
        'update_record': ['ledger.manage'],
        'records': ['soul.read'],
        'path': ['soul.read'],
        # 挪十三站(apps/souls/stations.py):与状态转换同一个码名 —— 都是把灵魂挪到别处。
        'station': ['soul.transition'],
        # Acknowledging a warning mutates the record (three new columns),
        # the same way add_record mutates the soul's records — so it is
        # gated the same way add_record is, rather than inventing a new
        # codename for one action. See acknowledge_record_date_warning.
        'acknowledge_record_date_warning': ['soul.update'],
        'unacknowledge_record_date_warning': ['soul.update'],
        # Archiving is the redirect a blocked delete points to (see
        # destroy() below) — gated on the same codename as the delete it
        # stands in for, not a new one.
        'archive': ['soul.delete'],
        'unarchive': ['soul.delete'],
        # The batch form of destroy — the same codename, not a new one.
        'batch_recycle': ['soul.delete'],
        # 批量条的「导出」:自己的码(用户 2026-10-29 第 3 条;此前与列表同一个读码)。
        'export': ['soul.export'],
        # CSV 导入:预览不写库,但问的是「我能不能建」,与提交同一个码名。
        'import_preview': ['soul.create'],
        'import_commit': ['soul.create'],
        # 批量回填出身地域:改已有灵魂的一个字段,与表单编辑同一个码名(预览同提交)。
        'region_update_preview': ['soul.update'],
        'region_update_commit': ['soul.update'],
        'correct_settlement': ['soul.correct_settlement'],
    }
    # `reincarnations` because life_index counts them, and the date checks on
    # every list row read it (serializers._this_lifes_records).
    queryset = Soul.objects.select_related("tenant", "home_tenant").prefetch_related("records", "reincarnations").all()
    filterset_class = SoulFilter
    # 暂居只读例外(apps/core/tenant.py):原属租户读得到暂居在外的灵魂。只列 GET 动作。
    # `export` 与 `list` 同一范围:不纳入时，暂居在外的灵魂在列表里有、在导出的文件里没有。
    residence_read_actions = ("list", "retrieve", "karma", "records", "path", "export")
    search_fields = SoulFilter.search_fields
    ordering_fields = SoulFilter.ordering_fields
    #: The actions whose response is a SoulSerializer / SoulListSerializer, or (`records`) every record.
    _ACTIONS_THAT_SERIALIZE_SOULS = frozenset({
        "list", "retrieve", "update", "partial_update", "archive", "unarchive", "correct_settlement", "die",
        "transition", "records", "station",
    })

    def get_queryset(self):
        """
        Build fresh queryset each call to avoid stale TenantManager contextvar filters.
        Applies tenant isolation + DataScope filtering for non-ADMIN users.
        """
        from apps.souls.querysets import SoulQuerySet
        qs = SoulQuerySet(Soul).select_related("tenant", "home_tenant", "owner_org")
        # Only the actions that serialize souls read `records` and `life_index` (perf review 2026-10-27 #6).
        # Without the prefetch a SoulSerializer pays one `reincarnations` COUNT per nested record; the other
        # actions (add_record, karma, path, the acknowledgements, delete …) loaded a soul's whole history for
        # nothing.
        if getattr(self, "action", None) in self._ACTIONS_THAT_SERIALIZE_SOULS:
            qs = qs.prefetch_related("records", "reincarnations")
        # SoulQuerySet(Soul) instantiates the raw queryset directly rather
        # than going through SoulManager.get_queryset(), so — unlike almost
        # every other viewset in this codebase — it does NOT pick up the
        # is_deleted=False filter SoulManager applies. Soft-deleted souls
        # were showing up in the ordinary list for every caller, ADMIN
        # included. Found while wiring the Stage 4 recycle bin (a soul that
        # never left its own list would make the bin's "already gone from
        # everywhere else" claim false); filtered explicitly here rather
        # than switching to Soul.objects, which would reintroduce the
        # class-level contextvar staleness this method's docstring already
        # warns about.
        #
        # ?show_deleted=true opts back in, matching the "show deleted"
        # toggle convention this feature introduces. Archived souls
        # (has_concluded_judgment souls that were archived instead of
        # deleted) never come back through *this* toggle; `show_archived`
        # below is theirs.
        show_deleted = self.request.query_params.get('show_deleted', '').lower() in ('1', 'true', 'yes')
        if not show_deleted:
            qs = qs.filter(is_deleted=False)
        # 详情与取消归档要找得到已归档的灵魂(链接、搜索打开时详情页显示横条);列表默认不带。
        # `?show_archived=1` 让列表(与导出)把已归档的也列出来 —— 同处置列表的开关(审计 1017 #9):
        # 否则取消归档的按钮在详情页上,而那个详情页除了直接链接找不到。
        show_archived = self.request.query_params.get('show_archived', '').lower() in ('1', 'true', 'yes')
        if not show_archived and getattr(self, 'action', None) not in ('retrieve', 'unarchive'):
            qs = qs.filter(is_archived=False)
        # Apply tenant isolation + DataScope filtering (equivalent to
        # DataScopeViewSetMixin, which this viewset cannot simply inherit
        # because of the soft-delete/archive/karma handling above and below).
        # Scoping itself goes through apps/core/tenant.py like everywhere else.
        user = self.request.user
        if not user.is_authenticated:
            return qs.none()
        if not is_tenant_exempt(user):
            qs = scope_to_tenant(qs, self.request, residence_read=residence_read_allowed(self))
            # Apply DataScope filtering — ADMIN bypasses both, hence the
            # early branch rather than letting the helper handle the bypass.
            from apps.perm.filters import DataScopeFilter
            qs = DataScopeFilter.filter_queryset(self.request, qs, Soul)
        qs = qs.exclude_orphaned()

        # Karma ordering (applied here since DRF ordering runs after get_queryset)
        ordering = self.request.query_params.get('ordering', '').strip()
        if ordering in ('karmic_balance', '-karmic_balance'):
            qs = qs.order_by_karma(descending=ordering.startswith('-'))
            # `_skip_filter_ordering` used to be set here and read by an
            # overridden `filter_queryset` below — removed 2026-09-13 (BD-17):
            # both of that method's branches returned the same
            # `super().filter_queryset(queryset)` result, so the flag never
            # actually skipped DRF's ordering filter; it was pure dead
            # bookkeeping around a passthrough. Whether karma ordering
            # surviving DRF's OrderingFilter is itself correct is a
            # behavior question, not a cleanup one — see BD-17 in the audit
            # ledger.

        return qs

    def get_serializer_class(self):
        if self.action == "list":
            return SoulListSerializer
        return SoulSerializer

    def destroy(self, request, *args, **kwargs):
        """Move a soul to the recycle bin — cascading to its karma/demerit
        records and pending judgments (Soul.delete_with_cascade) — or refuse
        with a clear reason if it has a concluded judgment (Stage 4 §4.7:
        archivable instead of deletable once a verdict exists).
        """
        soul = self.get_object()
        reason = request.data.get("reason", "") if hasattr(request, "data") else ""
        try:
            soul.delete_with_cascade(user=request.user, reason=reason)
        except DeletionNotAllowedError as exc:
            return Response(
                {"error": str(exc), "archivable": exc.archivable},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(
        request=SoulBatchRecycleSerializer,
        responses={
            200: SoulBatchRecycleResultSerializer,
            404: SoulBatchRecycleErrorSerializer,
            409: SoulBatchRecycleErrorSerializer,
        },
    )
    @action(detail=False, methods=["post"], url_path="batch-recycle")
    def batch_recycle(self, request):
        """Move several souls to the recycle bin — all of them, or none.

        EACH SOUL GOES THROUGH EXACTLY WHAT destroy() DOES. The soul is
        reached through get_queryset() (tenant scope, DataScope, not deleted,
        not archived), checked with check_object_permissions() — the two
        halves of get_object() — and deleted with
        Soul.delete_with_cascade(), so the cascade to records and pending
        judgments, the shared cascade id and the audit rows written by the
        post_save signals are the single path's, not a copy of them.

        REFUSE-ALL, NOT PER-ID RESULTS. The single delete has two outcomes
        besides success: 404 when the soul is not reachable (another tenant's,
        outside the caller's data scope, already deleted, archived, or
        nonexistent — indistinguishable on purpose) and 409 with
        `archivable` when it has a concluded judgment. The batch reports the
        same two, with the same statuses, for the whole request:

          * 404 `not_found` — some ids are not reachable. Checked before any
            write. The listed ids are the caller's own input, so this says
            nothing the single endpoint's 404 would not.
          * 409 `not_deletable` — some souls have a concluded judgment. Every
            soul is attempted inside one transaction so that ALL blocked ids
            are reported, then the transaction is rolled back.

        Per-id results were rejected: a 207-style body makes "3 of 5 moved"
        a success the bar has to notice and explain, and it would turn a
        cross-tenant id into a partial success next to real deletions. The
        caller asked for one action on one selection; it either happened or
        the selection is wrong, and the body names every id that makes it so.

        Before either: 403 without `soul.delete` (destroy's codename), and 400
        with DRF field errors for an empty list, more than 100 ids, a
        non-UUID, a duplicate id, or a reason over 500 characters.
        """
        serializer = SoulBatchRecycleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ids = serializer.validated_data["ids"]
        reason = serializer.validated_data["reason"]

        # get_queryset() honours ?show_deleted=true; a recycle never should.
        reachable = set(
            self.get_queryset().filter(pk__in=ids, is_deleted=False).values_list("pk", flat=True)
        )
        missing = [pk for pk in ids if pk not in reachable]
        if missing:
            return self._batch_not_found(missing)

        with transaction.atomic():
            # Locked through the unfiltered manager rather than get_queryset():
            # that one carries select_related over nullable FKs and may carry
            # DISTINCT from the DataScope filter, and PostgreSQL refuses FOR
            # UPDATE on either. Scope was decided above; this only re-reads.
            locked = {
                soul.pk: soul
                for soul in Soul.all_objects.select_for_update().filter(
                    pk__in=ids, is_deleted=False, is_archived=False
                )
            }
            gone = [pk for pk in ids if pk not in locked]
            if gone:
                # Deleted or archived by someone else between the two reads.
                return self._batch_not_found(gone)

            results, blocked, archivable = [], [], True
            for pk in ids:
                soul = locked[pk]
                self.check_object_permissions(request, soul)
                try:
                    cascade_id = soul.delete_with_cascade(user=request.user, reason=reason)
                except DeletionNotAllowedError as exc:
                    blocked.append(pk)
                    archivable = archivable and exc.archivable
                    continue
                results.append({"id": pk, "cascade_id": cascade_id})

            if blocked:
                transaction.set_rollback(True)
                return Response(
                    {
                        "code": "not_deletable",
                        "error": (
                            "These souls have a concluded judgment and cannot be "
                            "deleted. Archive them instead. Nothing was deleted."
                        ),
                        "ids": blocked,
                        "archivable": archivable,
                    },
                    status=status.HTTP_409_CONFLICT,
                )

        return Response(
            SoulBatchRecycleResultSerializer({"recycled": len(results), "results": results}).data
        )

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "ids", OpenApiTypes.STR, required=False,
                description="逗号分隔的灵魂 id(UUID),至多 100 个;不传则导出列表当前筛选下的全部行",
            ),
        ],
        responses={(200, "text/csv"): OpenApiTypes.BINARY, 400: OpenApiTypes.OBJECT},
    )
    @action(detail=False, methods=["get"], url_path="export", pagination_class=None)
    def export(self, request):
        """所选灵魂(`ids`,批量条)或列表当前筛选下的全部灵魂(不带 `ids`,列表页「导出 CSV」)的 CSV。

        范围就是列表的范围 —— 行取自 `get_queryset()`(租户、DataScope、未删除、未归档),
        所以一个够不着的 id 只是不在文件里,与它根本不存在答同一件事。不带 `ids` 时再过
        `filter_queryset`,与列表同一组筛选、搜索与排序;超过 `EXPORT_MAX_ROWS` 行是 400,
        不截断(`apps/core/exports.py`)。自由文本格过 `csv_safe`。
        """
        if "ids" not in request.query_params:
            souls = self.filter_queryset(self.get_queryset())
            refuse_if_too_many(souls)
        else:
            raw = [part.strip() for part in request.query_params.get("ids", "").split(",") if part.strip()]
            try:
                ids = list(dict.fromkeys(uuid.UUID(part) for part in raw))
            except ValueError:
                ids = None
            # 与 batch-recycle 同一上限:批量条一次至多勾选一页。
            if not ids or len(ids) > SOUL_BATCH_RECYCLE_MAX:
                raise ValidationError({"ids": [f"1-{SOUL_BATCH_RECYCLE_MAX} comma-separated soul UUIDs."]})
            souls = self.get_queryset().filter(pk__in=ids, is_deleted=False).order_by("name", "pk")
        from apps.souls.dates import format_death_date

        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = "attachment; filename=souls_export.csv"
        writer = csv.writer(response)
        writer.writerow([
            "Soul ID", "Name", "Civilization", "State", "Merit Score", "Demerit Score",
            "Karmic Balance", "Death Date", "Created At",
        ])
        rows = 0
        # 文件里没有功过明细:不要列表为日期检查预取的 records / reincarnations(至多五万行)。
        for soul in souls.prefetch_related(None).iterator(chunk_size=2000):
            rows += 1
            writer.writerow([
                str(soul.id),
                csv_safe(soul.name),
                csv_safe(soul.civilization),
                csv_safe(soul.current_state),
                soul.merit_score,
                soul.demerit_score,
                soul.karmic_balance,
                csv_safe(format_death_date(soul)),
                soul.create_time.isoformat(),
            ])
        record_export(request, resource="soul", rows=rows)
        return response

    def _import_rows(self, request):
        """Upload -> (RowResults, tenant). Boundary checks live here and in importer._read."""
        upload = SoulImportUploadSerializer(data=request.data)
        upload.is_valid(raise_exception=True)
        tenant = getattr(request, "tenant", None)
        if tenant is None:
            raise _ImportRefusedError({"code": "no_tenant"})
        if not tenant.is_active:
            raise _ImportRefusedError({"code": "hall_inactive"})
        try:
            data = upload.validated_data["file"].read(importer.MAX_BYTES + 1)
            return importer.validate_csv(data, tenant), tenant
        except importer.ImportFileError as exc:
            raise _ImportRefusedError({"code": exc.code, **exc.detail}) from exc

    @extend_schema(
        request={"multipart/form-data": SoulImportUploadSerializer},
        responses={200: SoulImportPreviewSerializer, 400: SoulImportFileErrorSerializer},
    )
    @action(detail=False, methods=["post"], url_path="import/preview", pagination_class=None, filter_backends=[])
    def import_preview(self, request):
        """Validate a soul CSV row by row. WRITES NOTHING.

        Columns: name, civilization (required); birth_date, death_date, origin_location,
        birth_name, description, origin_region (`EUROPE` / `ASIA` / blank). Dates are `YYYY`, `YYYY-MM` or
        `YYYY-MM-DD`, negative for BCE. At most `importer.MAX_ROWS` rows. `civilization` must be the caller's own.
        """
        try:
            results, _tenant = self._import_rows(request)
        except _ImportRefusedError as refused:
            return refused.response()
        return Response(importer.summarize(results))

    @extend_schema(
        request={"multipart/form-data": SoulImportUploadSerializer},
        responses={
            201: SoulImportCommitSerializer,
            400: SoulImportFileErrorSerializer,
            422: SoulImportPreviewSerializer,
        },
    )
    @action(detail=False, methods=["post"], url_path="import/commit", pagination_class=None, filter_backends=[])
    def import_commit(self, request):
        """Create every soul in the file, or none. Re-validates the file itself.

        422 with the preview body when any row has an error (nothing written). On success
        one `IMPORT` audit row names the batch; each soul also gets its ordinary CREATE row.
        """
        from apps.audit.models import AuditAction, AuditLog
        from apps.core.client_ip import get_client_ip

        try:
            results, tenant = self._import_rows(request)
        except _ImportRefusedError as refused:
            return refused.response()
        if any(r.errors for r in results):
            return Response(importer.summarize(results), status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        try:
            with transaction.atomic():
                batch = importer.create_souls(results, tenant)
                AuditLog.objects.create(
                    tenant=tenant,
                    user=request.user,
                    action=AuditAction.IMPORT,
                    resource="soul",
                    resource_id=str(batch),
                    changes={
                        "batch_id": str(batch),
                        "created": len(results),
                        "filename": request.data["file"].name[:200],
                    },
                    ip_address=get_client_ip(request) or "",
                    user_agent=request.META.get("HTTP_USER_AGENT", "")[:500],
                    description=f"CSV import of {len(results)} souls",
                )
        except importer.ImportConflictError as conflict:
            return Response(importer.summarize(conflict.results), status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        return Response({"created": len(results), "batch_id": batch}, status=status.HTTP_201_CREATED)

    def _region_upload(self, request):
        """Upload -> (bytes, the souls this caller may edit). Same boundary checks as `_import_rows`."""
        from apps.perm.filters import DataScopeFilter

        upload = SoulImportUploadSerializer(data=request.data)
        upload.is_valid(raise_exception=True)
        if getattr(request, "tenant", None) is None:
            raise _ImportRefusedError({"code": "no_tenant"})
        # The caller's own hall only — ADMIN included (admin_bypass=False): the file is applied to the hall
        # the request is in, never across halls. Archived souls are left out, as the edit form leaves them out.
        souls = scope_to_tenant(Soul.objects.filter(is_archived=False), request, admin_bypass=False)
        souls = DataScopeFilter.filter_queryset(request, souls, Soul)
        return upload.validated_data["file"].read(importer.MAX_BYTES + 1), souls

    @extend_schema(
        request={"multipart/form-data": SoulImportUploadSerializer},
        responses={200: SoulRegionUpdatePreviewSerializer, 400: SoulImportFileErrorSerializer},
    )
    @action(detail=False, methods=["post"], url_path="region-update/preview", pagination_class=None, filter_backends=[])
    def region_update_preview(self, request):
        """Check a CSV that sets `origin_region` on existing souls, row by row. WRITES NOTHING.

        Columns: exactly one of `soul_id` (UUID; the export's `Soul ID` heading counts) / `soul_code`, and
        `origin_region` (`EUROPE` / `ASIA` / `UNKNOWN`, `Europe` / `Asia` / `Unknown`, `欧洲` / `亚洲` / `不详`,
        any case, blank = unknown — `region_update.REGION_SPELLINGS`). Any other column is ignored. Same size
        and row limits as the import. A soul of another hall is `not_found`. Rows whose status is not `ok` /
        `unchanged` are the ones commit will skip (`skipped_count`).
        """
        try:
            data, souls = self._region_upload(request)
            rows = region_update.validate_csv(data, souls)
        except _ImportRefusedError as refused:
            return refused.response()
        except importer.ImportFileError as exc:
            return _ImportRefusedError({"code": exc.code, **exc.detail}).response()
        return Response(region_update.summarize(rows))

    @extend_schema(
        request={"multipart/form-data": SoulImportUploadSerializer},
        responses={
            200: SoulRegionUpdateCommitSerializer,
            400: SoulImportFileErrorSerializer,
        },
    )
    @action(detail=False, methods=["post"], url_path="region-update/commit", pagination_class=None, filter_backends=[])
    def region_update_commit(self, request):
        """Apply the file: re-validated under row locks, only changed rows written, rows in error skipped.

        `rows` lists the skipped rows with their status (user decision 2026-10-19: skip, don't refuse the
        file). Each changed soul gets its ordinary UPDATE audit row; one BATCH_UPDATE row names the file.
        Re-running the same file changes nothing and writes no audit row.
        """
        from apps.audit.models import AuditAction, AuditLog
        from apps.core.client_ip import get_client_ip

        try:
            data, souls = self._region_upload(request)
            with transaction.atomic():
                rows = region_update.apply(data, souls)
                summary = region_update.summarize(rows)
                updated, unchanged = summary["changed_count"], summary["unchanged_count"]
                skipped = [r.as_dict() for r in rows if r.status in region_update.ERRORS]
                if updated:
                    AuditLog.objects.create(
                        tenant=request.tenant,
                        user=request.user,
                        action=AuditAction.BATCH_UPDATE,
                        resource="soul",
                        changes={
                            "field": "origin_region",
                            "updated": updated,
                            "unchanged": unchanged,
                            "skipped": len(skipped),
                            "filename": request.data["file"].name[:200],
                        },
                        ip_address=get_client_ip(request) or "",
                        user_agent=request.META.get("HTTP_USER_AGENT", "")[:500],
                        description=f"CSV origin_region update of {updated} souls",
                    )
        except _ImportRefusedError as refused:
            return refused.response()
        except importer.ImportFileError as exc:
            return _ImportRefusedError({"code": exc.code, **exc.detail}).response()
        return Response({"updated": updated, "unchanged": unchanged, "skipped": len(skipped), "rows": skipped})

    @staticmethod
    def _batch_not_found(ids):
        return Response(
            {
                "code": "not_found",
                "error": "These souls were not found. Nothing was deleted.",
                "ids": ids,
            },
            status=status.HTTP_404_NOT_FOUND,
        )

    @action(detail=True, methods=["post"])
    def archive(self, request, pk=None):
        """Archive a soul that has a concluded judgment and so cannot be
        deleted — removes it from normal lists without pretending the
        judicial history can be unwound. See Soul.has_concluded_judgment."""
        soul = self.get_object()
        if not soul.has_concluded_judgment:
            return Response(
                {"error": "This soul has no concluded judgment; delete it instead of archiving."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        reason = request.data.get("reason", "")
        soul.archive(user=request.user, reason=reason)
        return Response(SoulSerializer(soul).data)

    @action(detail=True, methods=["post"])
    def unarchive(self, request, pk=None):
        """Undo archive(): the soul returns to the lists."""
        soul = self.get_object()
        soul.unarchive()
        return Response(SoulSerializer(soul).data)

    @action(detail=True, methods=["post"])
    def correct_settlement(self, request, pk=None):
        """Revert a SETTLED soul to DISPOSED to fix a data-entry error.

        Not a state transition (SETTLED's one transition belongs to reopening a
        finished sentence plan) — an ADMIN-only, reason-required, separately audited
        correction. See Soul.correct_settlement.
        """
        soul = self.get_object()
        reason = request.data.get("reason", "")
        if not reason:
            return Response(
                {"error": "A reason is required to correct a settlement."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            soul.correct_settlement(user=request.user, reason=reason)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(SoulSerializer(soul).data)

    @action(detail=True, methods=["post"])
    def die(self, request, pk=None):
        """Mark soul as dead and begin judgment."""
        soul = self.get_object()
        if soul.current_state != SoulState.ALIVE:
            return Response(
                {"error": f"Cannot die: soul is already {soul.current_state}"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        location = request.data.get("location", "")
        death_date = request.data.get("death_date")
        try:
            # Parse before soul.die() so the date can be checked against the
            # soul's birth. This endpoint writes death_date straight from the
            # request body and never touches SoulSerializer, so without this
            # it was the one way past the cross-date rules the serializer
            # enforces — and the likeliest one to carry a bad date, since it
            # is where a death gets entered in a hurry.
            parsed_death = parse_historical_date(death_date)
        except ValueError as exc:
            # Malformed death_date (e.g. bad string, year 0, out-of-range
            # month/day) — see apps.souls.dates.parse_historical_date.
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        # Same rules as SoulSerializer.validate, called rather than restated,
        # so the two cannot drift apart.
        errors = [
            p.message
            for p in check_soul_dates(
                (soul.birth_year, soul.birth_month, soul.birth_day), parsed_death
            )
            if p.severity == ERROR
        ]
        if errors:
            return Response({"error": " ".join(errors)}, status=status.HTTP_400_BAD_REQUEST)

        try:
            success = soul.die(death_date=death_date, location=location)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        if success:
            return Response(SoulSerializer(soul).data)
        return Response({"error": "Transition failed"}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=["post"])
    def transition(self, request, pk=None):
        """Manually trigger a state transition."""
        soul = self.get_object()
        serializer = SoulTransitionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        new_state = serializer.validated_data["new_state"]
        reason = serializer.validated_data.get("reason", "")

        # JUDGING is only reachable from ALIVE (Soul.can_transition_to), which
        # is exactly the transition die() performs — so a request landing here
        # with new_state=JUDGING is requesting the same outcome /die/ produces,
        # through a codename (soul.transition) that GUARDIAN holds and soul.die
        # does not extend to it. Investigated before adding this: every OTHER
        # transition_to() call site in the codebase is gated by its own
        # narrower codename that does not run through this action at all —
        # JUDGING->DISPOSED moves through judgment.execute
        # (apps/judgment/services.py), DISPOSED->{REINCARNATING,SETTLED,LOST}
        # through disposition.execute (apps/disposition/services.py), and
        # REINCARNATING->ALIVE through reincarnation.manage/.complete/.reborn
        # (apps/reincarnation/services.py, apps/reincarnation/views.py), none
        # of which call this action either. So this endpoint has no
        # discovered legitimate use for GUARDIAN today, and scoping only the
        # JUDGING target closes the die bypass without narrowing anything
        # `transition` is otherwise doing. See
        # apps/perm/test_matrix_snapshot.py,
        # test_guardian_denied_soul_die_now_stays_denied_through_transition,
        # for the characterization this closes.
        if new_state == SoulState.JUDGING:
            from apps.perm.checker import check_permission
            if not check_permission(request.user, "soul.die"):
                return Response(
                    {
                        "error": (
                            "Not authorized to transition to JUDGING. This is the "
                            "state change /die/ performs; use that action, which "
                            "requires soul.die."
                        )
                    },
                    status=status.HTTP_403_FORBIDDEN,
                )

        # Marking a soul missing, or recalling it, says why (2026-10-24): the reason is the only record of what
        # happened in transit.
        lost_move = new_state == SoulState.LOST or soul.current_state == SoulState.LOST
        if lost_move and not reason.strip():
            return Response(
                {"error": "A reason is required to mark a soul lost or to recall it", "code": "reason_required"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not soul.can_transition_to(new_state):
            return Response(
                {"error": f"Invalid transition from {soul.current_state} to {new_state}"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        # Only the hand-made moves are offered here (2026-10-27 user decision): death (ALIVE → JUDGING, gated on
        # soul.die above) and missing / recalled (DISPOSED ⇄ LOST). JUDGING → DISPOSED, DISPOSED → REINCARNATING /
        # SETTLED and REINCARNATING → ALIVE belong to concluding a judgment, a sentence plan and a rebirth; driven
        # by hand they skip every gate those doors keep and leave a case nobody can close.
        if not (new_state == SoulState.JUDGING or lost_move):
            return Response(
                {"error": f"{soul.current_state} → {new_state} is not a manual move; it happens through its own "
                          "business action", "code": "transition_not_manual"},
                status=status.HTTP_409_CONFLICT,
            )
        # The return value used to be discarded. `can_transition_to` above runs
        # outside the row lock and `transition_to` re-decides inside it, so a
        # refusal there -- a concurrent transition, or now a terminal cosmology
        # being asked to reincarnate -- produced a 200 carrying a serialized
        # soul that had not moved. An interface that answers "done" to a
        # request it declined is worse than one that declines loudly.
        # 经办人记进 STATE_CHANGED 的 actor:账页与失踪横条的「经办」读它。
        if not soul.transition_to(new_state, reason, actor=request.user.username):
            soul.refresh_from_db()
            return Response(
                {
                    "error": (
                        f"Transition to {new_state} was refused. The soul is in "
                        f"{soul.current_state}."
                    ),
                    "current_state": soul.current_state,
                },
                status=status.HTTP_409_CONFLICT,
            )
        return Response(SoulSerializer(soul).data)

    @extend_schema(responses=LedgerSummarySerializer)
    @action(detail=True, methods=["get"])
    def karma(self, request, pk=None):
        """Get full karma summary for a soul."""
        soul = self.get_object()
        summary = LedgerService.get_ledger_summary(soul)
        return Response(summary)

    @action(detail=True, methods=["post"])
    def add_record(self, request, pk=None):
        """Add a merit or demerit record to a soul."""
        soul = self.get_object()
        serializer = SoulRecordSerializer(data=request.data, context={"tenant_id": soul.tenant_id})
        if not serializer.is_valid():
            return _record_errors(serializer)
        record = serializer.save(soul=soul)
        return Response(SoulRecordSerializer(record).data, status=status.HTTP_201_CREATED)

    @extend_schema(
        request=SoulRecordSerializer,
        responses=SoulRecordSerializer,
        parameters=[
            OpenApiParameter(
                "record_id", OpenApiTypes.UUID, OpenApiParameter.PATH,
                description="The SoulRecord's primary key (the id belongs to the related record, not to `Soul`).",
            )
        ],
    )
    @action(detail=True, methods=["patch"], url_path=r"records/(?P<record_id>[^/.]+)")
    def update_record(self, request, pk=None, record_id=None):
        """Edit one merit/demerit record on this soul (partial).

        The same serializer and the same validation as `add_record` — dates against the soul,
        the clause/count pair, the statute against the soul's civilization — with the record as
        instance. The statute snapshot is re-taken by `SoulRecord.save` only when the cited
        statute changes. Gated by `ledger.manage`, like `add_record`; 409 once a concluded case admitted it.
        """
        soul = self.get_object()
        try:
            record = soul.records.get(pk=record_id)
        except (SoulRecord.DoesNotExist, DjangoValidationError):
            return Response({"error": "Record not found on this soul."}, status=status.HTTP_404_NOT_FOUND)
        from apps.judgment.services import EvidenceAdmissionService

        if EvidenceAdmissionService.admitted_in_concluded_case(record):
            return Response({"error": "This record was admitted as evidence in a concluded case and cannot be edited.",
                             "code": "admitted_in_concluded_case"}, status=status.HTTP_409_CONFLICT)
        serializer = SoulRecordSerializer(record, data=request.data, partial=True, context={"soul": soul})
        if not serializer.is_valid():
            return _record_errors(serializer)
        record = serializer.save()
        # save() 只在新建时重算;改权重 / 类型要同一条共用的重算路径,否则 merit_score 停在旧值。
        record._update_soul_karma()
        return Response(SoulRecordSerializer(record).data)

    @extend_schema(responses=SoulRecordSerializer(many=True))
    @action(detail=True, methods=["get"], pagination_class=None)
    def records(self, request, pk=None):
        """List all records for a soul."""
        soul = self.get_object()
        records = soul.records.all()
        serializer = SoulRecordSerializer(records, many=True)
        return Response(serializer.data)

    @extend_schema(responses=SoulPathEntrySerializer(many=True))
    @action(detail=True, methods=["get"], pagination_class=None)
    def path(self, request, pk=None):
        """The soul's route through the realms, oldest stop first (行程拓扑).

        A separate endpoint rather than a field on the soul detail: the entries
        are scoped **per entry**, not per soul — a stop served while residing in
        another tenant belongs to that tenant — so they need their own
        `scope_to_tenant` pass, and the soul list / detail payloads (and their
        query counts) stay as they were.
        """
        from apps.realms.models import SoulPathEntry

        soul = self.get_object()
        entries = scope_to_tenant(
            SoulPathEntry.objects.filter(soul=soul).select_related("realm"),
            request,
            residence_read=residence_read_allowed(self),
        ).order_by("sequence")
        return Response(SoulPathEntrySerializer(entries, many=True).data)

    @extend_schema(request=SoulStationMoveSerializer, responses={200: SoulSerializer, 409: SoulStationRefusalSerializer})
    @action(detail=True, methods=["post"])
    def station(self, request, pk=None):
        """挪到地府十三站的某一站(docs/06 §一;规则在 `apps/souls/stations.py`)。地府的、不在世的灵魂;
        可以往回挪。拒绝:`not_diyu` / `alive`(409)。"""
        from apps.souls import stations

        body = SoulStationMoveSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        soul = self.get_object()
        try:
            soul = stations.move(soul, body.validated_data["station"], request.user)
        except stations.StationRefusedError as exc:
            return Response({"code": exc.code, "error": exc.detail}, status=status.HTTP_409_CONFLICT)
        return Response(SoulSerializer(soul, context=self.get_serializer_context()).data)

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "record_id",
                OpenApiTypes.UUID,
                OpenApiParameter.PATH,
                description=(
                    "The SoulRecord's primary key. drf-spectacular cannot infer "
                    "this one: it looks the name up on the viewset's model, and "
                    "`Soul` has no `record_id` field — the id belongs to the "
                    "related SoulRecord. Left un-annotated it defaults to "
                    "`string`, which is the same silent widening an un-hinted "
                    "SerializerMethodField suffers."
                ),
            )
        ]
    )
    @action(
        detail=True,
        methods=["post"],
        url_path=r"records/(?P<record_id>[^/.]+)/acknowledge-date-warning",
    )
    def acknowledge_record_date_warning(self, request, pk=None, record_id=None):
        """Acknowledge a record's `event_after_death` DateProblem WARNING.

        `self.get_object()` runs TenantPermission's object check on the
        soul, same as every other detail action here — an operator who can
        reach this soul at all can acknowledge warnings on its records; no
        separate codename, following the precedent `add_record` already
        set for soul.update covering record-level writes.

        The acting user comes from `request.user` only. Nothing in the
        request body is trusted for who — a client-supplied "acknowledged_by"
        would let one operator's action be attributed to another.

        Only `event_after_death` is acknowledgeable. The other DateProblems
        (`death_before_birth`, `implausible_lifespan`, `event_before_birth`)
        are ERRORs: the write that would have created them is refused
        before it lands, so there is never a persisted row carrying one to
        acknowledge.
        """
        soul = self.get_object()
        try:
            record = soul.records.get(pk=record_id)
        except SoulRecord.DoesNotExist:
            return Response(
                {"error": "Record not found on this soul."},
                status=status.HTTP_404_NOT_FOUND,
            )
        except DjangoValidationError:  # not a UUID: a 400, not a 500 (rbac-be1 L7)
            return Response({"error": "record_id is not a valid id.", "code": "invalid_record_id"},
                            status=status.HTTP_400_BAD_REQUEST)

        event = (record.event_year, record.event_month, record.event_day)
        birth = (soul.birth_year, soul.birth_month, soul.birth_day)
        death = (soul.death_year, soul.death_month, soul.death_day)
        problems = check_record_date(event, birth, death)
        if not any(p.code == "event_after_death" for p in problems):
            return Response(
                {"error": "This record has no event_after_death warning to acknowledge."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        record.date_warning_acknowledged_by = request.user
        record.date_warning_acknowledged_at = timezone.now()
        record.date_warning_ack_fingerprint = date_warning_fingerprint(event, death)
        record.save()
        return Response(SoulRecordSerializer(record).data)

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "record_id",
                OpenApiTypes.UUID,
                OpenApiParameter.PATH,
                description=(
                    "The SoulRecord's primary key. drf-spectacular cannot infer "
                    "this one: it looks the name up on the viewset's model, and "
                    "`Soul` has no `record_id` field — the id belongs to the "
                    "related SoulRecord. Left un-annotated it defaults to "
                    "`string`, which is the same silent widening an un-hinted "
                    "SerializerMethodField suffers."
                ),
            )
        ]
    )
    @action(
        detail=True,
        methods=["post"],
        url_path=r"records/(?P<record_id>[^/.]+)/unacknowledge-date-warning",
    )
    def unacknowledge_record_date_warning(self, request, pk=None, record_id=None):
        """Undo a prior acknowledgment of a record's `event_after_death` warning.

        Clears all three ack fields regardless of whether the fingerprint
        still matches — an operator revoking a stale (already-inert) ack is
        harmless, and refusing it over a mismatch that made it inert anyway
        would just be a confusing error for no protective benefit.
        """
        soul = self.get_object()
        try:
            record = soul.records.get(pk=record_id)
        except SoulRecord.DoesNotExist:
            return Response(
                {"error": "Record not found on this soul."},
                status=status.HTTP_404_NOT_FOUND,
            )
        except DjangoValidationError:  # not a UUID: a 400, not a 500 (rbac-be1 L7)
            return Response({"error": "record_id is not a valid id.", "code": "invalid_record_id"},
                            status=status.HTTP_400_BAD_REQUEST)

        record.date_warning_acknowledged_by = None
        record.date_warning_acknowledged_at = None
        record.date_warning_ack_fingerprint = ""
        record.save()
        return Response(SoulRecordSerializer(record).data)
