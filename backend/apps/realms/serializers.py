"""
REST serializers for Realms app.
"""
from rest_framework import serializers

from apps.core.field_permissions import FieldPermissionMixin
from apps.core.locale import locale_from_context
from apps.realms.models import Realm, SoulPathEntry

#: 行程拓扑的列(云端报告 realm-path-fields(已移出仓库,存于项目记忆目录))。契约里的 parent_id / code /
#: is_eternal 就是已有的 `parent_realm` / `realm_code` / `is_eternal`,不另起别名。
TOPOLOGY_FIELDS = [
    "order", "kind", "capacity",
    "level", "sublevel", "region",
    "hour", "gate", "is_judgment_hall",
    "fork",
]


class RealmSerializer(FieldPermissionMixin, serializers.ModelSerializer):
    class Meta:
        model = Realm
        fields = [
            "id", "realm_code", "civilization",
            "name_local", "name_zh", "name_en", "name_egy",
            "realm_type", "tier", "parent_realm", "description",
            "memory_reset_mechanism", "is_eternal", "cycle_limit",
            *TOPOLOGY_FIELDS,
        ]


class RealmListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for list views."""
    class Meta:
        model = Realm
        # parent_realm / is_eternal / 拓扑列:官员端画整张拓扑图读的是列表,不是逐个 detail。
        fields = [
            "id", "realm_code", "civilization", "name_en", "realm_type", "tier",
            "parent_realm", "is_eternal", *TOPOLOGY_FIELDS,
        ]


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

    def get_display_name(self, obj) -> str:
        # The return hint is what keeps this out of the generator's warning
        # channel. It went unnoticed until `JudgmentQueueCursorSerializer`
        # nested this serializer, because nothing reachable from the schema had
        # descended into it before — the coverage of a check grows as the
        # things it checks become reachable.
        return obj.get_localized_name(locale_from_context(self.context))


class SoulPathEntrySerializer(serializers.ModelSerializer):
    """One stop in `GET /souls/{id}/path/`. `realm_code` rides along because it
    is the join key the frontend already uses for realms (realmCodes.ts)."""
    realm_id = serializers.UUIDField(read_only=True, allow_null=True)
    realm_code = serializers.CharField(source="realm.realm_code", read_only=True, allow_null=True, default=None)

    class Meta:
        model = SoulPathEntry
        fields = ["id", "sequence", "realm_id", "realm_code", "entered_at", "left_at"]
        read_only_fields = fields
