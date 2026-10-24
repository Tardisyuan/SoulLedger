import unicodedata

from rest_framework import serializers

from apps.souls.models import Civilization
from apps.tenants.models import REBIRTH_COOLDOWN_SETTING, SELF_SERVICE_SETTING, VISIT_SETTINGS, Tenant


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
    letters_on = serializers.SerializerMethodField(help_text="书信是否开着(服务器级 `MATRIX_ENABLED`)。")

    def get_letters_on(self, obj) -> bool:
        from django.conf import settings

        return bool(settings.MATRIX_ENABLED)

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
            "letters_on",
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
    # 两步验证(A12):要求开启的角色名;ADMIN 始终要求,写进来也原样留着。只认可持有的角色名。
    mfa_required_roles = serializers.ListField(child=serializers.CharField(max_length=20), required=False)
    # 到殿办理(第四十一批 H-a):书信没开时灵魂 App 帮助页显示。选填;去首尾空格后为空 = 没填,删掉这个键。
    visit_address = serializers.CharField(max_length=VISIT_SETTINGS["visit_address"], required=False, allow_blank=True)
    visit_hours = serializers.CharField(max_length=VISIT_SETTINGS["visit_hours"], required=False, allow_blank=True)
    visit_phone = serializers.CharField(max_length=VISIT_SETTINGS["visit_phone"], required=False, allow_blank=True)
    # 灵魂能不能自己改联系邮箱(缺省 = 开)。只管**开始**一次改动,在途的照常完成(contact_email.py)。
    soul_contact_email_self_service = serializers.BooleanField(required=False)
    # 转世月配额(2026-10-24):{道: 每月上限};某道给 null = 去掉那一道的上限(不限)。只收已知的道。
    rebirth_monthly_quota = serializers.DictField(
        child=serializers.IntegerField(min_value=0, max_value=100000, allow_null=True), required=False)

    class Meta:
        model = Tenant
        fields = ["description", "dispatch_enabled", "hall_name", "hall_name_en", "hall_name_egy",
                  "soul_rebirth_cooldown_days", "mfa_required_roles", *VISIT_SETTINGS, SELF_SERVICE_SETTING,
                  "rebirth_monthly_quota"]

    def validate_rebirth_monthly_quota(self, value):
        from apps.reincarnation.models import RebirthForm

        unknown = [k for k in value if k not in RebirthForm.values]
        if unknown:
            raise serializers.ValidationError(f"unknown rebirth form(s): {', '.join(unknown)}")
        return value

    def validate_mfa_required_roles(self, value):
        from apps.authentication.models import is_assignable_role

        unknown = [r for r in value if not is_assignable_role(r)]
        if unknown:
            raise serializers.ValidationError(f"unknown role(s): {', '.join(unknown)}")
        return sorted(set(value))

    def update(self, instance, validated_data):
        if "mfa_required_roles" in validated_data:
            from apps.authentication.mfa import MFA_REQUIRED_ROLES_SETTING

            instance.settings = {**(instance.settings or {}), MFA_REQUIRED_ROLES_SETTING: validated_data.pop("mfa_required_roles")}
        for key in VISIT_SETTINGS:
            if key in validated_data:
                value = validated_data.pop(key).strip()
                merged = {k: v for k, v in (instance.settings or {}).items() if k != key}
                if value:
                    merged[key] = value
                instance.settings = merged
        if "rebirth_monthly_quota" in validated_data:
            from apps.tenants.models import REBIRTH_QUOTA_SETTING

            current = dict((instance.settings or {}).get(REBIRTH_QUOTA_SETTING) or {})
            for form, limit in validated_data.pop("rebirth_monthly_quota").items():
                if limit is None:
                    current.pop(form, None)
                else:
                    current[form] = limit
            merged = {k: v for k, v in (instance.settings or {}).items() if k != REBIRTH_QUOTA_SETTING}
            if current:
                merged[REBIRTH_QUOTA_SETTING] = current
            instance.settings = merged
        if SELF_SERVICE_SETTING in validated_data:
            instance.settings = {**(instance.settings or {}), SELF_SERVICE_SETTING: validated_data.pop(SELF_SERVICE_SETTING)}
        if "soul_rebirth_cooldown_days" in validated_data:
            days = validated_data.pop("soul_rebirth_cooldown_days")
            merged = {k: v for k, v in (instance.settings or {}).items() if k != REBIRTH_COOLDOWN_SETTING}
            if days is not None:
                merged[REBIRTH_COOLDOWN_SETTING] = days
            instance.settings = merged
        return super().update(instance, validated_data)


class TenantMfaRoleRowSerializer(serializers.Serializer):
    """One row of `GET /tenants/{code}/mfa-roles/` (殿设置 › 安全)."""

    role = serializers.CharField()
    required = serializers.BooleanField()
    #: ADMIN: required regardless of the setting, shown as 「始终」.
    always = serializers.BooleanField()
    total = serializers.IntegerField()
    enabled = serializers.IntegerField()


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


class TenantCreateSerializer(serializers.ModelSerializer):
    """`POST /tenants/`(全局管理员建殿,2026-10-25)。code 建后不可改;文明必填。

    四个种子殿的 code 在 `TENANT_CIVILIZATION` 里写死了文明:用这样的 code 建殿时,文明必须与那张表一致。"""

    code = serializers.RegexField(r"^[A-Z][A-Z0-9_]{1,49}$", max_length=50,
                                  help_text="大写字母开头,只含大写字母、数字、下划线。")
    civilization = serializers.ChoiceField(choices=Civilization.choices, source="declared_civilization")

    class Meta:
        model = Tenant
        fields = ["code", "display_name", "description", "civilization", "hall_name", "hall_name_en", "hall_name_egy"]

    def validate_code(self, value):
        if Tenant.objects.filter(code=value).exists():
            raise serializers.ValidationError("A hall with this code already exists.", code="code_taken")
        return value

    def validate(self, attrs):
        from apps.souls.models import TENANT_CIVILIZATION

        fixed = TENANT_CIVILIZATION.get(attrs["code"])
        if fixed is not None and fixed != attrs["declared_civilization"]:
            raise serializers.ValidationError({"civilization": f"{attrs['code']} is a {fixed} hall."})
        return attrs


class HallOverviewSerializer(serializers.Serializer):
    """Doc-only: one row of `GET /tenants/overview/`. The shape is built in `apps/tenants/overview.py`."""

    code = serializers.CharField()
    hall_names = serializers.DictField(child=serializers.CharField())
    civilization = serializers.CharField()
    is_active = serializers.BooleanField()
    todo = serializers.DictField(child=serializers.IntegerField(),
                                 help_text="approvals / dispatch_proposals / cooldowns / letters_awaiting / total")
    judgments = serializers.DictField(child=serializers.IntegerField(),
                                      help_text="at_city_god / held / claimed / unclaimed(互不相交)")
    rebirth_quota = serializers.ListField(child=serializers.DictField())
    open_appeals = serializers.IntegerField()
