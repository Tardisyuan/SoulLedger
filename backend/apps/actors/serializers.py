"""
REST serializers for Actors app.
"""
from rest_framework import serializers
from apps.actors.models import Actor


class ActorSerializer(serializers.ModelSerializer):
    realm_code = serializers.CharField(source="realm.realm_code", read_only=True)

    class Meta:
        model = Actor
        fields = [
            "id", "name", "civilization", "role", "realm", "realm_code",
            "title", "description", "powers_json", "icon_url", "is_active",
        ]


class ActorListSerializer(serializers.ModelSerializer):
    realm_code = serializers.CharField(source="realm.realm_code", read_only=True)

    class Meta:
        model = Actor
        fields = ["id", "name", "civilization", "role", "realm_code", "title", "is_active"]
