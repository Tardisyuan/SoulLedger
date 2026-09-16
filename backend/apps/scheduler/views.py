"""GET/PATCH jobs, run one, rebuild all; GET runs.

Tenant rule (design brief §3): a non-ADMIN sees and edits only rows of its
own tenant. `scope_to_tenant` filters on `tenant=<caller's tenant>`, which a
GLOBAL row's NULL never matches — so global rows are ADMIN-only without a
second rule. `TenantPermission.has_object_permission` is the backstop on the
write side and refuses a NULL-tenant row to a non-ADMIN for the same reason.

Audit rows are written here, explicitly, because ScheduledJob is not an
AuditUserFields model (see models.py) and the thing an operator changes on
PATCH is the PeriodicTask/CrontabSchedule, not this row.
"""
import logging

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django_celery_beat.models import CrontabSchedule, PeriodicTasks
from drf_spectacular.utils import extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from apps.core.permissions import CodenamePermission, TenantPermission
from apps.core.schema import DetailResponseSerializer
from apps.core.tenant import is_tenant_exempt, scope_to_tenant
from apps.core.viewsets import CodenameViewSetMixin
from apps.scheduler import services
from apps.scheduler.models import ScheduledJob, TaskRun
from apps.scheduler.registry import CRON_FIELDS
from apps.scheduler.serializers import (
    RebuildResultSerializer,
    ScheduledJobSerializer,
    ScheduledJobUpdateSerializer,
    TaskRunSerializer,
)

logger = logging.getLogger(__name__)


def _audit(request, action_name, *, resource_id, description, changes=None, tenant=None):
    from apps.audit.models import AuditLog
    from apps.core.client_ip import get_client_ip

    AuditLog.objects.create(
        tenant=tenant if tenant is not None else getattr(request, "tenant", None),
        user=request.user,
        action=action_name,
        resource="ScheduledJob",
        resource_id=str(resource_id),
        changes=changes,
        ip_address=get_client_ip(request) or "",
        user_agent=request.META.get("HTTP_USER_AGENT", "")[:500],
        description=description,
    )


class ScheduledJobViewSet(CodenameViewSetMixin, viewsets.ReadOnlyModelViewSet):
    """Registered scheduled jobs, one row per (job, tenant); global rows are ADMIN-only."""

    permission_classes = [TenantPermission, CodenamePermission]
    permission_codename = "scheduler"
    extra_permissions = {
        "partial_update": ["scheduler.manage"],
        "run": ["scheduler.manage"],
        "rebuild": ["scheduler.manage"],
    }
    queryset = ScheduledJob.objects.select_related("periodic_task", "periodic_task__crontab", "tenant")
    serializer_class = ScheduledJobSerializer
    filterset_fields = ["tenant", "job_key"]
    pagination_class = None  # a handful of rows per tenant; the page groups them client-side

    def get_queryset(self):
        return scope_to_tenant(super().get_queryset(), self.request)

    @extend_schema(request=ScheduledJobUpdateSerializer, responses={200: ScheduledJobSerializer})
    def partial_update(self, request, pk=None):
        """Change enabled / cron / timezone. Never edits the shared CrontabSchedule
        row in place: it get_or_creates the schedule the new fields describe and
        re-points this PeriodicTask at it, so the other rows sharing the old
        schedule keep theirs."""
        job = self.get_object()
        pt = job.periodic_task
        current_cron = {name: getattr(pt.crontab, name) for name in CRON_FIELDS} if pt.crontab_id else {}
        serializer = ScheduledJobUpdateSerializer(data=request.data, context={"current_cron": current_cron})
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        before = {**current_cron, "timezone": str(pt.crontab.timezone) if pt.crontab_id else None, "enabled": pt.enabled}
        with transaction.atomic():
            if "_cron" in data or "timezone" in data:
                fields = data.get("_cron", current_cron)
                tz = data.get("timezone", before["timezone"] or "UTC")
                try:
                    pt.crontab, _ = CrontabSchedule.objects.get_or_create(**fields, timezone=tz)
                except DjangoValidationError as exc:
                    # TimeZoneField.to_python refuses an unknown zone name here;
                    # the cron fields were already parsed by the serializer, so
                    # a rejection at this layer is the timezone's.
                    raise ValidationError({"timezone": exc.messages}) from exc
            if "enabled" in data:
                pt.enabled = data["enabled"]
            pt.save()
            PeriodicTasks.update_changed()
        after = {**{n: getattr(pt.crontab, n) for n in CRON_FIELDS}, "timezone": str(pt.crontab.timezone), "enabled": pt.enabled}
        _audit(
            request, "UPDATE", resource_id=job.pk, tenant=job.tenant,
            description=f"UPDATE schedule {pt.name}",
            changes={k: {"old": before.get(k), "new": after[k]} for k in after if before.get(k) != after[k]},
        )
        return Response(ScheduledJobSerializer(job).data)

    @extend_schema(
        request=None,
        responses={202: TaskRunSerializer, 409: DetailResponseSerializer, 503: DetailResponseSerializer},
    )
    @action(detail=True, methods=["post"])
    def run(self, request, pk=None):
        """Enqueue one execution now. 409 while another run holds the lock."""
        job = self.get_object()
        try:
            run = services.trigger_manual(job, request.user)
        except services.JobLockedError:
            return Response({"detail": "a run of this job is already in progress"}, status=status.HTTP_409_CONFLICT)
        except services.EnqueueFailedError as exc:
            return Response({"detail": f"could not enqueue: {exc}"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        _audit(
            request, "EXECUTE", resource_id=job.pk, tenant=job.tenant,
            description=f"EXECUTE {job.periodic_task.name} (manual)", changes={"task_run": run.pk},
        )
        return Response(TaskRunSerializer(run).data, status=status.HTTP_202_ACCEPTED)

    @extend_schema(request=None, responses={200: RebuildResultSerializer})
    @action(detail=False, methods=["post"])
    def rebuild(self, request):
        """Re-run the registry sync (what the boot command does). ADMIN only:
        it touches every tenant's rows, which no tenant-scoped role may."""
        if not is_tenant_exempt(request.user):
            raise PermissionDenied("rebuild is ADMIN-only")
        stats = services.sync_schedules()
        result = {k: stats.get(k, 0) for k in ("created", "updated", "removed", "legacy_removed")}
        _audit(request, "EXECUTE", resource_id="rebuild", description="EXECUTE scheduler rebuild", changes=result)
        return Response(RebuildResultSerializer(result).data)


class TaskRunViewSet(CodenameViewSetMixin, viewsets.ReadOnlyModelViewSet):
    """Execution history, newest first. Filter by job / status / tenant / task_name / trigger."""

    permission_classes = [TenantPermission, CodenamePermission]
    permission_codename = "scheduler"
    queryset = TaskRun.objects.select_related("job", "tenant", "triggered_by")
    serializer_class = TaskRunSerializer
    filterset_fields = ["job", "status", "tenant", "task_name", "trigger"]
    ordering_fields = ["queued_at", "started_at", "finished_at", "duration_ms"]
    ordering = ["-queued_at"]

    def get_queryset(self):
        return scope_to_tenant(super().get_queryset(), self.request)
