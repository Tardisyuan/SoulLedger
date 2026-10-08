import unicodedata

from rest_framework import serializers

from apps.souls.models import Civilization
from apps.tenants.models import REBIRTH_COOLDOWN_SETTING, Tenant


def _one_char(test):
    return lambda g: len(g) == 1 and test(g)


def _named(prefix):
    return _one_char(lambda g: unicodedata.name(g, "").startswith(prefix))


#: 每个文明:(最多几项, 单项的判定)。每一项都是**一个码位**。
#: 希腊只收希腊大写字母 —— 拉丁 M 与 Μ(U+039C)长得一样,但不是同一个字。
SEAL_GLYPH_RULES = {
    Civilization.CHINESE: (1, _named("CJK UNIFIED IDEOGRAPH")),
    Civilization.EUROPEAN: (1, _named("LATIN CAPITAL LETTER")),
    Civilization.EGYPTIAN: (2, _one_char(lambda g: 0x13000 <= ord(g) <= 0x1342F)),
    Civilization.GREEK: (1, _named("GREEK CAPITAL LETTER")),
}


def validate_seal_glyphs(civilization, glyphs):
    """空列表 = 用文明默认字,总是合法。其余按文明校验;不合就 400,从不截断。"""
    if not glyphs:
        return []
    rule = SEAL_GLYPH_RULES.get(civilization)
    if rule is None:
        raise serializers.ValidationError("这个租户没有对应的文明,只能留空。")
    limit, ok = rule
    if len(glyphs) > limit:
        raise serializers.ValidationError(f"{civilization} 最多 {limit} 个字。")
    bad = [g for g in glyphs if not ok(g)]
    if bad:
        raise serializers.ValidationError(f"这些字不属于 {civilization} 的印字字符集:{bad}")
    return glyphs


class TenantSerializer(serializers.ModelSerializer):
    civilization = serializers.CharField(read_only=True)
    seal_glyphs = serializers.ListField(child=serializers.CharField(), read_only=True)

    class Meta:
        model = Tenant
        fields = [
            "id",
            "code",
            "display_name",
            "description",
            "is_active",
            "dispatch_enabled",
            "api_endpoint",
            "settings",
            "civilization",
            "seal_glyphs",
            "hall_name",
            "hall_name_en",
            "hall_name_egy",
            "created_at",
        ]
        read_only_fields = ["id", "code", "created_at"]


class TenantSettingsSerializer(serializers.ModelSerializer):
    """`PATCH /tenants/{code}/settings/` 的请求体(ADMIN):只收这几个**已知**的字段,不收整份 `settings` JSON。

    `soul_rebirth_cooldown_days` 是 `settings` 里的一个键(`apps/soul_accounts/rebirth.py::cooldown_days`
    读它,负数按 0 算,所以这里下限 0,上限 365);写它时**合并**进现有 `settings`,别的键(如助手管理页写的
    `assistant_enabled`)原样保留;给 `null` 就删掉这个键,回到默认 30 天。
    """

    # 上限 365(2026-10-08 用户决定):一年之外的冷却没有业务含义,只会是手误。
    soul_rebirth_cooldown_days = serializers.IntegerField(min_value=0, max_value=365, required=False, allow_null=True)

    class Meta:
        model = Tenant
        fields = ["description", "dispatch_enabled", "hall_name", "hall_name_en", "hall_name_egy",
                  "soul_rebirth_cooldown_days"]

    def update(self, instance, validated_data):
        if "soul_rebirth_cooldown_days" in validated_data:
            days = validated_data.pop("soul_rebirth_cooldown_days")
            merged = {k: v for k, v in (instance.settings or {}).items() if k != REBIRTH_COOLDOWN_SETTING}
            if days is not None:
                merged[REBIRTH_COOLDOWN_SETTING] = days
            instance.settings = merged
        return super().update(instance, validated_data)


class TenantSealGlyphsSerializer(serializers.ModelSerializer):
    """`PATCH /tenants/{code}/seal-glyphs/` 的请求体 —— 只有这一个字段可写。"""

    seal_glyphs = serializers.ListField(
        child=serializers.CharField(trim_whitespace=False),
        max_length=2,
        allow_empty=True,
    )

    class Meta:
        model = Tenant
        fields = ["seal_glyphs"]

    def validate_seal_glyphs(self, value):
        return validate_seal_glyphs(self.instance.civilization, value)
