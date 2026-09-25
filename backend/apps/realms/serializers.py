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


class RealmOccupancySerializer(serializers.Serializer):
    """One row of `GET /realms/occupancy/`: souls whose open path entry
    (`left_at` null) is in this realm — 在押."""
    realm_id = serializers.UUIDField()
    count = serializers.IntegerField()


class RealmCapacitySerializer(serializers.ModelSerializer):
    """`PATCH /realms/{id}/` —— 只收 `capacity`(非负整数或 null)。

    任何别的字段都是 400,而不是被 DRF 静默丢掉:界域的名字、层级、拓扑来自神话语料
    (`seed_mythology`),一个以为自己改了 `name_zh` 却收到 200 的调用方,拿到的是一句谎话。
    """
    capacity = serializers.IntegerField(min_value=0, allow_null=True)

    class Meta:
        model = Realm
        fields = ["capacity"]

    def to_internal_value(self, data):
        if isinstance(data, dict):
            extra = sorted(set(data) - {"capacity"})
            if extra:
                raise serializers.ValidationError(
                    {f: ["Only capacity can be changed on a realm."] for f in extra}
                )
        return super().to_internal_value(data)


class RealmCapacityResultSerializer(RealmSerializer):
    """The realm after a capacity change, plus what the new number means now.

    `held` is the count placement compares against (`disposition.destination.realm_held`);
    `is_full` = new placements get 409 `realm_full`. Nobody already there is moved."""
    held = serializers.IntegerField(read_only=True)
    is_full = serializers.BooleanField(read_only=True)

    class Meta(RealmSerializer.Meta):
        fields = [*RealmSerializer.Meta.fields, "held", "is_full"]
