"""
REST serializers for Judgment app.
"""
from rest_framework import serializers
from apps.judgment.models import Judgment


class JudgmentSerializer(serializers.ModelSerializer):
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
    notes = serializers.CharField(required=False, default="")
