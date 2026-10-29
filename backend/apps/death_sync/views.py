"""
REST views for death_sync app.
"""
import hashlib
import json
import logging

import django_filters
from django.db import IntegrityError
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.permissions import HasValidApiKey, IsAdminPermission, TenantPermission
from apps.core.tenant import scope_to_api_key, scope_to_tenant
from apps.core.viewsets import AuditUserViewSetMixin
from apps.death_sync.authentication import APIKeyAuthentication
from apps.death_sync.models import (
    DeathRegistrationRequest,
    DeathRegistrationStatus,
    ExternalApiKey,
    WebhookConfig,
)
from apps.death_sync.permissions import CanManageWebhooks, CanQueryStatus
from apps.death_sync.serializers import (
    AdminWebhookConfigSerializer,
    DeathRegistrationCreateSerializer,
    DeathRegistrationProgressSerializer,
    DeathRegistrationRequestSerializer,
    DeathRegistrationSummarySerializer,
    DeathSyncHealthSerializer,
    EventWebhookDeliverySerializer,
    ExternalApiKeySerializer,
    WebhookConfigSerializer,
)
from apps.death_sync.throttling import ApiKeyRateThrottle
from apps.events.models import EventType, EventWebhookDelivery

logger = logging.getLogger(__name__)


class DeathRegistrationFilter(django_filters.FilterSet):
    """`/death-sync` 登记列表的筛选(审计 2026-10-17 第 12 条)。

    `status` 仍是 ChoiceFilter(未知状态 400,不是一页空);`search` 查灵魂姓名、来源编号、幂等键;
    `received_after` / `received_before` 是收到的日期(YYYY-MM-DD,两端都含)。
    """

    status = django_filters.ChoiceFilter(choices=DeathRegistrationStatus.choices)
    search = django_filters.CharFilter(method="filter_search")
    received_after = django_filters.DateFilter(field_name="request_timestamp", lookup_expr="date__gte")
    received_before = django_filters.DateFilter(field_name="request_timestamp", lookup_expr="date__lte")
    # 某位土地公登记的(apps/death_sync/tudi_views.py)。
    tudi_god = django_filters.UUIDFilter(field_name="tudi_god_id")

    class Meta:
        model = DeathRegistrationRequest
        fields = ["status"]

    def filter_search(self, queryset, name, value):
        from django.db.models import Q

        value = value.strip()
        if not value:
            return queryset
        return queryset.filter(
            Q(soul__name__icontains=value) | Q(source_reference_id__icontains=value) | Q(idempotency_key=value)
        )


def _escalate_failed_retry(request, record):
    """A retry that did not end PROCESSED goes up (user decision 2026-10-16):
    an error log, an audit row naming who retried, and an in-app notice to
    this tenant's ADMINs. Only the error code travels -- the payload is
    encrypted personal data, and `error_message` can quote it (a serializer
    error echoes the value it refused, `str(e)` may too)."""
    from apps.audit.models import AuditAction, AuditLog
    from apps.authentication.models import User
    from apps.core.client_ip import get_client_ip
    from apps.notifications.messages import DEFAULT_LOCALE, render
    from apps.notifications.models import NotificationType, notify_user

    tenant = record.tenant
    logger.error(
        "death registration retry failed: registration=%s tenant=%s reason=%s retry_count=%s/%s",
        record.pk, tenant.code, record.error_code, record.retry_count, record.max_retries,
    )
    AuditLog.objects.create(
        tenant=tenant,
        user=request.user,
        action=AuditAction.EXECUTE,
        resource="DeathRegistrationRequest",
        resource_id=str(record.pk),
        changes={"error_code": record.error_code, "retry_count": record.retry_count},
        ip_address=get_client_ip(request) or "",
        user_agent=request.META.get("HTTP_USER_AGENT", "")[:500],
        description=f"death registration retry failed: {record.error_code}",
    )
    params = {
        "reference": record.source_reference_id or str(record.pk),
        "reason": record.error_code,
        "count": record.retry_count,
    }
    title, message = render(DEFAULT_LOCALE, "death_sync_retry_failed", params)
    for admin in User.objects.filter(role="ADMIN", tenant=tenant, is_active=True).order_by("pk"):
        try:
            notify_user(
                admin, title=title, message=message,
                notification_type=NotificationType.DEATH_SYNC_RETRY_FAILED,
                related_resource="death_sync", related_id=str(record.pk), params=params,
            )
        except Exception:  # 失败已经记进日志和审计;通知发不出去也要留痕,不能吞掉
            logger.exception("death sync retry-failed notice to admin %s failed", admin.pk)


class ExternalApiKeyViewSet(AuditUserViewSetMixin, viewsets.ModelViewSet):
    """
    CRUD for external API keys (admin only).
    """
    # Was IsAdminUser (Django is_staff) — the wrong admin concept for this
    # codebase, and refused even role='ADMIN' users. IsAdminPermission is the
    # same role-based gate every other admin-only endpoint here uses; paired
    # with TenantPermission for consistency with the rest of the app, though
    # ADMIN bypasses tenant filtering there too.
    permission_classes = [IsAuthenticated, IsAdminPermission, TenantPermission]
    queryset = ExternalApiKey.objects.all()
    serializer_class = ExternalApiKeySerializer

    def get_queryset(self):
        # ADMIN is this codebase's one intentionally-global role (see
        # TenantPermission/DataScopeViewSetMixin) and this endpoint is already
        # ADMIN-only, so scoping by tenant is moot for today's only caller.
        # Added anyway, matching the DataScopeViewSetMixin idiom used
        # elsewhere: it costs nothing for ADMIN (still sees every key) and
        # means this queryset fails safe rather than open if a future change
        # ever grants a non-ADMIN role access to this viewset.
        return scope_to_tenant(super().get_queryset(), self.request)

    def create(self, request, *args, **kwargs):
        # key 属于一个殿(`ExternalApiKey.tenant` 非空)。无殿 ADMIN 没有当前殿时此前是 IntegrityError 500
        # (RBAC 严查 2026-10-29 L3);现在要求先进殿,缺就 400。
        if getattr(request, "tenant", None) is None:
            return Response(
                {"error": "Choose a hall before creating an API key", "code": "no_tenant"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        from apps.death_sync.models import ExternalApiKey
        raw_key, key_hash, key_prefix = ExternalApiKey.generate_key()
        serializer.save(
            key_hash=key_hash,
            key_prefix=key_prefix,
            tenant=self.request.tenant,
        )
        # Return raw key in response (only time it's shown)
        serializer.validated_data['_raw_key'] = raw_key


class DeathRegistrationViewSet(
    AuditUserViewSetMixin, mixins.CreateModelMixin, viewsets.ReadOnlyModelViewSet
):
    """Death registration endpoints (API key authenticated). Create and read only.

    `DeathRegistrationRequest`'s docstring says "Immutable after creation.
    Used for idempotency, audit, and retry" — and this was a `ModelViewSet`,
    so an external system could `DELETE .../register/{id}/` and get 204.
    Measured 2026-08-29: the row then disappeared from `objects` and stayed in
    `_base_manager` (soft delete), i.e. **a registration could be removed from
    the audit trail by the same key that created it.**

    Create + read, so PUT/PATCH/DELETE answer 405 instead. The retry path that
    docstring mentions goes through the service, not through the client
    editing its own record.
    """
    # `ApiKeyRateThrottle` existed since the app landed and was wired to nothing:
    # `DEFAULT_THROTTLE_CLASSES` held only `AnonRateThrottle`, and `grep
    # throttle_classes` matched no view. Measured: a key with
    # `rate_limit_per_minute=1`, five consecutive requests -> `[200,200,200,200,200]`.
    # The model column, the serializer field and the admin form all said the
    # limit was being enforced.
    throttle_classes = [ApiKeyRateThrottle]
    authentication_classes = [APIKeyAuthentication]
    # Default IsAuthenticated always rejects: APIKeyAuthentication returns
    # AnonymousUser on success (see its docstring), so request.user is never
    # "authenticated" here. HasValidApiKey checks request.api_key instead —
    # see apps/core/permissions.py for the full rationale.
    permission_classes = [HasValidApiKey]
    queryset = DeathRegistrationRequest.objects.all()
    serializer_class = DeathRegistrationRequestSerializer

    def get_permissions(self):
        # 读登记(列表 / 详情)与 `progress` 同一个能力 `can_query_status`(rbac-be2 L5):关了它的 key 只能登记、读不回状态。
        # 登记本身(create)仍只要有效 key,由 `can_register_death` 在 `create` 里判。
        if self.action in ("list", "retrieve"):
            return [CanQueryStatus()]
        return super().get_permissions()

    def get_queryset(self):
        # Was fail-OPEN: `if api_key: qs = qs.filter(...)` with no else, so a
        # request that reached here without a key got every tenant's death
        # registrations. See scope_to_api_key in apps/core/tenant.py.
        return scope_to_api_key(super().get_queryset(), self.request)

    def create(self, request, *args, **kwargs):
        """Register a death (single or batch)."""
        from apps.death_sync.services import DeathSyncService

        api_key = request.api_key
        tenant = request.tenant
        data = request.data

        # Check permission
        if not api_key.can_register_death:
            return Response(
                {"error": {"code": "KEY_NO_DEATH_PERMISSION", "message": "API key lacks death registration permission"}},
                status=status.HTTP_403_FORBIDDEN,
            )

        # Batch registration
        if data.get("batch") and "registrations" in data:
            registrations = data["registrations"]
            if len(registrations) > 50:
                return Response(
                    {"error": {"code": "BATCH_TOO_LARGE", "message": "Batch size limit is 50"}},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            results = DeathSyncService.process_batch(
                tenant=tenant,
                api_key=api_key,
                registrations=registrations,
                source_ip=self._get_client_ip(request),
            )
            succeeded = sum(1 for r in results if r.status == DeathRegistrationStatus.PROCESSED)
            return Response({
                "status": "partial" if succeeded < len(results) else "accepted",
                "total": len(results),
                "succeeded": succeeded,
                "failed": len(results) - succeeded,
                "results": [
                    {
                        "index": idx,
                        "status": r.status,
                        "registration_id": str(r.id),
                        **({"error_code": r.error_code, "error_message": r.error_message} if r.status == DeathRegistrationStatus.FAILED else {}),
                        **({"soul_id": str(r.soul_id), "judgment_id": str(r.judgment_id)} if r.status == DeathRegistrationStatus.PROCESSED else {}),
                    }
                    for idx, r in enumerate(results)
                ],
            }, status=status.HTTP_207_MULTI_STATUS if succeeded < len(results) else status.HTTP_201_CREATED)

        # Single registration
        serializer = DeathRegistrationCreateSerializer(data=data)
        serializer.is_valid(raise_exception=True)

        idempotency_key = request.headers.get(
            "X-Idempotency-Key",
            f"{api_key.id}_{hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()}",
        )
        # Use API key's system_type, not client-provided header (prevents impersonation)
        source_system = api_key.system_type

        try:
            result = DeathSyncService.register_death(
                tenant=tenant,
                api_key=api_key,
                payload=serializer.validated_data,
                idempotency_key=idempotency_key,
                source_ip=self._get_client_ip(request),
            )
        except IntegrityError:
            # Idempotency conflict
            existing = DeathRegistrationRequest.objects.filter(
                tenant=tenant,
                source_system=source_system,
                idempotency_key=idempotency_key,
            ).first()
            if existing:
                return Response({
                    "status": "duplicate",
                    "registration_id": str(existing.id),
                    "existing_status": existing.status,
                }, status=status.HTTP_409_CONFLICT)
            raise

        if result.status == DeathRegistrationStatus.FAILED:
            return Response({
                "error": {
                    "code": result.error_code,
                    "message": result.error_message,
                    "request_id": str(result.id),
                },
            }, status=status.HTTP_400_BAD_REQUEST)

        return Response({
            "status": "accepted",
            "registration_id": str(result.id),
            "idempotency_key": idempotency_key,
            "result": {
                "soul_id": str(result.soul_id),
                "previous_state": "ALIVE",
                "new_state": "JUDGING",
                "judgment_id": str(result.judgment_id),
            },
        }, status=status.HTTP_201_CREATED)

    @extend_schema(responses=DeathRegistrationProgressSerializer)
    @action(detail=True, methods=["get"], permission_classes=[CanQueryStatus])
    def progress(self, request, pk=None):
        """GET /death-sync/register/{id}/progress/ — the soul's coarse progress for a registration **this key
        created** (`get_queryset` scopes to the key; another key's id is a 404). Needs `can_query_status`.
        Stage only: no verdict, no notes, no officer (`services.progress_of`)."""
        from apps.death_sync.services import progress_of

        return Response(progress_of(self.get_object()))

    @staticmethod
    def _get_client_ip(request):
        """Delegates to the one validated implementation.

        This was the FOURTH copy of the unchecked helper. `apps/core/client_ip.py`
        was created to collapse three of them (`audit/signals.py`,
        `death_sync/authentication.py`, `authentication/views.py`); its sibling in
        this very app was converted to a delegate and this one, twenty lines from
        two call sites, was not.

        It mattered here for the same reason it mattered there:
        `DeathRegistrationRequest.source_ip` is a `GenericIPAddressField`
        (`models.py:184`) written through `objects.create()`, which runs no
        `full_clean`. On PostgreSQL an unparseable header value raises
        `invalid input syntax for type inet` at INSERT; on SQLite the column is
        TEXT and the row stores fine — so no test on the SQLite path could see it.
        """
        from apps.core.client_ip import get_client_ip

        return get_client_ip(request)


class DeathRegistrationReadViewSet(viewsets.ReadOnlyModelViewSet):
    """Browser-facing, read-only view of this tenant's death registrations.

    `DeathRegistrationViewSet` above replaces `authentication_classes` with
    `[APIKeyAuthentication]`, which means it does not accept a JWT at all --
    by design, it is the machine-to-machine write endpoint. The
    `/death-sync` page was calling it with a Bearer token. Measured
    2026-08-29 with a real login token:

        [ADMIN]     GET /api/v1/death-sync/register/ -> 401
        [MODERATOR] -> 401     [VIEWER] -> 401
        (same client: GET /audit-logs/ -> 200, GET /workflows/ -> 200)

    So that page showed "No death registrations found." to **every** user
    including ADMIN, permanently -- an empty state where the truth was "this
    endpoint cannot be opened from a browser". The 500-renders-as-empty
    family's worst member: not a failure mode, a wholly unreachable screen.

    Separate viewset rather than adding JWT auth to the one above, because the
    split those classes encode is real: external systems write with a key and
    are scoped by that key (`scope_to_api_key`, deliberately fail-closed);
    operators read in a browser and are scoped by tenant. Merging them would
    have meant weakening one of the two scoping rules to cover the other's
    callers.

    ADMIN-only, matching `ExternalApiKeyViewSet` beside it: there is no
    `death_sync.*` codename in the catalogue, and inventing one here would put
    a permission in the matrix that no migration grants to anybody.
    """

    permission_classes = [IsAuthenticated, IsAdminPermission, TenantPermission]
    queryset = DeathRegistrationRequest.objects.all()
    serializer_class = DeathRegistrationRequestSerializer
    # `?status=FAILED` is a ChoiceFilter, so an unknown status is a 400, not a
    # silently empty page. Search and received-date range: `DeathRegistrationFilter`.
    filterset_class = DeathRegistrationFilter

    @extend_schema(responses={(200, "text/csv"): OpenApiTypes.BINARY, 400: OpenApiTypes.OBJECT})
    @action(detail=False, methods=["get"], url_path="export", pagination_class=None)
    def export(self, request):
        """这一页看得见的登记(同一组筛选)的 CSV,列取自列表序列化器。同类列表的导出写法(`apps/core/exports.py`)。"""
        from apps.core.exports import export_csv

        return export_csv(
            request,
            qs=self.filter_queryset(self.get_queryset()).order_by("-request_timestamp"),
            serializer_class=DeathRegistrationRequestSerializer,
            columns=[
                ("Registration ID", "id"), ("Status", "status"), ("Source System", "source_system"),
                ("Source Reference", "source_reference_id"), ("Idempotency Key", "idempotency_key"),
                ("Soul ID", "soul"), ("Error Code", "error_code"), ("Error Message", "error_message"),
                ("Retry Count", "retry_count"), ("Received At", "request_timestamp"),
            ],
            filename="death_registrations_export.csv",
            resource="death_registration",
        )

    @extend_schema(responses=DeathRegistrationSummarySerializer)
    @action(detail=False, methods=["get"])
    def summary(self, request):
        """How many of this tenant's registrations need a human.

        FAILED is the only anomalous state a row is ever written in: PENDING
        is in flight and DUPLICATE is the idempotency check doing its job. The status
        goes on the wire so the dashboard links to the same filter it counted.
        """
        anomaly = DeathRegistrationStatus.FAILED
        return Response({
            "anomaly_status": anomaly,
            "anomaly_count": self.get_queryset().filter(status=anomaly).count(),
        })

    @extend_schema(request=None, responses=DeathRegistrationRequestSerializer)
    @action(detail=True, methods=["post"])
    def retry(self, request, pk=None):
        """Rerun a registration that failed with INTERNAL_ERROR (W-12).

        409 with `code` NOT_FAILED / NOT_RETRYABLE / MAX_RETRIES otherwise.
        `get_object()` first, so another tenant's id is a 404 like a read.
        """
        from apps.death_sync.services import DeathSyncService, RetryRefusedError

        registration = self.get_object()
        try:
            result = DeathSyncService.retry_failed(registration.pk, registration.tenant)
        except RetryRefusedError as exc:
            return Response(
                {"error": "Registration cannot be retried", "code": exc.code},
                status=status.HTTP_409_CONFLICT,
            )
        if result.status != DeathRegistrationStatus.PROCESSED:
            _escalate_failed_retry(request, result)
        return Response(DeathRegistrationRequestSerializer(result, context=self.get_serializer_context()).data)

    def get_queryset(self):
        # `admin_bypass=False`: an ADMIN sees their own tenant's registrations,
        # not everyone's. `apps/core/tenant.py` does name ADMIN as the globally
        # exempt role, and that exemption was left in place where it is
        # long-standing -- but this endpoint is new, and the same call made on
        # 2026-08-30 for `/ledger/stats/export/` applies: a screen that lists
        # names and death dates is the last place to hand one tenant another's
        # rows by default. Nothing has ever depended on the wider behaviour
        # here, so there is nothing to migrate.
        return scope_to_tenant(
            super().get_queryset(), self.request, admin_bypass=False
        )


class WebhookViewSet(AuditUserViewSetMixin, viewsets.ModelViewSet):
    """
    CRUD for webhook configurations (API key authenticated).
    """
    # `ApiKeyRateThrottle` existed since the app landed and was wired to nothing:
    # `DEFAULT_THROTTLE_CLASSES` held only `AnonRateThrottle`, and `grep
    # throttle_classes` matched no view. Measured: a key with
    # `rate_limit_per_minute=1`, five consecutive requests -> `[200,200,200,200,200]`.
    # The model column, the serializer field and the admin form all said the
    # limit was being enforced.
    throttle_classes = [ApiKeyRateThrottle]
    authentication_classes = [APIKeyAuthentication]
    # See DeathRegistrationViewSet above / apps/core/permissions.py for why
    # the default IsAuthenticated cannot be used here.
    # `can_manage_webhooks` was declared on the model, migrated and serialized,
    # and read by nothing: a key with it set False POSTed here and got 201.
    # A WebhookConfig decides where this system sends outbound HTTP.
    permission_classes = [CanManageWebhooks]
    queryset = WebhookConfig.objects.all()
    serializer_class = WebhookConfigSerializer

    def get_queryset(self):
        # Was fail-OPEN, same as DeathRegistrationViewSet above — and worse
        # here, since WebhookConfig carries `signing_secret`.
        return scope_to_api_key(super().get_queryset(), self.request)

    def perform_create(self, serializer):
        import secrets
        signing_secret = f"whsec_{secrets.token_urlsafe(32)}"
        serializer.save(
            api_key=self.request.api_key,
            tenant=self.request.tenant,
            signing_secret=signing_secret,
        )


class AdminWebhookViewSet(
    AuditUserViewSetMixin,
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    mixins.ListModelMixin,
    viewsets.GenericViewSet,
):
    """Browser-facing management of `WebhookConfig` (JWT, ADMIN only).

    `WebhookViewSet` above is the external system's self-service endpoint: it
    authenticates with its API key only, so an admin's Bearer JWT gets 401
    there, and the /death-sync page had no way to see or change where this
    tenant's events are posted. This viewset is the operator's door to the
    same rows; the self-service one is unchanged.

    Separate viewset rather than a second auth class on the one above, for
    the same reason `DeathRegistrationReadViewSet` is separate from
    `DeathRegistrationViewSet`: the key path scopes by key (fail-closed), the
    browser path scopes by tenant, and merging them would weaken one.

    No `destroy`: disabling is `PATCH {"is_active": false}`, which keeps the
    row and its `EventWebhookDelivery` history (the FK is CASCADE). The
    signing secret is generated here and returned once in the 201 as
    `_signing_secret`, exactly like `ExternalApiKeyViewSet._raw_key`.

    ADMIN cross-tenant: `scope_to_tenant` with the default `admin_bypass`,
    matching `ExternalApiKeyViewSet` beside it — ADMIN is this codebase's one
    globally-scoped role there too. Creation still pins `tenant` to the
    request's tenant and refuses an `api_key` from another tenant.
    """

    permission_classes = [IsAuthenticated, IsAdminPermission, TenantPermission]
    queryset = WebhookConfig.objects.select_related("api_key").all()
    serializer_class = AdminWebhookConfigSerializer
    filterset_fields = ["is_active", "api_key"]

    def get_queryset(self):
        return scope_to_tenant(super().get_queryset(), self.request)

    def perform_create(self, serializer):
        import secrets

        signing_secret = f"whsec_{secrets.token_urlsafe(32)}"
        instance = serializer.save(tenant=self.request.tenant, signing_secret=signing_secret)
        # On the saved instance, not in validated_data: `serializer.data` is
        # `to_representation(instance)`, so this is the only place the
        # read-only field can be read from. Gone with this request.
        instance._signing_secret = signing_secret

    @extend_schema(responses={200: serializers.ListSerializer(child=serializers.CharField())})
    @action(detail=False, methods=["get"], url_path="event-types")
    def event_types(self, request):
        """The event names a webhook can subscribe to.

        `EventType` is the enum every publisher writes `envelope.event_type`
        from, and the handler filters on it verbatim — so this list, not a
        hand-written one in the client, is what a checklist must offer.
        """
        return Response(EventType.values)

    @extend_schema(request=None, responses={201: EventWebhookDeliverySerializer, 409: OpenApiTypes.OBJECT})
    @action(detail=True, methods=["post"], url_path="test")
    def send_test(self, request, pk=None):
        """发一条测试事件(`WEBHOOK_TEST`)到这个端点(审计 2026-10-17 第 14 条)。

        走与真事件同一条路:写一行投递记录、提交后入队、worker 签名发出、失败照常重试。不看订阅的事件清单 ——
        测的是「这个地址收得到、验得过签名」。停用的 webhook 409 `webhook_inactive`。
        """
        webhook = self.get_object()
        if not webhook.is_active:
            return Response({"error": "Webhook is disabled", "code": "webhook_inactive"},
                            status=status.HTTP_409_CONFLICT)
        delivery = _record_and_enqueue(
            webhook, domain="webhook", event_type=WEBHOOK_TEST_EVENT,
            payload_json={
                "event_type": WEBHOOK_TEST_EVENT, "domain": "webhook",
                "tenant_code": webhook.tenant.code if webhook.tenant_id else None,
                "actor": "system", "payload": {"test": True, "webhook_id": str(webhook.pk)},
            },
        )
        return Response(EventWebhookDeliverySerializer(delivery, context=self.get_serializer_context()).data,
                        status=status.HTTP_201_CREATED)


#: 「发测试事件」的事件名。不是 `EventType` 的成员:没有业务发布它,订阅清单里也不出现。
WEBHOOK_TEST_EVENT = "WEBHOOK_TEST"


def _record_and_enqueue(webhook, *, domain, event_type, payload_json):
    """手动发起的一条投递:与 `WebhookHandler` 同样先写行、提交后入队(入队失败留在 PENDING,兜底任务会捡)。"""
    from django.db import transaction

    from apps.events.handlers.webhook_handler import WebhookHandler

    delivery = EventWebhookDelivery.objects.create(
        webhook=webhook, tenant_id=webhook.tenant_id, domain=domain, event_type=event_type, payload_json=payload_json,
    )
    transaction.on_commit(lambda: WebhookHandler._enqueue([str(delivery.id)]))
    return delivery


class AdminWebhookDeliveryViewSet(viewsets.ReadOnlyModelViewSet):
    """`EventWebhookDelivery` rows for this tenant's webhooks (JWT, ADMIN only).

    Newest first (model ordering), paginated, filterable by `webhook`,
    `status` and `event_type`. Read-only: a delivery's status is written by
    the worker (`apps/events/tasks.py`) and by nothing else — `redeliver`
    writes a new row and leaves the old one as it was.

    Scoped through `webhook__tenant` rather than the row's own nullable
    `tenant`: the webhook is the thing an operator manages, and a row whose
    `tenant` were ever left null would otherwise be invisible to everyone.
    """

    permission_classes = [IsAuthenticated, IsAdminPermission, TenantPermission]
    queryset = EventWebhookDelivery.objects.select_related("webhook").all()
    serializer_class = EventWebhookDeliverySerializer
    filterset_fields = ["webhook", "status", "event_type"]

    def get_queryset(self):
        return scope_to_tenant(super().get_queryset(), self.request, field="webhook__tenant")

    @extend_schema(request=None, responses={201: EventWebhookDeliverySerializer, 409: OpenApiTypes.OBJECT})
    @action(detail=True, methods=["post"])
    def redeliver(self, request, pk=None):
        """把一条失败的投递再发一次(审计 2026-10-17 第 14 条)。

        新写一行(同一份 payload 快照,与原来的事件名),原行原样留着当记录 —— 不改写它的次数与错误。
        只收**不会再自动重试**的行:ABANDONED,或 FAILED 且次数已到上限(`attempt_ceiling`);
        还在重试的 409 `not_finished`(再发一份就是重复投递),成功或待发的同样 409。
        webhook 已停用 409 `webhook_inactive`。
        """
        from apps.events.models import EventWebhookStatus
        from apps.events.tasks import attempt_ceiling

        original = self.get_object()
        webhook = original.webhook
        if not webhook.is_active:
            return Response({"error": "Webhook is disabled", "code": "webhook_inactive"},
                            status=status.HTTP_409_CONFLICT)
        finished = original.status == EventWebhookStatus.ABANDONED or (
            original.status == EventWebhookStatus.FAILED and original.attempt >= attempt_ceiling(webhook))
        if not finished:
            return Response({"error": "Delivery is not a finished failure", "code": "not_finished"},
                            status=status.HTTP_409_CONFLICT)
        delivery = _record_and_enqueue(
            webhook, domain=original.domain, event_type=original.event_type, payload_json=original.payload_json,
        )
        return Response(EventWebhookDeliverySerializer(delivery, context=self.get_serializer_context()).data,
                        status=status.HTTP_201_CREATED)


class DeathSyncHealthView(APIView):
    """
    Health check for death sync API with monitoring metrics.
    """
    authentication_classes = [APIKeyAuthentication]
    #: Read by drf-spectacular, not by DRF — a plain APIView ignores it at
    #: runtime. Without it this endpoint is published with no response body:
    #: the generator reports `unable to guess serializer ... Ignoring view for
    #: now`, which is a message on the error channel and invisible to a
    #: warnings check.
    serializer_class = DeathSyncHealthSerializer
    # Deliberately NOT throttled, while the two data endpoints above are. This
    # is the endpoint an operator reads to find out *why* they are being
    # refused -- throttling it makes the answer unavailable exactly when it is
    # needed. It writes nothing and reads four counts.
    throttle_classes = []
    # See DeathRegistrationViewSet above / apps/core/permissions.py for why
    # the default IsAuthenticated cannot be used here.
    # `can_query_status` was the other declared-and-never-read flag.
    permission_classes = [CanQueryStatus]

    def get(self, request):
        from datetime import timedelta

        from django.utils import timezone

        api_key = getattr(request, 'api_key', None)
        # APIKeyAuthentication sets request.tenant from the key's tenant (it
        # doesn't go through TenantMiddleware's JWT path), but fall back to
        # api_key.tenant directly in case that ever changes — either way,
        # these counts must not aggregate across tenants: any valid API key
        # holder used to see every tenant's pending/failed volume.
        tenant = getattr(request, 'tenant', None) or (api_key.tenant if api_key else None)

        # Count pending/failed registrations in last 24h
        cutoff_24h = timezone.now() - timedelta(hours=24)
        pending_count = DeathRegistrationRequest.objects.filter(
            tenant=tenant,
            status=DeathRegistrationStatus.PENDING,
            request_timestamp__gte=cutoff_24h,
        ).count()
        failed_count = DeathRegistrationRequest.objects.filter(
            tenant=tenant,
            status=DeathRegistrationStatus.FAILED,
            request_timestamp__gte=cutoff_24h,
        ).count()

        # Failed webhook deliveries in the last 24h, by the webhook's tenant.
        # BD-11: this read `WebhookDeliveryLog`, a table nothing in production
        # writes, so it said 0 whatever happened. Deliveries are
        # `EventWebhookDelivery` rows (apps/events/tasks.py); FAILED is a try
        # that will be retried, ABANDONED one that will not.
        from apps.events.models import EventWebhookDelivery, EventWebhookStatus
        failed_webhooks = EventWebhookDelivery.objects.filter(
            webhook__tenant=tenant,
            status__in=[EventWebhookStatus.FAILED, EventWebhookStatus.ABANDONED],
            create_time__gte=cutoff_24h,
        ).count()

        return Response({
            "api_key": {
                "name": api_key.name if api_key else None,
                "system_type": api_key.system_type if api_key else None,
                "is_active": api_key.is_active if api_key else False,
                # Renamed from `rate_limit_remaining`, which is what these two
                # numbers were reported as while being the configured ceiling --
                # never the remaining count, and doubly wrong while nothing was
                # counting at all.
                "rate_limit": {
                    "per_minute": api_key.rate_limit_per_minute if api_key else 0,
                    "per_hour": api_key.rate_limit_per_hour if api_key else 0,
                },
                # The real thing. `null` when the counter cannot be read, rather
                # than a number that would look like an answer.
                "rate_limit_remaining": {
                    "per_minute": ApiKeyRateThrottle.remaining_for(api_key, "minute"),
                    "per_hour": ApiKeyRateThrottle.remaining_for(api_key, "hour"),
                },
            },
            "system": {
                "status": "healthy",
                "pending_registrations_24h": pending_count,
                "failed_registrations_24h": failed_count,
                "failed_webhooks_24h": failed_webhooks,
            },
        })
