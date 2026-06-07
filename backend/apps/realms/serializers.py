"""
REST serializers for Realms app.
"""
from rest_framework import serializers

from apps.core.field_permissions import FieldPermissionMixin
from apps.realms.models import Realm


class RealmSerializer(FieldPermissionMixin, serializers.ModelSerializer):
    class Meta:
        model = Realm
        fields = [
            "id", "realm_code", "civilization",
            "name_local", "name_zh", "name_en", "name_egy",
            "realm_type", "tier", "parent_realm", "description",
            "memory_reset_mechanism", "is_eternal", "cycle_limit",
        ]


class RealmListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for list views."""
    class Meta:
        model = Realm
        fields = ["id", "realm_code", "civilization", "name_en", "realm_type", "tier"]


class RealmLocalizedSerializer(serializers.ModelSerializer):
    """
    Serializer that resolves the best-fit name based on Accept-Language header.
    Adds 'display_name' field with the resolved localized name.
    """
    display_name = serializers.SerializerMethodField()

    class Meta:
        model = Realm
        fields = [
            "id", "realm_code", "civilization",
            "name_local", "name_zh", "name_en", "name_egy",
            "display_name", "realm_type", "tier",
            "is_eternal", "memory_reset_mechanism",
        ]

    def get_display_name(self, obj):
        request = self.context.get("request")
        if request:
            lang = request.META.get("HTTP_ACCEPT_LANGUAGE", "en")
            # Take the primary language (before comma)
            locale = lang.split(",")[0].strip()
        else:
            locale = "en"
        return obj.get_localized_name(locale)
