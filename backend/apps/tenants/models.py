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

#: `Tenant.settings` 里的审判期限天数(v4 D10,用户 2026-11-06):从案子可认领起算,待定期间不计
#: (`apps/judgment/deadline.py`)。缺键 = 本文明的默认值。**系统自设,非出典**:docs/ 各文明文档里都没有
#: 审判期限(地府的七七斋期是另一回事,埃及的 70 天在开审之前,见 docs/11、docs/02_奥西里斯 的「系统自设」一节)。
DEADLINE_SETTING = "judgment_deadline_days"
DEFAULT_DEADLINE_DAYS = {"CHINESE": 7, "GREEK": 7, "EGYPTIAN": 12, "EUROPEAN": 7}

#: `Tenant.settings` 里殿的时区(IANA 名)。判决文书的时辰按落印那一刻、所在殿的时区写死(v4 D12,
#: `Judgment.concluded_tz`);周统计也按它分周。缺键 = 本文明的默认值。系统自设,非出典。
TIMEZONE_SETTING = "timezone"
DEFAULT_HALL_TIMEZONE = {
    "CHINESE": "Asia/Shanghai", "GREEK": "Europe/Athens", "EGYPTIAN": "Africa/Cairo", "EUROPEAN": "Europe/Rome",
}


def valid_timezone(name) -> bool:
    from zoneinfo import ZoneInfo

    if not isinstance(name, str) or not name:
        return False
    try:
        ZoneInfo(name)
    except (ValueError, KeyError, OSError):  # ZoneInfoNotFoundError is a KeyError
        return False
    return True


#: 「到殿办理」三项(书信没开时灵魂 App 帮助页显示):`settings` 键 → 最大长度。选填,去空格后为空 = 没填(不存键)。
VISIT_SETTINGS = {"visit_address": 80, "visit_hours": 40, "visit_phone": 40}


def _civilization_of(code, declared):
    from apps.souls.models import TENANT_CIVILIZATION, UNKNOWN_CIVILIZATION, Civilization

    if code in TENANT_CIVILIZATION:
        return TENANT_CIVILIZATION[code]
    if declared in Civilization.values:
        return Civilization(declared)
    return UNKNOWN_CIVILIZATION


class Tenant(AuditUserFields, models.Model):
    """A tenant represents a civilization's afterlife system (Chinese Diyu, European Heaven-Hell, Egyptian Duat)."""

    code = models.CharField(max_length=50, unique=True, db_index=True)
    display_name = models.CharField(max_length=200)
    description = models.TextField(blank=True, default="")
    # Blank = show the source, which for the four seeded halls is English already.
    display_name_en = models.CharField(max_length=200, blank=True, default="")
    description_en = models.TextField(blank=True, default="")
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
        return _civilization_of(self.code, self.declared_civilization)

    def save(self, *args, **kwargs):
        """A hall's civilization is fixed once it exists (user decision 2026-11-16): its rows live in that
        civilization's database and its officers act in it. `.update()` bypasses this, as it bypasses every save."""
        fields = kwargs.get("update_fields")
        if not self._state.adding and (fields is None or {"code", "declared_civilization"} & set(fields)):
            using = kwargs.get("using") or self._state.db or "default"
            old = type(self)._base_manager.using(using).filter(pk=self.pk).values_list(
                "code", "declared_civilization").first()
            if old is not None and _civilization_of(*old) != self.civilization:
                from django.core.exceptions import ValidationError

                raise ValidationError({"declared_civilization": ValidationError(
                    f"{old[0]} is a hall of {_civilization_of(*old)}; a hall's civilization does not change.",
                    code="civilization_fixed")})
        super().save(*args, **kwargs)

    @property
    def known_civilization(self):
        """`civilization`,认不出时是 None —— 给原来写 `TENANT_CIVILIZATION.get(code)` 的调用点:
        那张表只认四个种子殿,新建的殿要读 `declared_civilization`(2026-10-26)。"""
        from apps.souls.models import UNKNOWN_CIVILIZATION

        civ = self.civilization
        return None if civ == UNKNOWN_CIVILIZATION else civ

    @property
    def judgment_deadline_days(self) -> int | None:
        """本殿的审判期限天数:设置里的,否则本文明的默认值;认不出文明是 None(不计期限)。"""
        days = (self.settings or {}).get(DEADLINE_SETTING)
        if isinstance(days, int) and not isinstance(days, bool) and days > 0:
            return days
        return DEFAULT_DEADLINE_DAYS.get(self.known_civilization)

    @property
    def hall_timezone(self) -> str:
        """本殿的时区:设置里的(合法的 IANA 名),否则本文明的默认值,再否则 UTC。"""
        name = (self.settings or {}).get(TIMEZONE_SETTING)
        if valid_timezone(name):
            return name
        return DEFAULT_HALL_TIMEZONE.get(self.known_civilization, "UTC")

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


class GlobalCode(models.Model):
    """The control database's registry of codes that must stay unique once their rows are written to four
    civilization databases (sharding stage 4, docs/audit/2026-11-15-sharding/PLAN.md "全局唯一";
    tests/tenancy_global_uniqueness.py STRATEGY = REGISTRY). Claimed by `apps/tenants/global_codes.py` before
    the row is written; `manage.py check_global_codes` compares it with the rows on every alias.

    `tenant_id` is the claiming hall as a bare id with no foreign key, so the row has no path to a hall and stays
    in control (apps.core.sharding: CONTROL). It records who claimed; it is not part of the key.

    One kind is not a code: `SHARD_SYNC_STOPPED` (apps/core/shard_sync.py), value = a civilization, claimed_at = when
    SHARD_PURGED_CIVS first stopped its sync (stage 5: the purge wants a dump newer than that)."""

    kind = models.CharField(max_length=20)
    value = models.CharField(max_length=64)
    tenant_id = models.BigIntegerField(null=True, blank=True)
    claimed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["kind", "value"], name="global_code_one_claim_per_value")]

    def __str__(self):
        return f"{self.kind}:{self.value}"


class OpenCaseClaim(models.Model):
    """The control database's one-open-case-per-soul claim (sharding stage 4 part C; apps/tenants/global_codes.py
    `claim_open_case`). Once civilizations write to their own shards, a REOPEN filed in a soul's home hall and a case
    opened where it resides are written on two databases, and no row lock spans both: the UNIQUE `soul_id` here does.
    Taken before the case row is written, released when that case closes or its write rolls back.

    Bare ids, no foreign keys: the row has no path to a hall and stays in control (apps.core.sharding: CONTROL)."""

    soul_id = models.UUIDField(unique=True)
    #: The case it was taken for (its pk is drawn before the row is written): release names it, so a late release
    #: of a closed case never drops the claim of the next one.
    judgment_id = models.UUIDField()
    tenant_id = models.BigIntegerField(null=True, blank=True)
    claimed_at = models.DateTimeField(auto_now_add=True)
    #: "<alias>:<xid>": the database the case is written on and, on PostgreSQL, the transaction writing it. A claim
    #: whose case is not there is stale only once that transaction is no longer in progress (`claim_open_case`).
    case_txn = models.CharField(max_length=100, blank=True, default="")

    def __str__(self):
        return f"open case {self.judgment_id} of soul {self.soul_id}"


class ShardMessageState(models.TextChoices):
    PENDING = "PENDING"
    DONE = "DONE"
    REFUSED = "REFUSED"
    #: A dead letter: delivery failed `shard_saga.MAX_ATTEMPTS` times. Still open (a move stays in transit); reported
    #: by `check_soul_ownership` / `relay_outbox` until `relay_outbox --retry-failed`.
    FAILED = "FAILED"


class ShardOutbox(models.Model):
    """A cross-civilization saga message (sharding stage 4 part C, apps/tenants/shard_saga.py), written in the SAME
    local transaction as the business rows it accompanies, on the source hall's master. The relay delivers it to the
    target hall's master (which records it in ShardInbox) and then closes it here: DONE, or REFUSED when the target
    refused and the source compensated. PENDING is the saga in flight (a dispatch whose transfer is EXECUTING)."""

    message_id = models.UUIDField(unique=True)
    tenant = models.ForeignKey("tenants.Tenant", on_delete=models.PROTECT, related_name="+")
    target_tenant = models.ForeignKey("tenants.Tenant", on_delete=models.PROTECT, related_name="+")
    kind = models.CharField(max_length=64)
    #: What the message is about ("dispatch:<id>"): a second saga on it is refused while this one is in flight.
    subject = models.CharField(max_length=80, blank=True, default="", db_index=True)
    payload = models.JSONField(default=dict)
    state = models.CharField(max_length=10, choices=ShardMessageState.choices, default=ShardMessageState.PENDING,
                             db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
    done_at = models.DateTimeField(null=True, blank=True)
    #: Failed deliveries so far, and the last one's error (the relay notes them; `Refused` is not a failure).
    attempts = models.PositiveIntegerField(default=0)
    last_error = models.TextField(blank=True, default="")

    def __str__(self):
        return f"{self.kind} {self.message_id} {self.state}"


class ShardInbox(models.Model):
    """A saga message applied on the target hall's master, in the same transaction as what it applied. The unique
    `message_id` is the idempotence: a redelivery fails to insert and applies nothing."""

    message_id = models.UUIDField(unique=True)
    tenant = models.ForeignKey("tenants.Tenant", on_delete=models.PROTECT, related_name="+")
    kind = models.CharField(max_length=64)
    received_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.kind} {self.message_id}"
