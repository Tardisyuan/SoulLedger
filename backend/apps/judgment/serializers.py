"""
REST serializers for Judgment app.
"""
from rest_framework import serializers

from apps.core.field_permissions import FieldPermissionMixin
from apps.judgment.models import Judgment


class JudgmentSerializer(FieldPermissionMixin, serializers.ModelSerializer):
    soul_name = serializers.CharField(source="soul.name", read_only=True)
    judge_name = serializers.CharField(source="judge.name", read_only=True)

    class Meta:
        model = Judgment
        fields = [
            "id", "soul", "soul_name", "civilization", "judge", "judge_name",
            "court", "evidence_json", "confession", "verdict", "notes",
            "is_final", "created_at", "concluded_at",
        ]


class JudgmentConcludeSerializer(serializers.Serializer):
    verdict = serializers.ChoiceField(choices=["PASSED", "FAILED", "PURGATORY", "RETRY"])
    # allow_blank, because a verdict with no note is the ordinary case and
    # Judgment.notes is blank=True. Without it, DRF's CharField rejected an
    # explicit "" while accepting an omitted key — and both clients send the
    # key: app/judgment/[id]/page.tsx posts `notes` from a controlled textarea
    # that starts empty, and the triage queue does the same. So every verdict
    # filed without typing a note came back 400 "This field may not be blank",
    # from an endpoint whose own default for the field is "".
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    create_workflow = serializers.BooleanField(default=False)
