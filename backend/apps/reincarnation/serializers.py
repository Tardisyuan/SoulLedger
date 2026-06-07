"""
REST serializers for Reincarnation app.
"""
from rest_framework import serializers

from apps.reincarnation.models import Reincarnation


class ReincarnationSerializer(serializers.ModelSerializer):
    soul_name = serializers.CharField(source="soul.name", read_only=True)

    class Meta:
        model = Reincarnation
        fields = [
            "id", "soul", "soul_name", "disposition", "target_realm",
            "rebirth_form", "cycle_count", "previous_realm", "new_identity",
            "notes", "reincarnated_at",
        ]
