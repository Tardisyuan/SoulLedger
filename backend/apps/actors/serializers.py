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
            "name_zh", "name_en", "name_egy",
            "title", "title_zh", "title_en", "title_egy",
            "description", "powers_json", "icon_url", "is_active",
        ]


def _locale_from_context(context):
    request = context.get("request")
    if request:
        lang = request.META.get("HTTP_ACCEPT_LANGUAGE", "en")
        return lang.split(",")[0].strip()
    return "en"


class ActorListSerializer(serializers.ModelSerializer):
    realm_code = serializers.CharField(source="realm.realm_code", read_only=True)
    display_name = serializers.SerializerMethodField()
    display_title = serializers.SerializerMethodField()

    class Meta:
        model = Actor
        fields = ["id", "name", "civilization", "role", "realm_code",
                  "display_name", "display_title", "is_active"]

    def get_display_name(self, obj):
        return obj.get_localized_name(_locale_from_context(self.context))

    def get_display_title(self, obj):
        return obj.get_localized_title(_locale_from_context(self.context))


class ActorLocalizedSerializer(serializers.ModelSerializer):
    realm_code = serializers.CharField(source="realm.realm_code", read_only=True)
    display_name = serializers.SerializerMethodField()
    display_title = serializers.SerializerMethodField()

    class Meta:
        model = Actor
        fields = [
            "id", "name", "civilization", "role", "realm", "realm_code",
            "name_zh", "name_en", "name_egy",
            "display_name", "display_title",
            "title", "title_zh", "title_en", "title_egy",
            "description", "icon_url", "is_active",
        ]

    def get_display_name(self, obj):
        return obj.get_localized_name(_locale_from_context(self.context))

    def get_display_title(self, obj):
        return obj.get_localized_title(_locale_from_context(self.context))
