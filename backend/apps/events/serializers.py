"""
REST serializers for Events app (audit log).
"""
from rest_framework import serializers
from apps.events.models import SoulEvent


class SoulEventSerializer(serializers.ModelSerializer):
    soul_name = serializers.CharField(source="soul.name", read_only=True)

    class Meta:
        model = SoulEvent
        fields = ["id", "soul", "soul_name", "event_type", "payload", "actor", "created_at"]
