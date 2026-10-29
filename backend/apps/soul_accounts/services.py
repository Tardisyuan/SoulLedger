"""灵魂账号的全部写路径。视图、死亡同步、转世、管理命令都只调这里。

状态机(账号):
    (无) --provision--> 当前(must_change_password=True, 72h)
    当前 --soul 改密--> 当前(must_change_password=False)
    当前 --官员重置--> 当前(must_change_password=True, 新的 72h)
    当前 --转世完成--> 停用(retired_at 写上,User.is_active=False)   ← 终态
    当前 --被阿米特吞噬--> 停用(同上,但登录邮箱保留:没有下一世要用它)   ← 终态

状态机(初始凭据,见 models.CredentialStatus):
    QUEUED --提交后发送成功--> SENT
    QUEUED --无渠道 / 发送失败--> PENDING --重试成功--> SENT
    PENDING --官员查看一次--> REVEALED --标记交付--> DELIVERED
    QUEUED/PENDING/REVEALED --过期 / 重置 / 改密 / 转世--> VOID
"""
import logging
import secrets
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.contrib.auth.models import update_last_login
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.soul_accounts.delivery import pick_delivery
from apps.soul_accounts.models import (
    SECRET_BEARING_STATUSES,
    CredentialStatus,
    DeviceLoginRevokeReason,
    InitialCredential,
    SoulAccount,
)

logger = logging.getLogger(__name__)
User = get_user_model()

SOUL_ROLE = "SOUL"
INITIAL_PASSWORD_TTL = timedelta(hours=72)
#: 去掉 0/O/1/I/L,人照着纸抄不会抄错。
SOUL_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
SOUL_CODE_LENGTH = 10


def normalize_soul_code(raw):
    """用户手输的编号 → 库里的样子:去首尾空白、转大写。登录与聊天查找共用这一条,
    两处规则不能各写一份(一处放宽、一处没放宽,就是「登得进却查不到」)。"""
    return (raw or "").strip().upper()


class SoulAccountError(Exception):
    """业务拒绝。`code` 给 App 做分支用,`status` 给视图选状态码。"""

    def __init__(self, message, code, status=409):
        super().__init__(message)
        self.code = code
        self.status = status


# ── 审计 ─────────────────────────────────────────────────────────────────


def audit(action, soul, description, *, actor=None, request=None, resource_id="", changes=None,
          resource="soul_account"):
    """显式写一条 AuditLog。不走 `apps/audit/signals.py` 的通用 diff:这几张表
    不继承 AuditUserFields,开通 / 重置 / 查看 / 交付是动作而不是字段变化,
    一条说清「谁对哪个灵魂做了什么」的行比一串字段 diff 有用。**不含密码。**"""
    from apps.audit.models import AuditLog
    from apps.core.client_ip import get_client_ip

    AuditLog.objects.create(
        tenant=soul.home_tenant,
        user=actor if getattr(actor, "is_authenticated", False) else None,
        action=action,
        resource=resource,
        resource_id=str(resource_id or soul.pk),
        description=description[:500],
        changes=changes,
        ip_address=get_client_ip(request) if request is not None else None,
        user_agent=request.META.get("HTTP_USER_AGENT", "")[:500] if request is not None else "",
    )


# ── 查询 ─────────────────────────────────────────────────────────────────


def current_account_of(soul):
    return SoulAccount.objects.filter(soul=soul, retired_at__isnull=True).select_related("user").first()


def _new_soul_code():
    return "".join(secrets.choice(SOUL_CODE_ALPHABET) for _ in range(SOUL_CODE_LENGTH))


def _ensure_soul_code(soul):
    """首次开号时分配,之后不变。碰撞(31^10 空间里几乎不会)就换一个再试。"""
    from apps.souls.models import Soul

    while not soul.soul_code:
        code = _new_soul_code()
        try:
            with transaction.atomic():
                updated = Soul.all_objects.filter(pk=soul.pk, soul_code__isnull=True).update(soul_code=code)
        except IntegrityError:
            continue
        soul.refresh_from_db(fields=["soul_code"])
        if not updated and not soul.soul_code:  # pragma: no cover - 行不存在
            raise SoulAccountError("灵魂不存在。", "soul_not_found", 404)
    return soul.soul_code


# ── 开通 ─────────────────────────────────────────────────────────────────


def provision_account(soul, origin, *, actor=None, request=None):
    """为灵魂的**本世**开通账号并签发初始密码。返回 `(account, created)`。

    幂等:本世已有账号就原样返回,**不重发密码**。

    并发:锁灵魂行,再靠 `(soul, cycle)` 唯一约束兜底。PostgreSQL 上第二个并发的
    死亡同步在锁上等,拿到锁后看见已有账号;锁不存在的后端(SQLite 表锁)或绕过
    锁的写者撞唯一约束,在保存点里回滚,同样返回已有账号 —— 两条路都不会发出
    第二封密码,因为密码只在 `created=True` 的那条路径上随事务提交发送。
    """
    from apps.souls.models import Soul, SoulState

    caller_copy = soul
    with transaction.atomic():
        soul = Soul.all_objects.select_for_update(of=("self",)).select_related("tenant").get(pk=soul.pk)
        if soul.current_state == SoulState.ALIVE:
            raise SoulAccountError("灵魂尚在世,不能开通灵魂账号。", "soul_alive")
        cycle = soul.life_index
        existing = SoulAccount.objects.filter(soul=soul, cycle=cycle).first()
        if existing is not None:
            return existing, False
        code = _ensure_soul_code(soul)
        caller_copy.soul_code = code  # 调用方手里那份也看得见刚分配的编号
        previous = SoulAccount.objects.filter(soul=soul, cycle__lt=cycle).order_by("-cycle").first()
        try:
            with transaction.atomic():
                user = User.objects.create_user(
                    username=f"soul.{code}.{cycle}", role=SOUL_ROLE, tenant=soul.home_tenant,
                    display_name=soul.name[:100],
                )
                user.set_unusable_password()
                user.save(update_fields=["password"])
                account = SoulAccount.objects.create(
                    user=user, soul=soul, cycle=cycle, previous_account=previous, origin=origin,
                )
        except IntegrityError:
            return SoulAccount.objects.get(soul=soul, cycle=cycle), False
        sync_login_email(soul)
        credential = _issue_credential(account, soul)
        audit("CREATE", soul, f"开通灵魂账号(第 {cycle} 世,{origin})", actor=actor, request=request,
              resource_id=account.pk, changes={"cycle": cycle, "origin": origin, "channel": credential.channel})
        from apps.events.services import EventService

        EventService.log(soul, "SOUL_ACCOUNT_CREATED", {
            "account_id": str(account.pk), "cycle": cycle, "origin": origin,
            "previous_account_id": str(previous.pk) if previous else None,
        })
    return account, True


def reset_credential(account, *, actor=None, request=None):
    """官员重置:新密码、新 72 小时,之前所有未完结的凭据作废。**从不重发旧密码** ——
    旧的明文在发出时就已抹掉,这里也拿不到。"""
    with transaction.atomic():
        # 锁序 灵魂 → 账号(见 rebirth._lock_account):下面插入的凭据行对灵魂取 KEY SHARE。
        from apps.souls.models import Soul

        Soul.all_objects.select_for_update(of=("self",)).filter(pk=account.soul_id).first()
        account = SoulAccount.objects.select_for_update(of=("self",)).select_related("soul__tenant", "user").get(pk=account.pk)
        if account.retired_at is not None:
            raise SoulAccountError("该账号已随转世停用,不能重置。", "account_retired")
        _void_open_credentials(account)
        credential = _issue_credential(account, account.soul)
        audit("UPDATE", account.soul, f"重置灵魂账号初始密码(第 {account.cycle} 世)", actor=actor,
              request=request, resource_id=account.pk, changes={"channel": credential.channel})
    return credential


def _issue_credential(account, soul):
    """在调用方的事务里:设密码、写 QUEUED 行(明文加密),提交后发送。"""
    password = secrets.token_urlsafe(12)
    expires_at = timezone.now() + INITIAL_PASSWORD_TTL
    user = account.user
    user.set_password(password)
    user.save(update_fields=["password"])
    account.must_change_password = True
    account.initial_password_expires_at = expires_at
    account.save(update_fields=["must_change_password", "initial_password_expires_at"])
    end_account_sessions(account)
    _void_mfa_devices(account)  # 重置密码不关两步验证,但「这部手机不再询问」要重新确认
    from apps.soul_accounts import device_login

    device_login.revoke_all(account, DeviceLoginRevokeReason.PASSWORD_RESET_BY_OFFICER)  # 面容/指纹登录同理

    delivery = pick_delivery(soul)
    credential = InitialCredential.objects.create(
        account=account, soul=soul, expires_at=expires_at,
        channel=delivery.channel if delivery else "",
        status=CredentialStatus.QUEUED if delivery else CredentialStatus.PENDING,
        secret=password,
    )
    if delivery is not None:
        transaction.on_commit(lambda: send_credential(credential.pk))
    return credential


def send_credential(credential_id):
    """发送一条 QUEUED / PENDING 凭据。成功 → SENT 并抹掉明文;失败 → PENDING。

    持锁发送(ponytail: 发件期间这一行被锁住,SMTP 超时 10 秒;量上来改 celery 任务 +
    SKIP LOCKED)。持锁是为了「只发一次」:提交后回调与官员的「重试」并发时,
    后到的那个看见 SENT 直接返回。
    """
    with transaction.atomic():
        credential = (
            InitialCredential.objects.select_for_update(of=("self",))
            .select_related("soul", "account").filter(pk=credential_id).first()
        )
        if credential is None or credential.status not in SECRET_BEARING_STATUSES:
            return credential
        if _expire_if_due(credential):
            return credential
        delivery = pick_delivery(credential.soul)
        if delivery is None:
            credential.status = CredentialStatus.PENDING
            credential.channel = ""
            credential.save(update_fields=["status", "channel"])
            return credential
        credential.attempts += 1
        credential.channel = delivery.channel
        try:
            delivery.send(credential.soul, credential.soul.soul_code, credential.secret, credential.expires_at)
        except Exception as exc:  # 任何渠道故障都进待交付,不能丢
            logger.warning("soul credential %s: %s delivery failed: %s", credential.pk, delivery.channel,
                           type(exc).__name__)
            credential.status = CredentialStatus.PENDING
            credential.last_error = f"{type(exc).__name__}"[:200]
            credential.save(update_fields=["status", "channel", "attempts", "last_error"])
            return credential
        credential.status = CredentialStatus.SENT
        credential.secret = ""
        credential.sent_at = timezone.now()
        credential.last_error = ""
        credential.save(update_fields=["status", "channel", "attempts", "secret", "sent_at", "last_error"])
    return credential


def _expire_if_due(credential) -> bool:
    """过期就作废并抹明文;返回「是否已过期」(包括先前已被作废的过期行)。"""
    if credential.expires_at > timezone.now():
        return False
    if credential.status in (
        CredentialStatus.QUEUED, CredentialStatus.PENDING, CredentialStatus.REVEALED
    ):
        credential.status = CredentialStatus.VOID
        credential.secret = ""
        credential.save(update_fields=["status", "secret"])
    return credential.status == CredentialStatus.VOID


def expire_due_credentials():
    """把过期还带着明文的行作废。列表接口每次调用 —— 明文不因为没人来看就一直躺着。"""
    return InitialCredential.objects.filter(
        expires_at__lte=timezone.now(),
        status__in=[CredentialStatus.QUEUED, CredentialStatus.PENDING, CredentialStatus.REVEALED],
    ).update(status=CredentialStatus.VOID, secret="")


def _void_open_credentials(account):
    InitialCredential.objects.filter(
        account=account,
        status__in=[CredentialStatus.QUEUED, CredentialStatus.PENDING, CredentialStatus.REVEALED],
    ).update(status=CredentialStatus.VOID, secret="")


def reveal_credential(credential_id, *, actor, request=None):
    """待交付明文**只能被看一次**。锁行、读出、抹掉、写审计,同一事务。"""
    with transaction.atomic():
        credential = (
            InitialCredential.objects.select_for_update(of=("self",))
            .select_related("soul__tenant", "account").get(pk=credential_id)
        )
        # 过期作废要落库,所以先提交再抛:在 atomic 里抛会把作废一起回滚。
        expired = _expire_if_due(credential)
        if not expired and credential.status == CredentialStatus.PENDING and credential.secret:
            password = credential.secret
            credential.secret = ""
            credential.status = CredentialStatus.REVEALED
            credential.revealed_at = timezone.now()
            credential.revealed_by = actor
            credential.save(update_fields=["secret", "status", "revealed_at", "revealed_by"])
            audit("VIEW", credential.soul, "查看待交付初始密码(仅此一次)", actor=actor, request=request,
                  resource_id=credential.pk)
            return credential, password
    if expired:
        raise SoulAccountError("初始密码已过期,请重置。", "credential_expired", 410)
    raise SoulAccountError("明文已被查看过或已发送,不能再次查看;如需交付请重置。",
                           "credential_not_revealable", 409)


def mark_delivered(credential_id, *, actor, request=None):
    with transaction.atomic():
        credential = (
            InitialCredential.objects.select_for_update(of=("self",)).select_related("soul__tenant").get(pk=credential_id)
        )
        expired = _expire_if_due(credential)
        if not expired and credential.status == CredentialStatus.REVEALED:
            credential.status = CredentialStatus.DELIVERED
            credential.delivered_at = timezone.now()
            credential.delivered_by = actor
            credential.save(update_fields=["status", "delivered_at", "delivered_by"])
            audit("EXECUTE", credential.soul, "标记初始密码已线下交付", actor=actor, request=request,
                  resource_id=credential.pk)
            return credential
    if expired:
        raise SoulAccountError("初始密码已过期,请重置。", "credential_expired", 410)
    raise SoulAccountError("只有已查看的待交付项可以标记为已交付。", "credential_not_revealed", 409)


#: 交付单能印的状态。发送失败的行是 PENDING(`last_error` 有值),官员可不等重试、当面交。
PRINTABLE_STATUSES = (CredentialStatus.PENDING, CredentialStatus.REVEALED, CredentialStatus.DELIVERED)


def print_slip(credential_id, *, actor, request=None):
    """交付单要印的内容 + 一条审计。**不改任何状态,不含密码**(单上留空格,官员当面写或口头说)。
    过期 / 作废的单上有效期已不对:409。"""
    credential = InitialCredential.objects.select_related("soul__home_tenant").get(pk=credential_id)
    if credential.status == CredentialStatus.VOID:
        raise SoulAccountError("该初始密码已作废,不能打印交付单;请重置。", "credential_void", 409)
    if credential.expires_at <= timezone.now():
        raise SoulAccountError("初始密码已过期,不能打印交付单;请重置。", "credential_expired", 409)
    if credential.status not in PRINTABLE_STATUSES:
        raise SoulAccountError("已经发送给灵魂的初始密码不需要交付单。", "credential_not_printable", 409)
    now = timezone.now()
    audit("EXECUTE", credential.soul, "打印初始密码交付单", actor=actor, request=request,
          resource_id=credential.pk, changes={"action": "credentials.print_slip", "status": credential.status})
    return {
        "soul_name": credential.soul.name, "soul_code": credential.soul.soul_code,
        "home_tenant": credential.soul.home_tenant, "expires_at": credential.expires_at,
        "officer_name": (actor.display_name or actor.username), "printed_at": now,
    }


def retry_credential(credential_id, *, actor, request=None):
    credential = InitialCredential.objects.select_related("soul__tenant").get(pk=credential_id)
    if credential.status != CredentialStatus.PENDING:
        raise SoulAccountError("只有待交付项可以重试发送。", "credential_not_pending", 409)
    credential = send_credential(credential.pk)
    audit("EXECUTE", credential.soul, f"重试发送初始密码 → {credential.status}", actor=actor,
          request=request, resource_id=credential.pk)
    return credential


# ── 灵魂侧 ───────────────────────────────────────────────────────────────


def initial_password_expired(account) -> bool:
    return bool(
        account.must_change_password
        and account.initial_password_expires_at is not None
        and account.initial_password_expires_at <= timezone.now()
    )


def issue_tokens(account, session=None):
    """`session`(`SignInSession`)给了就把它的 `sid` 写进刷新令牌:这台设备的整条轮换血统共用它。"""
    from apps.soul_accounts.authentication import SoulRefreshToken

    refresh = SoulRefreshToken.for_user(account.user)
    refresh["soul_account_id"] = str(account.pk)
    refresh["cycle"] = account.cycle
    # 与官员令牌同一个 `sv`:账号的会话被「立刻结束」时 `session_version` +1,更早签发的 access 当场 401。
    # 缺省按 0 算(`session_is_current`),所以上线前签发的令牌不受影响。
    refresh["sv"] = account.user.session_version
    if session is not None:
        from apps.authentication import signin_sessions

        signin_sessions.attach(refresh, session)
    return {"access": str(refresh.access_token), "refresh": str(refresh)}


def authenticate(soul_code, password):
    """第一步:编号 + 密码 → 账号(尚未发令牌);失败抛 SoulAccountError(status 401)。

    只找**当前**账号 —— 前世账号在这里根本不是候选,于是「前世账号不能登录」不靠
    一条 if,而靠查询的形状。编号不存在时仍跑一次哈希,响应时间不泄露编号是否存在。
    """
    from apps.souls.models import Soul

    bad = SoulAccountError("灵魂编号或密码错误。", "invalid_credentials", 401)
    soul = Soul.objects.filter(soul_code=normalize_soul_code(soul_code)).first()
    account = current_account_of(soul) if soul is not None else None
    if account is None or not account.user.is_active:
        # 被阿米特吞噬的灵魂没有本世账号了。**只有密码对时**才说出原因(第四十九批):编号加错密码照旧是
        # 「编号或密码错误」,不向试编号的人泄露这个灵魂的结局。
        devoured = (
            SoulAccount.objects.select_related("user")
            .filter(soul=soul, retired_reason=DeviceLoginRevokeReason.ACCOUNT_ANNIHILATED).order_by("-cycle").first()
            if account is None and soul is not None else None
        )
        if devoured is not None and devoured.user.check_password(password):
            raise SoulAccountError("这一世的账号已注销：心已交予阿米特。", "account_devoured", 401)
        if devoured is None:
            User().set_password(password)
        raise bad
    if not account.user.check_password(password):
        raise bad
    if initial_password_expired(account):
        raise SoulAccountError("初始密码已过期,请联系官员重置。", "initial_password_expired", 401)
    return account


def complete_login(account, *, request=None, method="password", trust_hash=""):
    """密码(以及开着两步验证时的第二步)都过了:记登录时间、建登录设备、发令牌。
    `trust_hash`:这次登录用的「30 天内不再询问」设备令牌的 sha256(退出这台时一并作废)。"""
    from apps.authentication import signin_sessions

    update_last_login(None, account.user)
    session = signin_sessions.start(account.user, request, method=method, trust_hash=trust_hash)
    return issue_tokens(account, session)


def change_password(account, old_password, new_password, push_token="", device_credential="", keep_session=None):
    from django.contrib.auth.password_validation import validate_password

    if initial_password_expired(account):
        raise SoulAccountError("初始密码已过期,请联系官员重置。", "initial_password_expired", 403)
    user = account.user
    if not user.check_password(old_password):
        raise SoulAccountError("原密码不正确。", "invalid_old_password", 400)
    if old_password == new_password:
        raise SoulAccountError("新密码不能与原密码相同。", "password_unchanged", 400)
    validate_password(new_password, user)
    # 其他设备全部退出,这一台保持:调用者用返回的新令牌对替换手里的(新令牌带新的 `sv`)。
    # `push_token` 是这台手机自己的推送 token,留着;其余推送登记停用。
    # `device_credential` 同理:在这部手机上改的,这部手机的面容/指纹登录留着(其余照旧失效)。
    set_password_chosen_by_soul(account, new_password, keep_push_token=push_token,
                                keep_device_credential=device_credential, keep_session=keep_session)
    return issue_tokens(account, keep_session)


def set_password_chosen_by_soul(account, new_password, keep_push_token="", keep_device_credential="",
                                keep_session=None):
    """灵魂自己定的密码 —— 改初始密码与邮箱重置(`set_new_password`)共用。
    初始密码的生命周期到此结束:不再强制改密、不再过期;否则邮箱重置之后
    仍被要求「修改初始密码」,而初始密码已过期时新密码也登不进去。"""
    user = account.user
    with transaction.atomic():
        user.set_password(new_password)
        user.save(update_fields=["password"])
        account.must_change_password = False
        account.initial_password_expires_at = None
        account.save(update_fields=["must_change_password", "initial_password_expires_at"])
        # 灵魂已经自己设了密码:还没交付的初始密码没有意义了,明文立即作废。
        _void_open_credentials(account)
        end_account_sessions(account, keep_push_token=keep_push_token, keep_session=keep_session)
        _void_mfa_devices(account)  # 改密码不关两步验证,但「这部手机不再询问」全部作废
        from apps.soul_accounts import device_login

        device_login.revoke_all(account, DeviceLoginRevokeReason.PASSWORD_CHANGED,
                                keep_credential=keep_device_credential)


def end_account_sessions(account, keep_push_token="", keep_session=None):
    """这个灵魂账号此前签发的全部令牌作废(刷新令牌进黑名单 + `session_version` +1,access 当场失效),
    推送登记除 `keep_push_token` 外一律停用 —— 退出的设备不该再收到推送。与官员端同一套
    (`authentication.passwords.end_sessions`);调用方负责事务,之后给当前设备签的新令牌带新的 `sv`。"""
    from apps.authentication.passwords import end_sessions
    from apps.soul_push.models import DeviceInvalidReason, PushDevice

    end_sessions(account.user, keep_session=keep_session)
    rows = PushDevice.objects.filter(account=account, is_active=True)
    if keep_push_token:
        rows = rows.exclude(token=keep_push_token)
    rows.update(is_active=False, invalid_reason=DeviceInvalidReason.UNREGISTERED)


def _void_mfa_devices(account):
    from apps.soul_accounts import mfa

    mfa.void_devices(account)


def _revoke_refresh_tokens(user):
    from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

    for token in OutstandingToken.objects.filter(user=user, blacklistedtoken__isnull=True):
        BlacklistedToken.objects.get_or_create(token=token)


# ── 转世 ─────────────────────────────────────────────────────────────────


def retire_account_for_rebirth(soul, ended_cycle):
    """转世完成时调用,**在转世的同一事务里**。本世账号停用,永不可再登录。
    没有账号(这一世从没开过号)就什么也不做。"""
    return _retire_account(
        soul, ended_cycle, reason=DeviceLoginRevokeReason.ACCOUNT_REINCARNATED, keep_email=False,
        note=f"转世完成,第 {ended_cycle} 世灵魂账号停用",
    )


def retire_account_annihilated(soul):
    """被阿米特吞噬(处置去处 `EG_ANNIHILATION`)执行时调用,**在执行的同一事务里**(用户 2026-10-20 定)。

    吞噬是第二次死亡:没有下一世,没有申诉,受刑计划停在永久那一站,重开审判拒(`plan_held`)——
    所以这一世的账号永久注销,与转世同一套。**数据全部保留**(用户:以免后期查阅):账号行、书信
    (Matrix 停用时 `erase: false`)、朋友圈、审判与事件都不动;与转世唯一的不同是**登录邮箱不清**——
    转世清它是为了让下一世的账号用,这里没有下一世。"""
    return _retire_account(
        soul, soul.life_index, reason=DeviceLoginRevokeReason.ACCOUNT_ANNIHILATED, keep_email=True,
        note=f"被阿米特吞噬,第 {soul.life_index} 世灵魂账号注销",
    )


def _retire_account(soul, cycle, *, reason, keep_email, note):
    account = (
        SoulAccount.objects.select_for_update(of=("self",)).select_related("user")
        .filter(soul=soul, cycle=cycle, retired_at__isnull=True).first()
    )
    if account is None:
        return None
    account.retired_at = timezone.now()
    account.retired_reason = str(reason)
    account.save(update_fields=["retired_at", "retired_reason"])
    account.user.is_active = False
    if keep_email:
        account.user.save(update_fields=["is_active"])
    else:
        # 停用的账号不再占着登录邮箱:下一世的账号要用它,邮箱重置也只该找到可登录的那个。
        account.user.email = ""
        account.user.save(update_fields=["is_active", "email"])
    _void_open_credentials(account)
    from apps.authentication.passwords import end_sessions

    end_sessions(account.user)  # 推送设备在下面单独停用
    # 两步验证跟着「这一世的账号」:密钥、恢复码、记住的设备一起作废。
    from apps.soul_accounts import mfa

    had_mfa = mfa.void_all(account)
    # 面容/指纹登录的凭据标原因而不是删:登录页要告诉灵魂为什么(`device_login.find` 跨世找得到)。
    from apps.soul_accounts import device_login

    device_login.revoke_all(account, reason)
    # 同一事务里停用推送设备:停用的账号不再收到任何推送,回滚则一起回滚。
    from apps.soul_push.services import invalidate_account_devices

    invalidate_account_devices(account)
    audit("UPDATE", soul, note, resource_id=account.pk, changes={"mfa_voided": True} if had_mfa else None)
    from apps.events.services import EventService

    EventService.log(soul, "SOUL_ACCOUNT_RETIRED", {"account_id": str(account.pk), "cycle": cycle,
                                                    "reason": str(reason)})
    return account


def apply_contacts(soul, contact_email="", contact_phone=""):
    """有值才写;save 而不是 update,走审计信号,值由 PII_FIELD_NAMES 遮蔽。
    写了邮箱就同步到本世账号的登录邮箱(`sync_login_email`)。"""
    old_email = soul.contact_email
    updates = {f: v for f, v in (("contact_email", contact_email), ("contact_phone", contact_phone)) if v}
    for field, value in updates.items():
        setattr(soul, field, value)
    if updates:
        soul.save(update_fields=list(updates))
    if "contact_email" in updates:
        sync_login_email(soul, old_email)


def sync_login_email(soul, old_email=""):
    """联系邮箱 → 本世账号的 `User.email`,邮箱自助重置(`reset_password_request`)
    按后者找人(2026-09-26 产品决定)。没有本世账号就什么也不做 —— 开号时再同步一次。

    `User.email` 在未删除的行里唯一(大小写不敏感,authentication 0016),而一家人
    可以共用一个联系邮箱。地址已被**别的**账号占用时不写,账号的登录邮箱保持原样,
    写一条审计;官员侧从 `email_not_synced` 看到它,这个灵魂只能由官员重置密码。
    联系邮箱被清空时,只在登录邮箱仍等于旧联系邮箱时才清。返回 `"taken"` 或 None。
    """
    account = current_account_of(soul)
    if account is None:
        return None
    user = account.user
    new = soul.contact_email
    if not new:
        if old_email and user.email.lower() == old_email.lower():
            user.email = ""
            user.save(update_fields=["email"])
        return None
    if user.email.lower() == new.lower():
        return None
    # 占用与否交给唯一约束判断(它和这里要的规则逐字相同,也挡得住并发写者),
    # 在保存点里撞,PostgreSQL 上外层事务不中止。
    user.email = new
    try:
        with transaction.atomic():
            user.save(update_fields=["email"])
        return None
    except IntegrityError:
        user.refresh_from_db(fields=["email"])
    audit("UPDATE", soul, f"联系邮箱已被其他账号占用,未同步为登录邮箱(第 {account.cycle} 世)",
          resource_id=account.pk, changes={"email_not_synced": "taken"})
    return "taken"


def email_not_synced(account):
    """官员侧响应里的 `email_not_synced`:本世账号有联系邮箱、登录邮箱却不是它 ——
    每个写联系邮箱的路径都同步,所以不一致只可能是地址被别的账号占着。"""
    contact = account.soul.contact_email
    if account.retired_at is not None or not contact:
        return None
    return None if account.user.email.lower() == contact.lower() else "taken"


def provision_on_death(soul, origin):
    """`Soul.transition_to` 在 ALIVE -> JUDGING 的同一事务里调用。所有登记死亡的途径
    都经过那里,所以这是开号的唯一自动入口。

    开号失败**不**让死亡回滚:死亡是事实,账号是派生物,缺了由 `backfill_soul_accounts`
    补。失败在保存点里回滚(PostgreSQL 上外层事务不会因此中止),写 error 日志。
    """
    try:
        with transaction.atomic():
            return provision_account(soul, origin)[0]
    except Exception:
        logger.error("soul account provisioning on death failed for soul %s", soul.pk, exc_info=True)
        _tell_officers_provisioning_failed(soul)
        return None


def _tell_officers_provisioning_failed(soul):
    """开号失败不回滚死亡,但不能只留一行日志:通知灵魂原属租户的在职 ADMIN(该租户没有就通知
    全局 ADMIN,与 `judgment.claims.request_reassign` 同一条退路),外加当下操作的官员。

    站内通知提交之后才发(与 `dispatch` / `sentence_plan` 同一处理,`30052b65`、`8e3f33f7`):失败的
    通知 INSERT 会把外层事务标成回滚。注册在失败的保存点之外 —— 保存点里注册的回调会随它回滚而丢掉。
    """
    from apps.core.request_local import get_current_user

    User = get_user_model()
    admins = User.objects.filter(role="ADMIN", is_active=True).order_by("pk")
    home = soul.home_tenant_id or soul.tenant_id
    recipient_ids = {u.pk for u in (admins.filter(tenant_id=home) or admins.filter(tenant__isnull=True))}
    actor = get_current_user()
    if actor is not None and getattr(actor, "is_authenticated", False) and actor.role != SOUL_ROLE:
        recipient_ids.add(actor.pk)
    soul_id, soul_name = str(soul.pk), soul.name

    def send():
        from apps.events.services import EventService
        from apps.notifications import messages

        params = {"kind": "soul_account_provisioning_failed", "soul": soul_name, "command": "backfill_soul_accounts"}
        title, body = messages.render(messages.DEFAULT_LOCALE, params["kind"], params)
        for user in User.objects.filter(pk__in=recipient_ids, is_active=True).select_related("tenant").order_by("pk"):
            EventService.notify_user(
                user,
                title=title,
                message=body,
                params=params,
                notification_type="SYSTEM",
                related_resource="soul",
                related_id=soul_id,
            )

    transaction.on_commit(send)
