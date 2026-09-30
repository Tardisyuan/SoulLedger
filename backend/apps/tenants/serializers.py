import unicodedata

from rest_framework import serializers

from apps.souls.models import Civilization
from apps.tenants.models import Tenant


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
            "created_at",
        ]
        read_only_fields = ["id", "code", "created_at"]


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
