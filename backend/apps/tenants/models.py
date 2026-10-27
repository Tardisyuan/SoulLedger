from django.db import models

from apps.core.models import AuditUserFields

#: `Tenant.settings` 里的键:转生申请被终局驳回后的冷却天数(默认 30,负数按 0)。
#: 读的是 `apps/soul_accounts/rebirth.py::cooldown_days`,写的是 `TenantSettingsSerializer`;
#: 常量放在这里是因为两边都能 import 这个模块而不绕圈。
REBIRTH_COOLDOWN_SETTING = "soul_rebirth_cooldown_days"

#: `Tenant.settings` 里「灵魂能不能自己改联系邮箱」的开关;缺省 = 开,只有明确的 False 才关
#: (`apps/soul_accounts/contact_email.py::self_service` 读,`TenantSettingsSerializer` 写)。
SELF_SERVICE_SETTING = "soul_contact_email_self_service"

#: `Tenant.settings` 里的转世月配额:{RebirthForm 值: 每月上限}。缺这个键或缺某一道 = 不限(2026-10-24 用户决定:
#: 殿管理员在后台设,满了的灵魂留在 REINCARNATING 里候位)。读的是 `apps/reincarnation/services.py::quota_of`。
REBIRTH_QUOTA_SETTING = "rebirth_monthly_quota"

#: 「到殿办理」三项(书信没开时灵魂 App 帮助页显示):`settings` 键 → 最大长度。选填,去空格后为空 = 没填(不存键)。
VISIT_SETTINGS = {"visit_address": 80, "visit_hours": 40, "visit_phone": 40}


class Tenant(AuditUserFields, models.Model):
    """A tenant represents a civilization's afterlife system (Chinese Diyu, European Heaven-Hell, Egyptian Duat)."""

    code = models.CharField(max_length=50, unique=True, db_index=True)
    display_name = models.CharField(max_length=200)
    description = models.TextField(blank=True, default="")
    settings = models.JSONField(default=dict, blank=True)
    is_active = models.BooleanField(default=True)
    #: 这个殿接不接收别的殿调来暂居的灵魂(`DispatchService.check_target_accepts`)。关掉是例外:
    #: 两条种子(`seed_tenants`、`mythology/seeding.py`)都把四个殿建成开着的,而 2026-10-08
    #: 之前这个字段没有任何读者,于是上百个测试夹具按 `default=False` 建殿再往里调。默认改成
    #: 开着,让「可接收」是常态、关殿是管理员的一个动作(`TenantSettingsDialog`)。
    dispatch_enabled = models.BooleanField(default=True)
    api_endpoint = models.URLField(blank=True, default="")
    #: 殿司展示名:灵魂写信的收件方在 App 与官员收件箱里叫什么(如「第五殿」)。与 `display_name`
    #: 分开 —— 那一个是租户的管理名(「Chinese Afterlife」),不是灵魂认得的殿名。三语各一份;
    #: 空着就退回 zh,再退回 `display_name`(`hall_names`)。四文明的默认值与出处见 tenants/0012。
    hall_name = models.CharField(max_length=60, blank=True, default="", help_text="殿司展示名(简体中文)")
    hall_name_en = models.CharField(max_length=80, blank=True, default="", help_text="殿司展示名(English)")
    hall_name_egy = models.CharField(max_length=80, blank=True, default="", help_text="殿司展示名(egy)")
    #: 匾上的印字(v2 设计):1–2 个字,只有 ADMIN 能改(`PATCH /tenants/{code}/seal-glyphs/`)。
    #: 空列表 = 前端用文明默认字(冥 / J / U+13184 / Μ)。每文明的字符集校验在
    #: `apps/tenants/serializers.py::validate_seal_glyphs`,超长或字符集不对是 400,从不截断。
    seal_glyphs = models.JSONField(default=list, blank=True)
    #: 管理员新建的殿所属的文明(2026-10-25 用户决定:全局管理员建殿)。四个种子殿的文明仍由
    #: `TENANT_CIVILIZATION`(按 code)给出,那张表优先;这一列只给不在表里的殿用。空 = 未知文明。
    #: 路由(`CIVILIZATION_TENANT`)仍按「每个文明一个殿」反查种子殿。跨文明调拨不走那张表:
    #: 目标殿由人选,启用的新殿在单选里(`/ledger/stats/overview/` 补空殿),界域按 `civilization` 取。
    declared_civilization = models.CharField(max_length=20, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["code"]
        verbose_name = "Tenant"
        verbose_name_plural = "Tenants"

    def __str__(self):
        return self.code

    @property
    def civilization(self) -> str:
        """这个租户代表的文明,读 `TENANT_CIVILIZATION`(唯一一份映射);不在表里是 `UNKNOWN`。"""
        from apps.souls.models import TENANT_CIVILIZATION, UNKNOWN_CIVILIZATION, Civilization

        if self.code in TENANT_CIVILIZATION:
            return TENANT_CIVILIZATION[self.code]
        if self.declared_civilization in Civilization.values:
            return Civilization(self.declared_civilization)
        return UNKNOWN_CIVILIZATION

    @property
    def known_civilization(self):
        """`civilization`,认不出时是 None —— 给原来写 `TENANT_CIVILIZATION.get(code)` 的调用点:
        那张表只认四个种子殿,新建的殿要读 `declared_civilization`(2026-10-26)。"""
        from apps.souls.models import UNKNOWN_CIVILIZATION

        civ = self.civilization
        return None if civ == UNKNOWN_CIVILIZATION else civ

    @property
    def hall_names(self):
        """{locale: 殿司展示名},键与 App 的三个语言包同名。空的退回 zh,再退回 `display_name`。"""
        zh = self.hall_name or self.display_name
        return {"zh-Hans": zh, "en": self.hall_name_en or zh, "egy": self.hall_name_egy or zh}


    # `Notification` (in-app notification for dispatch invitations, judgment
    # results, etc.) lived here — deleted 2026-09-13 (BP-13). It had four
    # writers, all in `apps/dispatch/services.py`, and no reader anywhere in
    # the repository: no serializer, no view, no consumer, no test besides the
    # one that pinned its row count at 0. `apps.notifications.UserNotification`
    # is the model actually served (serializer + viewset + WS consumer + page).
    # See `backend/tests/test_a_dispatch_notification_reaches_a_reader.py` for
    # the incident this model was the cause of, and migration 0010 for the
    # table drop.


def _drop_cached_halls(**_kwargs):
    """`TenantMiddleware` keeps a short per-worker copy of each hall row; a save or delete here drops it."""
    from apps.tenants.middleware import clear_tenant_cache

    clear_tenant_cache()


models.signals.post_save.connect(_drop_cached_halls, sender=Tenant, dispatch_uid="tenants.drop_cached_halls.save")
models.signals.post_delete.connect(_drop_cached_halls, sender=Tenant, dispatch_uid="tenants.drop_cached_halls.delete")
