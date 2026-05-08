"""
REST serializers for Realms app.
"""
from rest_framework import serializers
from apps.realms.models import Realm


class RealmSerializer(serializers.ModelSerializer):
    class Meta:
        model = Realm
        fields = [
            "id", "realm_code", "civilization", "name_local", "name_en",
            "realm_type", "tier", "parent_realm", "description",
            "memory_reset_mechanism", "is_eternal", "cycle_limit",
        ]


class RealmListSerializer(serializers.ModelSerializer):
    class Meta:
        model = Realm
        fields = ["id", "realm_code", "civilization", "name_en", "realm_type", "tier"]
