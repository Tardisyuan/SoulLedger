"""Read shapes for jobs and runs, and the one write shape (PATCH a job).

Every computed field carries `@extend_schema_field`: `test_schema_has_no_
warnings.py` fails the build on any field drf-spectacular has to type as
`string`, and the generated client in packages/core is only as right as this.
"""
from celery.schedules import crontab
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.scheduler import services
from apps.scheduler.models import JobScope, ScheduledJob, TaskRun
from apps.scheduler.registry import CRON_FIELDS


class TaskRunSerializer(serializers.ModelSerializer):
    triggered_by_username = serializers.CharField(source="triggered_by.username", read_only=True, allow_null=True)

    class Meta:
        model = TaskRun
        fields = [
            "id", "job", "task_name", "celery_task_id", "tenant", "trigger", "status",
            "queued_at", "started_at", "finished_at", "duration_ms", "worker_hostname",
            "error", "result", "triggered_by", "triggered_by_username",
        ]
        read_only_fields = fields


class TaskRunSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = TaskRun
        fields = ["id", "status", "trigger", "queued_at", "started_at", "finished_at", "duration_ms"]
        read_only_fields = fields


class ScheduledJobSerializer(serializers.ModelSerializer):
    periodic_task_name = serializers.CharField(source="periodic_task.name", read_only=True)
    task_name = serializers.CharField(source="periodic_task.task", read_only=True)
    scope = serializers.ChoiceField(choices=JobScope.choices, read_only=True)
    tenant_code = serializers.CharField(source="tenant.code", read_only=True, allow_null=True)
    enabled = serializers.BooleanField(source="periodic_task.enabled", read_only=True)
    minute = serializers.CharField(source="periodic_task.crontab.minute", read_only=True, allow_null=True)
    hour = serializers.CharField(source="periodic_task.crontab.hour", read_only=True, allow_null=True)
    day_of_month = serializers.CharField(source="periodic_task.crontab.day_of_month", read_only=True, allow_null=True)
    month_of_year = serializers.CharField(
        source="periodic_task.crontab.month_of_year", read_only=True, allow_null=True
    )
    day_of_week = serializers.CharField(source="periodic_task.crontab.day_of_week", read_only=True, allow_null=True)
    timezone = serializers.SerializerMethodField()
    description_key = serializers.SerializerMethodField()
    max_runtime_seconds = serializers.SerializerMethodField()
    next_run_at = serializers.SerializerMethodField()
    last_run = serializers.SerializerMethodField()
    overdue = serializers.SerializerMethodField()
    expected_at = serializers.SerializerMethodField()

    class Meta:
        model = ScheduledJob
        fields = [
            "id", "job_key", "periodic_task_name", "task_name", "scope", "tenant", "tenant_code",
            "description_key", "enabled", "minute", "hour", "day_of_month", "month_of_year",
            "day_of_week", "timezone", "max_runtime_seconds", "next_run_at", "last_run",
            "overdue", "expected_at", "consecutive_failures", "last_alerted_at",
        ]
        read_only_fields = fields

    def to_representation(self, instance):
        # One health computation per row, shared by the four method fields.
        self._health = services.job_health(instance)
        return super().to_representation(instance)

    @extend_schema_field(OpenApiTypes.STR)
    def get_timezone(self, obj):
        return str(obj.periodic_task.crontab.timezone) if obj.periodic_task.crontab_id else "UTC"

    @extend_schema_field(OpenApiTypes.STR)
    def get_description_key(self, obj):
        spec = obj.spec
        return spec.description_key if spec else ""

    @extend_schema_field(OpenApiTypes.INT)
    def get_max_runtime_seconds(self, obj):
        return obj.max_runtime

    @extend_schema_field(serializers.DateTimeField(allow_null=True))
    def get_next_run_at(self, obj):
        return self._health["next_run_at"]

    @extend_schema_field(TaskRunSummarySerializer(allow_null=True))
    def get_last_run(self, obj):
        run = self._health["last_run"]
        return TaskRunSummarySerializer(run).data if run is not None else None

    @extend_schema_field(OpenApiTypes.BOOL)
    def get_overdue(self, obj):
        return self._health["overdue"]

    @extend_schema_field(serializers.DateTimeField(allow_null=True))
    def get_expected_at(self, obj):
        return self._health["expected_at"]


class ScheduledJobUpdateSerializer(serializers.Serializer):
    """PATCH body. Partial: any subset of enabled, the five cron fields, timezone.

    Cron validation is celery's own `crontab(...)` parser — what beat will do
    with the value is the only definition of "valid" that matters. Nothing
    else checks it: django_celery_beat's CrontabSchedule validators run only
    under full_clean(), not on get_or_create, so "25" would be stored.

    The timezone is deliberately NOT validated here. CrontabSchedule.timezone
    is a TimeZoneField whose to_python() rejects an unknown name on the way
    into get_or_create, and the view maps that to a 400 under "timezone". A
    zoneinfo check here was written first and removed after a mutation proof
    showed it could not be made to fail — the layer below already refuses.
    """

    enabled = serializers.BooleanField(required=False)
    minute = serializers.CharField(required=False, max_length=240)
    hour = serializers.CharField(required=False, max_length=96)
    day_of_month = serializers.CharField(required=False, max_length=124)
    month_of_year = serializers.CharField(required=False, max_length=64)
    day_of_week = serializers.CharField(required=False, max_length=64)
    timezone = serializers.CharField(required=False, max_length=63)

    def validate(self, attrs):
        if any(name in attrs for name in CRON_FIELDS):
            current = self.context["current_cron"]
            merged = {name: attrs.get(name, current[name]) for name in CRON_FIELDS}
            try:
                crontab(**merged)
            except (ValueError, TypeError, KeyError) as exc:
                raise serializers.ValidationError({"cron": f"invalid crontab: {exc}"}) from exc
            attrs["_cron"] = merged
        return attrs


class RebuildResultSerializer(serializers.Serializer):
    created = serializers.IntegerField()
    updated = serializers.IntegerField()
    removed = serializers.IntegerField()
    legacy_removed = serializers.IntegerField()
