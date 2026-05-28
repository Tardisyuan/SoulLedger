"""
REST serializers for Disposition app.
"""
from rest_framework import serializers
from apps.disposition.models import Disposition
from apps.core.field_permissions import FieldPermissionMixin


class DispositionSerializer(FieldPermissionMixin, serializers.ModelSerializer):
    soul_name = serializers.CharField(source="soul.name", read_only=True)
    realm_code = serializers.CharField(source="destination_realm.realm_code", read_only=True)
    realm_name = serializers.CharField(source="destination_realm.name_en", read_only=True)

    class Meta:
        model = Disposition
        fields = [
            "id", "soul", "soul_name", "judgment", "destination_realm",
            "realm_code", "realm_name", "memory_reset", "is_eternal",
            "sentence_years", "is_executed", "executed_at", "notes", "created_at",
        ]


class DispositionExecuteSerializer(serializers.Serializer):
    new_identity = serializers.CharField(required=False, default="")
