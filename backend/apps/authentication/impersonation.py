"""「以此人身份查看」(Design 第二十八批 W6):只读代看,最长 30 分钟,开始与结束各记一条审计。

**怎么表示**:代看令牌是一张普通的官员 `access` 令牌,`user_id` 是**被看的人**,另带三个声明
`imp_by`(管理员 id)、`imp_id`(`Impersonation` 行 id)、`imp_exp`(到点的 epoch)。
**没有刷新令牌**;管理员自己的令牌原封不动,由前端另存。

**怎么执行**:唯一的闸在 `OfficerJWTAuthentication.authenticate`(项目默认认证类,所有官员接口都过它),
它见到 `imp_id` 就调 `enforce`:

* 以那一行为准(令牌只是凭据):已结束 / 到点 / 管理员不再是在职 ADMIN / 被看的人被停用 → 403;
* 非安全方法(POST/PUT/PATCH/DELETE)一律 403,只有 `auth/impersonate/end/` 放行;
* 导出(路径以 `/export` 或 `/export_csv` 结尾)403 —— 导出会以被看者的名义写审计行,而且是把数据带出系统;
  `apps/core/exports.py::record_export` 再拦一次(所有 CSV 导出的唯一审计点);
* GET 时按 `X-Imp-Page` 累计看过的不同页面(只在出现新页面时写库)。

WebSocket(`apps/core/ws_auth.py`、`apps/notifications/consumers.py`)和官员 App(`apps/officer_app`)
在各自的认证层拒收带 `imp_id` 的令牌。

审计:开始、结束各一行(`IMPERSONATE_START` / `IMPERSONATE_END`),**代看期间不另记每次浏览**。
被看的人收到站内通知 + 邮件(类型 `IMPERSONATION_STARTED`,类别 `account_security`,锁定不能关)。

**进殿查看**(第五十四批 O-2,`start_hall`):全局管理员只读进入某一殿(停用的殿也行)。同一套:一行
`Impersonation`(`hall` 有值,`target` = 管理员自己)、同样的三个声明、同样 30 分钟、同样只读、同样开始 / 结束审计
(`resource="tenant"`)。令牌的 `tenant_code` 是那一殿;`enforce` 给本次请求的 user 挂上 `hall_view`,
`apps/core/tenant.py::is_tenant_exempt` 见到它就不再把管理员当跨殿角色 —— 于是各页照常按 `request.tenant`
收窄到这一殿,而不是看见全部殿。没有被看的人,所以不发通知。
"""
import re
from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied
from rest_framework_simplejwt.tokens import AccessToken

from apps.audit.models import AuditAction, AuditLog
from apps.authentication.impersonation_models import Impersonation
from apps.authentication.signin_sessions import SID_CLAIM, is_revoked
from apps.core.client_ip import get_client_ip

IMP_BY, IMP_ID, IMP_EXP = "imp_by", "imp_id", "imp_exp"
# 管理员自己的会话:改密码 / 退出全部(session_version)或退出这台设备(sid)时,代看令牌一并失效。
IMP_SV, IMP_SID = "imp_sv", "imp_sid"
MAX_MINUTES = 30
#: 令牌比记录多活一会儿:到点时客户端拿到的是带 code 的 403,而不是笼统的 401(401 意味着「去刷新」)。
TOKEN_GRACE = timedelta(seconds=60)
PAGE_HEADER = "HTTP_X_IMP_PAGE"
MAX_PAGES = 200
END_PATH = "/api/v1/auth/impersonate/end/"
_EXPORT_PATH = re.compile(r"/export(_csv)?/?$")


def is_impersonation(token) -> bool:
    return token is not None and IMP_ID in token


def impersonating(request) -> bool:
    """这一次请求是代看(或进殿查看)。读路径上会顺手写库的地方(标已读、补建资料、对账、读信审计……)
    见到它就跳过:代看只读,GET 也不能替被看的人留下痕迹(2026-10-29 用户决定第 15 条)。"""
    return getattr(request, "impersonation", None) is not None


def refuse(code, detail):
    return PermissionDenied({"detail": detail, "code": code})


def _open(actor, target, reason, request, hall=None):
    close_expired()
    for old in Impersonation.objects.filter(actor=actor, ended_at__isnull=True):
        end(old, "superseded", request=request)
    return Impersonation.objects.create(
        actor=actor, target=target, reason=reason, hall=hall, expires_at=timezone.now() + timedelta(minutes=MAX_MINUTES)
    )


def _token(record, tenant_code, request):
    token = AccessToken.for_user(record.target)
    if tenant_code:
        token["tenant_code"] = tenant_code
    token["sv"] = record.target.session_version
    token[IMP_BY], token[IMP_ID], token[IMP_EXP] = record.actor_id, record.pk, int(record.expires_at.timestamp())
    token[IMP_SV] = record.actor.session_version
    auth = getattr(request, "auth", None)
    if auth is not None and auth.get(SID_CLAIM):
        token[IMP_SID] = auth.get(SID_CLAIM)
    token.set_exp(lifetime=timedelta(minutes=MAX_MINUTES) + TOKEN_GRACE)
    return str(token)


def start(actor, target, reason, request):
    """开始一次代看,返回 `(access 令牌字符串, 记录)`。校验在视图里做完。"""
    with transaction.atomic():
        record = _open(actor, target, reason, request)
        _audit(
            record, AuditAction.IMPERSONATE_START, request,
            description=f"以 {_name(target)} 的身份查看 · 理由：{reason}",
            changes={"imp_id": record.pk, "reason": reason, "target_name": _name(target), "target_role": target.role},
        )
        _notify_target(record)
    return _token(record, target.tenant.code if target.tenant_id else None, request), record


def start_hall(actor, hall, request):
    """全局管理员只读进入 `hall`,返回 `(access 令牌字符串, 记录)`。校验(只限 ADMIN)在视图里做完。"""
    with transaction.atomic():
        record = _open(actor, actor, f"hall:{hall.code}", request, hall=hall)
        _audit(
            record, AuditAction.IMPERSONATE_START, request,
            description=f"以全局管理员身份查看 {hall.code}",
            changes={"imp_id": record.pk, "hall": hall.code},
        )
    return _token(record, hall.code, request), record


def end(record, how, *, request=None):
    """结束一次代看并写「结束代看」。幂等:只有第一个把 `ended_at` 落值的调用写审计。"""
    now = timezone.now()
    stopped_at = min(now, record.expires_at)
    claimed = Impersonation.objects.filter(pk=record.pk, ended_at__isnull=True).update(ended_at=stopped_at, ended_how=how)
    if not claimed:
        return False
    record.refresh_from_db()
    minutes = round((record.ended_at - record.started_at).total_seconds() / 60)
    pages = len(record.pages)
    who = f"全局管理员身份查看 {record.hall.code}" if record.hall_id else f"{_name(record.target)} 的身份查看"
    changes = {
        "imp_id": record.pk, "minutes": minutes,
        "seconds": int((record.ended_at - record.started_at).total_seconds()), "pages": pages, "how": how,
    }
    changes.update({"hall": record.hall.code} if record.hall_id else {"target_name": _name(record.target)})
    _audit(
        record, AuditAction.IMPERSONATE_END, request,
        description=f"以 {who} · {minutes} 分钟 · 看过 {pages} 个页面", changes=changes,
    )
    return True


def close_expired():
    """到点却没人来结束的(标签页关了):补上结束行。惰性执行 —— 下一次开始 / 结束 / 被拒的请求时。"""
    for record in Impersonation.objects.filter(ended_at__isnull=True, expires_at__lte=timezone.now()):
        end(record, "expired")


def enforce(request, user, token):
    """认证层的唯一入口。通过则返回,不通过抛 403(带 `code`)。"""
    record = (
        Impersonation.objects.select_related("actor", "target", "hall")
        .filter(pk=token.get(IMP_ID), target_id=user.pk, actor_id=token.get(IMP_BY))
        .first()
    )
    if record is None:
        raise refuse("impersonation_invalid", "代看已失效。")
    if record.ended_at is not None:
        raise refuse("impersonation_ended", "代看已结束。")
    if timezone.now() >= record.expires_at:
        end(record, "expired")
        raise refuse("impersonation_expired", "代看已到时。")
    if not (record.actor.is_active and record.actor.role == "ADMIN") or _actor_signed_out(record.actor, token):
        end(record, "manual")
        raise refuse("impersonation_ended", "代看已结束。")

    is_end = request.path == END_PATH
    if request.method not in ("GET", "HEAD", "OPTIONS") and not is_end:
        raise refuse("impersonation_read_only", "查看中，不能操作。")
    if _EXPORT_PATH.search(request.path):
        raise refuse("impersonation_read_only", "查看中，不能导出。")
    if record.hall_id:
        if token.get("tenant_code") != record.hall.code:
            raise refuse("impersonation_invalid", "代看已失效。")
        # 只挂在这一次请求的 user 实例上:`is_tenant_exempt` 见到它就按 `request.tenant`(= 这一殿)收窄。
        user.hall_view = record.hall_id
    if request.method == "GET":
        _count_page(record, request.META.get(PAGE_HEADER, ""))
    request.impersonation = record


def _actor_signed_out(actor, token):
    """管理员自己的会话已结束:session_version 变了(改密码 / 退出全部),或签发时那台设备已退出。"""
    return token.get(IMP_SV) != actor.session_version or is_revoked({SID_CLAIM: token.get(IMP_SID)})


def _count_page(record, page):
    page = (page or "").strip()[:200]
    if page and page not in record.pages and len(record.pages) < MAX_PAGES:
        # ponytail: 两个并发请求同时带新页面时后写的覆盖先写的,少算一页;要精确再换成 select_for_update。
        record.pages = [*record.pages, page]
        record.save(update_fields=["pages"])


def _name(user):
    return user.display_name or user.username


def _audit(record, action, request, *, description, changes):
    actor = record.actor
    resource, resource_id = ("tenant", record.hall.code) if record.hall_id else ("user", str(record.target_id))
    AuditLog.objects.create(
        tenant=record.hall if record.hall_id else actor.tenant, user=actor, action=action,
        resource=resource, resource_id=resource_id,
        description=description[:500], changes=changes,
        ip_address=get_client_ip(request) if request is not None else None,
        user_agent=request.META.get("HTTP_USER_AGENT", "")[:500] if request is not None else "",
    )


def _notify_target(record):
    """站内通知;邮件由 `notifications.tasks` 的邮件通道照 `EMAILED_TYPES` 发(账号安全类别锁定,不看偏好)。"""
    from apps.notifications.messages import DEFAULT_LOCALE, render
    from apps.notifications.models import NotificationType, notify_user

    params = {"by": _name(record.actor), "reason": record.reason, "minutes": MAX_MINUTES}
    title, message = render(DEFAULT_LOCALE, "impersonation_started", params)
    notify_user(
        record.target, title=title, message=message, notification_type=NotificationType.IMPERSONATION_STARTED,
        related_resource="user", related_id=str(record.actor_id), params=params,
    )
