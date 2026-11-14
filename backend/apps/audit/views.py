"""
Audit views - AuditLog ViewSet with filtering support.
"""
import csv
import json
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.db.models import Q
from django.http import HttpResponse
from django.utils.dateparse import parse_date
from django_filters import rest_framework as filters
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.core.csv_safe import csv_safe
from apps.core.exports import EXPORT_MAX_ROWS, record_export, refuse_if_too_many
from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.problems import problem
from apps.core.tenant import is_tenant_exempt, request_tenant, scope_to_tenant
from apps.core.viewsets import CodenameViewSetMixin
from apps.soul_assist.views import OfficerAssistThrottle

from .models import AuditAction, AuditLog
from .serializers import (
    AuditActionOptionSerializer,
    AuditLogDetailSerializer,
    AuditLogSerializer,
    AuditStatsSerializer,
    NlFilterErrorSerializer,
    NlFilterRequestSerializer,
    NlFilterResponseSerializer,
)


def is_global_admin(user) -> bool:
    """ADMIN with no hall of their own. Only this person may read across halls in the audit log
    (list, export and the 「殿」 filter); an ADMIN bound to a hall sees that hall's rows only."""
    return is_tenant_exempt(user)


def _hall_scope(qs, request):
    """The one scoping rule of this module: only a global admin reads across halls; a hall-bound ADMIN
    and everyone else see their own hall's rows (nothing at all when no hall resolves)."""
    return scope_to_tenant(qs, request, admin_bypass=is_global_admin(request.user))


class AuditLogFilter(filters.FilterSet):
    """`resource` 精确匹配,只有一个别名:`tenant`(审计页的「殿」)同时含每殿助手开关的那几行 ——
    它们的 resource 是 `assistant_config`、resource_id 是 `tenant:<殿码>`(soul_assist/admin_views.py)。
    只在查询时并入,不改已存的行。"""

    resource = filters.CharFilter(method="filter_resource")
    #: 审计页的「殿」下拉:一个殿的**码**(`CN_DIYU`)。全局管理员(`ADMIN`,跨租户)可选任何一个殿;
    #: 其余人只看得到自己殿的行(`get_queryset` 已划界),这里再拒绝他们点别的殿的名 —— 403,
    #: 而不是一页恰好为空的 200。不存在的殿码是 400。
    tenant = filters.CharFilter(method="filter_tenant")
    #: 审计页的「操作人」(review-2026-11-01 Web 6):按用户名精确匹配。行上带的是 `username`
    #: 不是 id,所以页面只能按名字筛;`search` 也搜用户名,但它是模糊的、还连带资源与描述。
    username = filters.CharFilter(field_name="user__username", lookup_expr="exact")

    class Meta:
        model = AuditLog
        fields = ["user", "action", "resource", "resource_id", "trace_id"]

    def filter_tenant(self, queryset, name, value):
        from apps.tenants.models import Tenant

        request = self.request
        user = getattr(request, "user", None)
        if not is_global_admin(user):
            own = request_tenant(request)
            if own is None or own.code != value:
                raise PermissionDenied("Only an administrator can read another hall's audit log.")
            return queryset.filter(tenant=own)
        tenant = Tenant.objects.filter(code=value).first()
        if tenant is None:
            raise ValidationError({"tenant": "Unknown hall."})
        return queryset.filter(tenant=tenant)

    def filter_resource(self, queryset, name, value):
        if value == "tenant":
            return queryset.filter(Q(resource="tenant") | Q(resource="assistant_config", resource_id__startswith="tenant:"))
        return queryset.filter(resource=value)


#: `/audit-logs/timeline/?limit=` 的上界。没有它,`?limit=999999999` 是一次全表
#: 扫描,而它返回 **200** —— 一个「成功」的响应,是最不容易被发现的拒绝服务面。
#:
#: 2026-08-29 台账 M29 记「已修 0574c0c」,那次 diff 只加了这个常量,没有一处
#: 引用它 —— 记为已修、实际未落地,直到 2026-09-12(BP-02)`_parse_limit` 用上它。
TIMELINE_MAX_LIMIT = 500
TIMELINE_DEFAULT_LIMIT = 50

# 导出上限 `EXPORT_MAX_ROWS` 与其他导出同一个(`apps.core.exports`)。超过就是 400,不是截断的文件:
# 一份悄悄少了行的审计导出,比没有导出更糟(与 `/ledger/journal/export/` 的 MONTH_TOO_LARGE 同一立场)。


def parse_date_param(params, name):
    """`?start_date=垃圾` 曾经直接进 `timestamp__date__gte`,Django 抛 ValidationError,
    DRF 不认它 → 500。DRF 自己的 ValidationError 才是 400。"""
    raw = params.get(name)
    if not raw:
        return None
    # `parse_date` returns None for a malformed string but RAISES ValueError for a well-formed
    # impossible one (`2026-13-40`): both are the caller's mistake, both are a 400.
    try:
        value = parse_date(raw)
    except ValueError:
        value = None
    if value is None:
        raise ValidationError({name: f"'{raw}' is not a date (expected YYYY-MM-DD)."})
    return value


def _midnight(day, tz):
    """`day` 0 点(`tz`)的 aware datetime;落在 datetime 能表示的范围外(0001-01-01 在东区)时是 None ——
    那一端不设界,与 `__date` 在那一天的结果相同。"""
    try:
        return datetime.combine(day, time.min, tzinfo=tz).astimezone(UTC)
    except OverflowError:
        return None


def caller_hall_tz(request) -> ZoneInfo:
    """切日用的时区:**调用者所在殿**的 `Tenant.hall_timezone`(设置 → 文明默认 → UTC)。
    没有殿的请求(无租户的全局管理员等)用 UTC —— `hall_timezone` 只在有殿时才答得出。

    跨殿的视图(全局管理员看所有殿的审计)同样按调用者的殿切日,而不是每行按它自己的殿:
    与本殿概览 / 年报同一个先例(`apps/judgment/hall_stats.py` `overview`、`apps/judgment/annual.py` `report`,
    都取请求的殿,无殿为 UTC)。逐行按殿的 `Judgment.concluded_tz` 只用于写出一件文书的日期,不用于筛选:
    一个「某日」的筛选框只能有一条日界。"""
    tenant = request_tenant(request) if request is not None else None
    return ZoneInfo(tenant.hall_timezone if tenant is not None else "UTC")


def date_range_q(params, field, tz) -> Q:
    """`?start_date=` / `?end_date=`(两端都含)在 `field` 上的半开区间:
    `field >= start 0 点` 且 `field < end 次日 0 点`,0 点按 `tz`(调用方给 `caller_hall_tz(request)`)。

    此前是 `field__date__gte/lte`(按 UTC 取日期):列先换时区再取日期,索引用不上(be-scale 4.4)。
    按殿的时区切日是用户 2026-11-14 的决定 —— 非 UTC 殿的结果因此与此前不同(东八区的殿,UTC 16:00 之后的
    行归到下一天)。同一时区下与 `__date` 选出的行相同(`tests/test_date_range_filter.py`)。"""
    q = Q()
    start = parse_date_param(params, "start_date")
    if start and (lower := _midnight(start, tz)) is not None:
        q &= Q(**{f"{field}__gte": lower})
    end = parse_date_param(params, "end_date")
    if end and end < date.max and (upper := _midnight(end + timedelta(days=1), tz)) is not None:
        q &= Q(**{f"{field}__lt": upper})
    return q


def _parse_limit(params):
    """Positive integer, clamped to TIMELINE_MAX_LIMIT; anything else is a 400.

    `int(...)` alone was `abc` → 500, `-1` → a negative slice Django refuses → 500,
    and `999999999` → the whole table with a 200.
    """
    raw = params.get("limit")
    if raw is None:
        return TIMELINE_DEFAULT_LIMIT
    try:
        value = int(raw)
    except (TypeError, ValueError):
        value = 0
    if value < 1:
        raise ValidationError({"limit": f"'{raw}' is not a positive integer."})
    return min(value, TIMELINE_MAX_LIMIT)


class AuditLogViewSet(CodenameViewSetMixin, viewsets.ReadOnlyModelViewSet):
    """
    AuditLog ViewSet with filtering support.

    Supports filtering by:
    - user: User ID who performed the action
    - action: Action type (CREATE, UPDATE, DELETE, etc.)
    - resource: Resource type (soul, judgment, karma, etc.)
    - resource_id: Specific resource ID
    - start_date/end_date: Time range filter

    Example:
        GET /api/v1/audit-logs/?user=1&action=CREATE&resource=soul
        GET /api/v1/audit-logs/?start_date=2024-01-01&end_date=2024-12-31
    """
    # `permission_codename = "audit"` and the extra_permissions below declared
    # what this viewset needs and nothing enforced it: the codename was
    # decorative. Measured 2026-08-29, a VIEWER -- which does not hold
    # `audit.read` -- got 200 from `GET /api/v1/audit-logs/` and from
    # `/timeline/`, the permission-change timeline. Only `stats` was safe, and
    # only because someone hand-wrote a role check inside it.
    #
    # `apps/perm/test_codename_coverage.py` could not catch this: it asserts
    # that a declared codename is defined and held by someone, never that the
    # class which enforces it is attached. The 48-line docstring below reasons
    # carefully about *which* codenames belong here and never asks whether
    # anything reads them.
    permission_classes = [TenantPermission, CodenamePermission]
    # BINARY on `audit.read`, which is what the module already is: a
    # ReadOnlyModelViewSet, so every routed action is a read and there is no
    # write codename to want. `audit.read` is seeded and held by ADMIN (and by
    # MODERATOR until 2026-11-07).
    #
    # by_trace and timeline are listed here because they were not: they are
    # @action reads, and without an entry the mixin fell through to
    # `audit.by_trace` / `audit.timeline`, two codenames that exist nowhere.
    # (The audit report missed these two and instead listed
    # audit.create/update/delete, which this viewset cannot generate at all.)
    permission_codename = "audit"
    extra_permissions = {
        'actions': ['audit.read'],
        'resources': ['audit.read'],
        'stats': ['audit.read'],
        'by_trace': ['audit.read'],
        'timeline': ['audit.read'],
        'export': ['audit.export'],
        # 只把问题换成筛选参数(nl_query.py),不读日志;查询照旧走 list,所以与 list 同一个码。
        'nl_filter': ['audit.read'],
    }
    serializer_class = AuditLogSerializer
    filterset_class = AuditLogFilter
    # `?search=` (SearchFilter is a default backend). The list page's search box used to filter
    # only the 20 rows it had fetched; the export runs the same `filter_queryset`, so it follows.
    search_fields = ["resource", "resource_id", "description", "user__username"]
    ordering_fields = ["timestamp", "action", "resource"]
    ordering = ["-timestamp"]

    def get_queryset(self):
        """Filter queryset based on user permissions and query params."""
        # Non-admin users can only see their own tenant's logs.
        # A hall-bound ADMIN is scoped like everyone else here (admin_bypass off); only a
        # global admin (no hall) reads every hall.
        qs = scope_to_tenant(
            AuditLog.objects.select_related("user__tenant", "tenant").all(), self.request,
            admin_bypass=is_global_admin(self.request.user),
        )

        # Apply query param filters
        user_id = self.request.query_params.get('user_id')
        if user_id:
            try:
                user_id = int(user_id)
            except ValueError:
                # `?user_id=abc` went straight into the filter and the ORM's ValueError was a 500.
                raise ValidationError({"user_id": f"'{user_id}' is not an integer."}) from None
            qs = qs.filter(user_id=user_id)

        action_param = self.request.query_params.get('action')
        if action_param:
            qs = qs.filter(action=action_param.upper())

        resource_id = self.request.query_params.get('resource_id')
        if resource_id:
            qs = qs.filter(resource_id=resource_id)

        qs = qs.filter(date_range_q(self.request.query_params, 'timestamp', caller_hall_tz(self.request)))

        return qs

    def get_serializer_class(self):
        if self.action == "retrieve":
            return AuditLogDetailSerializer
        return AuditLogSerializer

    @extend_schema(
        responses={
            (200, "text/csv"): OpenApiResponse(
                response=OpenApiTypes.BINARY,
                description=(
                    "CSV of the audit rows the list would return for the same query params "
                    "(same tenant scope, same filters, same ordering), all pages, not paginated: "
                    "Timestamp, Tenant, User, Action, Resource, Resource ID, Description, IP, Trace ID."
                ),
            ),
            400: OpenApiResponse(description=f"A filter is malformed, or more than {EXPORT_MAX_ROWS} rows match."),
        },
    )
    @action(detail=False, methods=["get"], pagination_class=None)
    def export(self, request):
        """
        GET /api/v1/audit-logs/export/?action=&resource=&start_date=&ordering=...
        与列表同一组筛选、同一租户划界、同一权限(audit.read);不分页。自由文本格一律过 `csv_safe`。
        """
        # `filter_queryset(get_queryset())` is exactly what `list` runs, so the file
        # and the screen cannot drift apart on scope or filters.
        qs = self.filter_queryset(self.get_queryset())
        refuse_if_too_many(qs)

        response = HttpResponse(content_type="text/csv")
        response["Content-Disposition"] = "attachment; filename=audit_logs.csv"
        writer = csv.writer(response)
        writer.writerow([
            "Timestamp", "Tenant", "User", "Action", "Resource", "Resource ID",
            "Description", "IP", "Trace ID",
        ])
        rows = 0
        for log in qs.iterator(chunk_size=1000):
            rows += 1
            writer.writerow([
                log.timestamp.isoformat(),
                csv_safe(log.tenant.code if log.tenant else ""),
                csv_safe(log.user.username if log.user else "System"),
                csv_safe(log.action),
                csv_safe(log.resource),
                csv_safe(log.resource_id),
                csv_safe(log.description),
                csv_safe(log.ip_address),
                csv_safe(log.trace_id),
            ])
        # The export itself is audited -- after the loop, so the file never lists its own row.
        record_export(request, resource="audit_log", rows=rows)
        return response

    @extend_schema(responses=AuditActionOptionSerializer(many=True))
    # `pagination_class=None` because this returns the whole enum as a bare
    # array. Without it drf-spectacular documents any `many=True` response on
    # a paginated viewset as a page envelope, and the document would promise
    # `{count, results}` where the view sends a list.
    @action(detail=False, methods=["get"], pagination_class=None)
    def actions(self, request):
        """
        GET /api/v1/audit-logs/actions/
        Returns all available action types.
        """
        return Response([
            {"value": choice[0], "label": choice[1]}
            for choice in AuditAction.choices
        ])

    @extend_schema(
        responses=OpenApiResponse(
            response={"type": "array", "items": {"type": "string"}},
            description="Distinct `resource` values present in the caller's audit log.",
        )
    )
    @action(detail=False, methods=["get"])
    def resources(self, request):
        """
        GET /api/v1/audit-logs/resources/
        Returns all resource types that have audit logs (tenant-scoped).
        """
        # A user with no resolvable hall gets an empty queryset rather than an early
        # `Response([])`. Same response body, one less copy of the idiom -- see apps/core/tenant.py.
        qs = _hall_scope(AuditLog.objects.all(), request)
        resources = (
            qs.values_list("resource", flat=True)
            .distinct()
            .order_by("resource")
        )
        return Response(list(resources))

    @extend_schema(responses=AuditStatsSerializer)
    @action(detail=False, methods=["get"])
    def stats(self, request):
        """
        GET /api/v1/audit-logs/stats/
        Returns statistics about audit logs.
        Same `audit.read` gate and hall scoping as the list.
        """
        # A hand-written ADMIN-only check used to sit here, refusing a MODERATOR (who holds `audit.read`)
        # the counts of rows they can already list. Removed 2026-10-17; the gate is `extra_permissions`.
        from django.db.models import Count

        # Same scoping as the list: only the global admin (no hall) counts every hall; everyone else,
        # hall-bound ADMIN included, counts their own hall.
        qs = _hall_scope(AuditLog.objects.all(), request)

        action_stats = (
            qs.values("action")
            .annotate(count=Count("id"))
            .order_by("-count")
        )

        resource_stats = (
            qs.values("resource")
            .annotate(count=Count("id"))
            .order_by("-count")[:20]
        )

        return Response({
            "action_distribution": list(action_stats),
            "top_resources": list(resource_stats),
            "total_logs": qs.count(),
        })

    @extend_schema(responses=AuditLogSerializer(many=True))
    @action(detail=False, methods=["get"], url_path="timeline", pagination_class=None)
    def timeline(self, request):
        """
        GET /api/v1/audit-logs/timeline/
        权限变更时间线 — 查询权限相关操作的审计日志。

        Query params:
            resource: 资源类型,精确匹配(小写,如 role、rolepermission、menu、menubutton);不传时取 6 类权限资源
            action: 操作类型过滤 (CREATE, UPDATE, DELETE, PERMISSION_CHANGE)
            start_date: 开始日期 (YYYY-MM-DD)
            end_date: 结束日期 (YYYY-MM-DD)
            limit: 返回条数 (默认 50,上限 TIMELINE_MAX_LIMIT;非正整数 400)
        """
        qs = _hall_scope(AuditLog.objects.select_related("user").all(), request)

        # Permission-related resource types. LOWERCASE: every write path derives
        # `resource` from `_meta.label_lower` and migration 0009 folded the old
        # CamelCase rows to match — so this list, still spelled 'Role',
        # 'RolePermission', matched nothing on a case-sensitive `IN` and the
        # default timeline (no `?resource=`) was empty. Found 2026-09-12 by the
        # limit test seeding 'role' rows and getting 0 back.
        permission_resources = [
            'role', 'rolepermission', 'menu', 'menubutton', 'fieldpermission', 'permission'
        ]  # the two old scope tables went in 数据范围 B7; a role's data scope is audited as 'role'

        # Exact, not icontains (2026-10-17, 用户决定): `role` used to bring back every
        # `rolepermission` row and `menu` every `menubutton` row, so the page had to
        # re-filter what it got and its 「显示更多」 / 500-row cap counted rows it hid.
        # The docstring above is left as is: it is copied into the committed OpenAPI schema.
        resource_filter = request.query_params.get('resource')
        if resource_filter:
            qs = qs.filter(resource=resource_filter)
        else:
            # Default: only permission-related resources
            qs = qs.filter(resource__in=permission_resources)

        action_filter = request.query_params.get('action')
        if action_filter:
            qs = qs.filter(action=action_filter.upper())

        qs = qs.filter(date_range_q(request.query_params, 'timestamp', caller_hall_tz(request)))

        limit = _parse_limit(request.query_params)
        qs = qs.order_by('-timestamp')[:limit]

        serializer = AuditLogSerializer(qs, many=True)
        return Response(serializer.data)

    @extend_schema(responses=AuditLogSerializer(many=True))
    @action(
        detail=False,
        methods=["get"],
        url_path="trace/(?P<trace_id>[^/.]+)",
        pagination_class=None,
    )
    def by_trace(self, request, trace_id=None):
        """
        GET /api/v1/audit-logs/trace/{trace_id}/
        按 trace_id 查询关联操作 — 查看同一请求内的所有变更。
        """
        qs = _hall_scope(AuditLog.objects.select_related("user").filter(trace_id=trace_id), request)

        qs = qs.order_by('timestamp')
        serializer = AuditLogSerializer(qs, many=True)
        return Response(serializer.data)

    @extend_schema(request=NlFilterRequestSerializer,
                   responses={200: NlFilterResponseSerializer, 429: NlFilterErrorSerializer, 503: NlFilterErrorSerializer})
    @action(detail=False, methods=["post"], url_path="nl-filter", pagination_class=None,
            throttle_classes=[OfficerAssistThrottle])
    def nl_filter(self, request):
        """
        POST /api/v1/audit-logs/nl-filter/ {"question": "..."}
        把一句话换成一组筛选参数(不查询、不读日志;nl_query.py)。页面把参数填进筛选项,人确认后照旧 GET 本列表。
        模型不可用答 503,页面退回手动筛选。
        """
        from apps.audit import nl_query
        from apps.core.locale import locale_from_request
        from apps.soul_assist import drafts, features

        body = NlFilterRequestSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        question = body.validated_data["question"]
        lang = "zh-Hans" if locale_from_request(request).lower().startswith("zh") else "en"
        try:
            done, filters, dropped, understood = nl_query.propose(request, question, lang=lang)
        except features.FeatureUnavailableError as exc:
            return problem(exc.status, exc.code, exc.code)
        draft = drafts.record("audit_query", request, done, system=nl_query.SYSTEM, input_text=question,
                              output=json.dumps(filters, sort_keys=True, ensure_ascii=False), target_type="audit_log")
        return Response({"filters": filters, "dropped": dropped, "understood": understood, "draft_id": draft.pk,
                         "model": done.model})
