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


def _assessor_index(obj) -> int | None:
    """The actor's seat on the bench of 42, or None if he does not sit on it.

    The list endpoint deliberately exposes this ONE key out of `powers_json`
    rather than the whole payload. The rest of an assessor's payload is bulk a
    list has no use for — `negative_confession`, `source_edition` and the
    per-row `source_notes` add hundreds of bytes to each of 42 rows, and the
    seed's `ASSESSOR_SOURCE_EDITION` alone is a 400-character string repeated
    verbatim on every one of them.

    Nullable-int rather than a boolean because one field then does both jobs a
    caller needs: presence answers "is this a member of the bench or a major
    god", and the value itself is the Nebseni order the bench must be displayed
    in. A boolean would need a second field beside it to sort by, and would
    invite the caller to sort by name — which is exactly the defect the seed's
    own header warns about.
    """
    powers = obj.powers_json
    if not isinstance(powers, dict):
        return None
    index = powers.get("assessor_index")
    return index if isinstance(index, int) else None


class ActorListSerializer(serializers.ModelSerializer):
    realm_code = serializers.CharField(source="realm.realm_code", read_only=True)
    display_name = serializers.SerializerMethodField()
    display_title = serializers.SerializerMethodField()
    assessor_index = serializers.SerializerMethodField()

    class Meta:
        model = Actor
        fields = ["id", "name", "civilization", "role", "realm_code",
                  "display_name", "display_title", "is_active", "assessor_index"]

    def get_display_name(self, obj) -> str:
        return obj.get_localized_name(_locale_from_context(self.context))

    def get_display_title(self, obj) -> str:
        return obj.get_localized_title(_locale_from_context(self.context))

    def get_assessor_index(self, obj) -> int | None:
        return _assessor_index(obj)


class ActorLocalizedSerializer(serializers.ModelSerializer):
    realm_code = serializers.CharField(source="realm.realm_code", read_only=True)
    display_name = serializers.SerializerMethodField()
    display_title = serializers.SerializerMethodField()
    assessor_index = serializers.SerializerMethodField()

    class Meta:
        model = Actor
        fields = [
            "id", "name", "civilization", "role", "realm", "realm_code",
            "name_zh", "name_en", "name_egy",
            "display_name", "display_title",
            "title", "title_zh", "title_en", "title_egy",
            "description", "icon_url", "is_active", "assessor_index",
        ]

    def get_display_name(self, obj) -> str:
        return obj.get_localized_name(_locale_from_context(self.context))

    def get_display_title(self, obj) -> str:
        return obj.get_localized_title(_locale_from_context(self.context))

    def get_assessor_index(self, obj) -> int | None:
        # `?localized=true` drops powers_json too, so without this the seat is
        # unreachable from that shape as well.
        return _assessor_index(obj)
