"""聊天的全部写路径。四条规则(2026-09-17 用户决定)在这里,**不在客户端**。

    1. 互相关注          → 自由私聊
    2. 同文明、非互关    → 私聊请求,每 24 小时一条;对方回过话或两人互关后解除
    3. 官员收件箱        → 灵魂 → 当前所在殿司;官员在 Web 后台看与回
    4. 跨文明            → 拒绝

**规则是服务端执行的,而「服务端」有两半:**

* *这个文件* 决定房间建不建、谁能进、发起方有没有用光这 24 小时的额度;
* *Synapse* 让绕过这里变得不可能 —— `config/synapse/soulledger_policy.py` 拒绝服务账号
  以外的任何人建房、邀请、建别名、发状态事件,房间的 power level 又把同一句话说了
  第二遍。少了这一半,灵魂拿着自己的 access token 直接 `POST /createRoom` 就绕过了
  上面四条的全部。集成测试 `tests/test_chat_synapse_integration.py` 对着真 Synapse 断言这件事。

**节流的落点是 power level。** 被节流的房间里发起方是 0 级、`events_default` 是 50,
所以它在 Matrix 里根本发不出消息;唯一的出口是
`POST /me/chat/conversations/{id}/messages/`,而那条路走这个文件。解除节流 = 把它提回 50,
从那以后消息不再经过后端 —— 互关房间从一开始就是这样,后端不在消息路径上。

**举报**:朋友圈那一轮(`feat/soul-social-2`)带来审核队列。接入点是
`officer_messages()` 返回的 `event_id` —— 一条聊天消息的稳定标识只有它,正文不在我们库里。
到时候在这里加一个 `report(account, conversation, event_id, reason)`,写队列 + 审计。
本轮**不提供**举报端点:一个收下举报又丢掉的接口比没有更糟。

**审计不含正文。** `audit()` 写的是「谁对哪个会话做了什么」,body 一个字都不传进去。
"""
import logging
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.chat.identity import ensure_identity
from apps.chat.matrix import MatrixError, get_client, login_jwt
from apps.chat.models import ChatIdentity, Conversation, ConversationKind
from apps.chat.relations import are_mutual_follows, same_civilization
from apps.soul_accounts.services import current_account_of

logger = logging.getLogger(__name__)

#: 自由房间:谁都能发消息,谁都不能改房间(状态事件、邀请一律 100,只有服务账号有 100)。
FREE_EVENTS_DEFAULT = 0
#: 被节流的房间:发消息要 50 级,发起方 0 级 —— 于是它发不出。
THROTTLED_EVENTS_DEFAULT = 50
MEMBER_LEVEL = 50


class ChatError(Exception):
    """业务拒绝。与 `SoulAccountError` 同一形状:`code` 给 App 分支,`status` 给视图。"""

    def __init__(self, message, code, status=409):
        super().__init__(message)
        self.code = code
        self.status = status


def _power_levels(service_user, *, events_default, members):
    """`members` 是 {mxid: 级别}。状态事件与邀请一律 100:房间的形状只有服务账号能改。"""
    return {
        "users": {service_user: 100, **members},
        "users_default": 0,
        "events_default": events_default,
        "state_default": 100,
        "invite": 100,
        "kick": 100,
        "ban": 100,
        "redact": 100,
    }


def audit(action, conversation, description, *, actor=None, request=None):
    """一条审计行,`resource="chat_conversation"`。**签名里没有正文的位置** —— 这是故意的:
    调用点想塞也塞不进来,只能写进 description,而 description 由这个文件的调用点拼,
    没有一处用到 body(`test_the_audit_trail_never_contains_a_message_body` 断言不在场)。

    租户是会话的租户(收件殿司 / 建房时的文明),不是灵魂此刻的所在:审计要能按
    「这件事发生在哪个殿司」查到。
    """
    from apps.audit.models import AuditLog
    from apps.core.client_ip import get_client_ip

    AuditLog.objects.create(
        tenant_id=conversation.tenant_id,
        user=actor if getattr(actor, "is_authenticated", False) else None,
        action=action,
        resource="chat_conversation",
        resource_id=str(conversation.id),
        description=description[:500],
        ip_address=get_client_ip(request) if request is not None else None,
        user_agent=request.META.get("HTTP_USER_AGENT", "")[:500] if request is not None else "",
    )


# ── 身份 ─────────────────────────────────────────────────────────────────


def chat_session(account):
    """`GET /me/chat/session/` 的内容。首次调用顺手把 Matrix 用户建出来。"""
    client = get_client()
    identity = ensure_identity(account, client=client)
    return {
        "homeserver": settings.MATRIX_PUBLIC_BASEURL,
        "user_id": identity.matrix_user_id,
        "login_type": "org.matrix.login.jwt",
        "token": login_jwt(identity.localpart),
        "expires_in": settings.MATRIX_LOGIN_TOKEN_TTL_SECONDS,
    }


def deactivate_for_account(account):
    """转世停用。停用 Matrix 用户 = 同时离开它的所有房间(Synapse 的语义)。

    聊天没启用、或 Synapse 暂时不可达时**不阻断转世**:账号本身已经登不进来了
    (`SoulJWTAuthentication` 认 `retired_at`),Matrix 侧留一条日志等人工或下次调用。
    """
    from apps.chat.identity import deactivate_identity

    try:
        return deactivate_identity(account)
    except MatrixError as exc:
        logger.warning("chat: 停用 Matrix 用户失败 account=%s: %s", account.pk, exc)
        return None


# ── 私聊 ─────────────────────────────────────────────────────────────────


def _pair(soul_a, soul_b):
    """按 UUID 升序 —— 见 `Conversation` 的唯一约束。"""
    return (soul_a, soul_b) if str(soul_a.id) < str(soul_b.id) else (soul_b, soul_a)


def _identity_of(soul, *, client):
    account = current_account_of(soul)
    if account is None or account.retired_at is not None:
        raise ChatError("对方账号已停用。", "peer_retired", status=409)
    return ensure_identity(account, client=client)


def open_direct(account, target_soul, *, request=None):
    """取或建与 `target_soul` 的私聊房间,并说明它现在是不是被节流的。

    返回 `(conversation, created)`。跨文明直接 403;非互关建出来的房间带节流。
    """
    soul = account.soul
    if target_soul.pk == soul.pk:
        raise ChatError("不能和自己私聊。", "self_conversation", status=400)
    if not same_civilization(soul, target_soul):
        raise ChatError("跨文明的灵魂之间不能私聊。", "cross_civilization", status=403)

    low, high = _pair(soul, target_soul)
    existing = Conversation.objects.filter(
        kind=ConversationKind.DIRECT, soul_a=low, soul_b=high
    ).first()
    if existing is not None:
        return refresh_throttle(existing), False

    client = get_client()
    mine = ensure_identity(account, client=client)
    theirs = _identity_of(target_soul, client=client)
    mutual = are_mutual_follows(soul, target_soul)

    members = {mine.matrix_user_id: MEMBER_LEVEL, theirs.matrix_user_id: MEMBER_LEVEL}
    if not mutual:
        # 发起方 0 级:它在 Matrix 里发不出消息,只能走后端的 24 小时通道。
        members[mine.matrix_user_id] = 0
    room_id = client.create_room(
        name=f"{soul.name} · {target_soul.name}",
        power_levels=_power_levels(
            client.service_user,
            events_default=FREE_EVENTS_DEFAULT if mutual else THROTTLED_EVENTS_DEFAULT,
            members=members,
        ),
    )
    client.force_join(room_id, mine.matrix_user_id)
    client.force_join(room_id, theirs.matrix_user_id)

    try:
        with transaction.atomic():
            conversation = Conversation.objects.create(
                kind=ConversationKind.DIRECT, room_id=room_id, soul_a=low, soul_b=high,
                tenant=soul.tenant, initiator=None if mutual else soul, throttled=not mutual,
            )
    except IntegrityError:
        # 并发:另一个请求先建成了。刚建的房间没有人能找到它(不在目录里、无别名),
        # 留一条日志即可。
        # ponytail: 不清理孤儿房间;真出现频率不为零时再让服务账号 leave + forget。
        logger.warning("chat: 并发建房,丢弃 %s", room_id)
        return Conversation.objects.get(kind=ConversationKind.DIRECT, soul_a=low, soul_b=high), False

    audit("CREATE", conversation,
          f"开启私聊({'互关' if mutual else '私聊请求'}):{soul.name} → {target_soul.name}",
          actor=account.user, request=request)
    return conversation, True


def refresh_throttle(conversation, *, client=None):
    """被节流的会话:检查一下是不是该解除了,该则解除。

    两个解除条件(用户决定):**对方回过话**,或**两人已互关**。对方回话发生在 Matrix 里,
    后端不在那条路径上 —— 所以这里问 Synapse 一次,而且只在发起方要发言时问
    (`send_request_message`)或读会话时问,不轮询。
    """
    if not conversation.throttled or conversation.kind != ConversationKind.DIRECT:
        return conversation
    client = client or get_client()
    initiator_id = conversation.initiator_id
    initiator, other = (
        (conversation.soul_a, conversation.soul_b)
        if conversation.soul_a_id == initiator_id
        else (conversation.soul_b, conversation.soul_a)
    )
    reason = None

    if are_mutual_follows(initiator, other):
        reason = "mutual"
    else:
        peer = ChatIdentity.objects.filter(soul_id=other.pk, deactivated_at__isnull=True).first()
        if peer is not None and any(
            m["sender"] == peer.matrix_user_id for m in client.recent_messages(conversation.room_id)
        ):
            reason = "responded"

    if reason is None:
        return conversation

    mine = ChatIdentity.objects.filter(soul_id=initiator_id, deactivated_at__isnull=True).first()
    if mine is not None:
        client.set_power_level(conversation.room_id, mine.matrix_user_id, MEMBER_LEVEL)
    conversation.throttled = False
    if reason == "responded":
        conversation.responded_at = timezone.now()
    conversation.save(update_fields=["throttled", "responded_at"])
    return conversation


def send_request_message(account, conversation, body, *, request=None):
    """被节流的会话里发一条。**这是 24 小时规则的唯一执行点。**

    行锁 `select_for_update(of=("self",))` 罩住「读上次时间 → 发 → 写这次时间」整段:
    两个并发请求若只靠读后写,两条都会认为额度还在。
    ponytail: 锁内有一次到 Synapse 的 HTTP(同一台机器、带超时)。要是它变慢,
    再拆成「锁内先占额度、锁外发送、失败退回」。
    """
    with transaction.atomic():
        conversation = (
            Conversation.objects.select_for_update(of=("self",)).get(pk=conversation.pk)
        )
        client = get_client()
        conversation = refresh_throttle(conversation, client=client)
        if conversation.throttled:
            if conversation.initiator_id != account.soul_id:
                raise ChatError("这是对方发起的请求,你可以直接回复。", "not_initiator", status=409)
            interval = settings.CHAT_REQUEST_INTERVAL_SECONDS
            last = conversation.last_request_at
            if last is not None and (timezone.now() - last).total_seconds() < interval:
                raise _throttled(last + timedelta(seconds=interval))

        identity = _live_identity(account)
        event_id = client.send_message(conversation.room_id, body, as_localpart=identity.localpart)
        now = timezone.now()
        conversation.last_message_at = now
        fields = ["last_message_at"]
        if conversation.throttled:
            conversation.last_request_at = now
            fields.append("last_request_at")
        conversation.save(update_fields=fields)

    audit("EXECUTE", conversation, "发送私聊请求" if conversation.throttled else "代发私聊消息",
          actor=account.user, request=request)
    return event_id


def _live_identity(account):
    identity = ChatIdentity.objects.filter(account=account, deactivated_at__isnull=True).first()
    if identity is None:
        raise ChatError("聊天身份尚未建立,请先打开聊天。", "no_chat_identity", status=409)
    return identity


def _throttled(retry_at):
    error = ChatError("对方还没有回复,每 24 小时只能发一条私聊请求。", "request_throttled", status=429)
    error.retry_at = retry_at
    return error


# ── 官员收件箱 ───────────────────────────────────────────────────────────


def open_officer_inbox(account, *, request=None):
    """灵魂 → **当前所在**殿司。每个殿司一份,暂居时写给暂居地的殿司。

    官员一侧是服务账号:官员不进灵魂的 Matrix 世界(用户决定「官员不进灵魂之间的聊天」,
    而收件箱里官员的身份是「殿司」而不是某个人)。谁回的记在事件的
    `io.soulledger.officer` 字段与审计里。
    """
    soul = account.soul
    if soul.tenant_id is None:
        raise ChatError("灵魂当前不属于任何殿司。", "no_tenant", status=409)

    existing = Conversation.objects.filter(
        kind=ConversationKind.OFFICER_INBOX, soul_a=soul, tenant_id=soul.tenant_id
    ).first()
    if existing is not None:
        return existing, False

    client = get_client()
    identity = ensure_identity(account, client=client)
    room_id = client.create_room(
        name=f"{soul.tenant.display_name} · 殿司收件箱",
        power_levels=_power_levels(
            client.service_user, events_default=FREE_EVENTS_DEFAULT,
            members={identity.matrix_user_id: MEMBER_LEVEL},
        ),
    )
    client.force_join(room_id, identity.matrix_user_id)
    try:
        with transaction.atomic():
            conversation = Conversation.objects.create(
                kind=ConversationKind.OFFICER_INBOX, room_id=room_id, soul_a=soul,
                tenant_id=soul.tenant_id,
            )
    except IntegrityError:
        logger.warning("chat: 并发建收件箱,丢弃 %s", room_id)
        return Conversation.objects.get(
            kind=ConversationKind.OFFICER_INBOX, soul_a=soul, tenant_id=soul.tenant_id
        ), False

    audit("CREATE", conversation, f"开启殿司收件箱:{soul.tenant.display_name}",
          actor=account.user, request=request)
    return conversation, True


def officer_messages(conversation, *, limit=50):
    """会话正文。**不落我们的库** —— 每次从 Synapse 读。

    `sender` 换成可读的名字:服务账号 = 殿司(带回复人),灵魂 = 姓名。
    """
    client = get_client()
    names = {
        identity.matrix_user_id: identity.soul.name
        for identity in ChatIdentity.objects.filter(
            soul__in=[s for s in (conversation.soul_a, conversation.soul_b) if s is not None]
        ).select_related("soul")
    }
    rows = []
    for message in client.recent_messages(conversation.room_id, limit=limit):
        from_officer = message["sender"] == client.service_user
        if from_officer:
            sender_name = message["officer"] or "殿司"
        else:
            sender_name = names.get(message["sender"], "")
        rows.append({
            "event_id": message["event_id"],
            "from_officer": from_officer,
            "sender_name": sender_name,
            "body": message["body"],
            "timestamp": message["timestamp"],
        })
    return rows


def officer_reply(conversation, officer, body, *, request=None):
    """官员回复。以服务账号发出,`io.soulledger.officer` 带上是谁回的。"""
    if conversation.kind != ConversationKind.OFFICER_INBOX:
        raise ChatError("只有殿司收件箱可以由官员回复。", "not_inbox", status=409)
    client = get_client()
    event_id = client.send_message(
        conversation.room_id, body,
        as_localpart=settings.MATRIX_SERVICE_LOCALPART,
        extra={"io.soulledger.officer": officer.get_full_name() or officer.username},
    )
    conversation.last_message_at = timezone.now()
    conversation.save(update_fields=["last_message_at"])
    audit("EXECUTE", conversation, f"殿司回复:{conversation.soul_a.name}",
          actor=officer, request=request)
    return event_id


def send_inbox_message(account, conversation, body, *, request=None):
    """灵魂在收件箱里发一条。没有 24 小时限制 —— 那条规则只管灵魂之间的私聊请求。"""
    identity = _live_identity(account)
    client = get_client()
    event_id = client.send_message(conversation.room_id, body, as_localpart=identity.localpart)
    conversation.last_message_at = timezone.now()
    conversation.save(update_fields=["last_message_at"])
    audit("EXECUTE", conversation, f"致殿司:{conversation.tenant.display_name}",
          actor=account.user, request=request)
    return event_id
