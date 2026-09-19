"""聊天的全部写路径。规则在这里,**不在客户端**。

    1. 互相关注          → 自由私聊
    2. 非互关            → 私聊请求,每 24 小时一条;对方回过话或两人互关后解除
    3. 官员收件箱        → 灵魂 → **当前所在**殿司;官员在 Web 后台看与回
    4. 官员不进灵魂之间的聊天
    +  朋友圈禁言(apps/social 的 SocialMute)对灵魂之间的私聊同样生效

**私聊不看文明**(2026-09-19 用户改定:「所有灵魂理论上都该可以聊」,取代 2026-09-17 的
「跨文明灵魂之间不能私聊」;见 docs/ARCHITECTURE-soul-app-and-domain-split.md)。任意两个
本世灵魂账号都可以私聊,调拨、暂居、回归都不改变灵魂之间的发言权。**朋友圈不跟着改**:
它的搜索、主页、关注仍只到当前所在文明;这里只读它的关注边(不带它「同文明」的过滤)与禁言。
互关 = 两个本世账号之间双向都有关注边,边记在哪个文明不论。

**规则是服务端执行的,而「服务端」有两半:**

* *这个文件* 决定房间建不建、谁能进、每个人在每个房间里是几级;
* *Synapse* 让绕过这里变得不可能 —— `config/synapse/soulledger_policy.py` 拒绝服务账号
  以外的任何人建房、邀请、建别名、发布房间;房间里的发言权是 power level,状态事件一律
  100 级而只有服务账号有 100。

**发言权只有一个出处:`_speaking_levels`。** 一个灵魂在一个房间里能不能说话,由此刻的事实
算出来(对方还是本世账号?被禁言?是被节流的发起方?还在这个殿司?),再由 `sync_rooms` 写进 Synapse。
事实变化的地方都调它:禁言 / 解禁(signals)、调拨与回归(signals,只影响收件箱)、解除节流、打开聊天。
禁言到期没有事件,它在灵魂下一次打开聊天(`chat_session` / 会话列表)时生效。
ponytail: 到期靠懒同步;要准点解禁再加一个按 `until` 排的任务。

**节流的落点是 power level + 一次性凭据。** 被节流的房间里发起方是 0 级,它在 Matrix 里
发不出消息;唯一的出口是 `POST /me/chat/conversations/{id}/messages/`:会话行锁下
「临时提到 50 → 以**本人**身份发一条带凭据的消息 → 降回 0」。提权窗口里发起方自己直接发的
任何东西都被 Synapse 模块拒绝(房间带 `io.soulledger.throttle`,见 apps/chat/grant.py)。
解除节流 = 清掉那条状态事件、把它提回 50,从那以后消息不再经过后端。

**审计不含正文。** `audit()` 写的是「谁对哪个会话做了什么」,body 一个字都不传进去。
"""
import logging
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone

from apps.chat.grant import KEY as GRANT_KEY
from apps.chat.grant import sign as sign_grant
from apps.chat.identity import deactivate_identity, display_name, ensure_identity
from apps.chat.matrix import MatrixError, get_client, login_jwt
from apps.chat.models import ChatIdentity, Conversation, ConversationKind
from apps.social import soul_circle as circle
from apps.social.models import Follow

logger = logging.getLogger(__name__)

#: 所有房间:发消息要 50 级。能说话的成员 50,不能的 0;状态事件、邀请一律 100。
EVENTS_DEFAULT = 50
SPEAK = 50
SILENT = 0


class ChatError(Exception):
    """业务拒绝。与 `SoulAccountError` 同一形状:`code` 给 App 分支,`status` 给视图。"""

    def __init__(self, message, code, status=409):
        super().__init__(message)
        self.code = code
        self.status = status


def _power_levels(service_user, members):
    """`members` 是 {mxid: 级别}。`events: {}` 不能省:`private_chat` 预设自带的 `events`
    表让 50 级成员能改房间名、头像、置顶(2026-09-18 对真 Synapse 实测改名 200),
    覆盖成空表之后所有状态事件都落到 `state_default` 100。"""
    return {
        "users": {service_user: 100, **members},
        "users_default": 0,
        "events": {},
        "events_default": EVENTS_DEFAULT,
        "state_default": 100,
        "invite": 100,
        "kick": 100,
        "ban": 100,
        "redact": 100,
    }


def audit(action, conversation, description, *, actor=None, request=None):
    """一条审计行,`resource="chat_conversation"`。**签名里没有正文的位置** —— 这是故意的:
    description 由这个文件的调用点拼,没有一处用到 body
    (`test_the_audit_trail_never_contains_a_message_body` 断言不在场)。

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


# ── 谁和谁 ───────────────────────────────────────────────────────────────


def _mutual(account, peer_account):
    """互关:两个不同的本世账号,双向都有关注边(不论边记在哪个文明)。"""
    a, b = account.user_id, peer_account.user_id
    if a == b or not (circle.is_current_soul(account.user) and circle.is_current_soul(peer_account.user)):
        return False
    edges = Follow.objects.filter(
        Q(follower_id=a, following_id=b) | Q(follower_id=b, following_id=a)
    ).values_list("follower_id", flat=True)
    return set(edges) == {a, b}


def _reachable(account):
    """可以向其发起私聊的灵魂账号(User 查询集):任何一个本世灵魂账号,除了自己。
    官员、前世账号不在里面。"""
    from apps.authentication.models import User

    return User.objects.filter(
        role=circle.SOUL_ROLE, soul_account__retired_at__isnull=True, is_active=True,
    ).exclude(pk=account.user_id)


def find_by_soul_code(account, soul_code):
    """跨文明私聊的发起入口:按**完整**灵魂编号找一个可私聊的灵魂(2026-09-19 用户定)。
    朋友圈搜索只到当前所在文明,这里是找别的文明的人的唯一办法。

    精确匹配,规范化与登录同一条(`normalize_soul_code`);不做前缀、不做模糊 —— 编号是
    登录名。候选集就是 `_reachable`(与 `open_direct` 同一个),所以不存在、官员、前世账号、
    自己**答同一个 404,同一句话**:响应里不留「这个编号存在但……」的区分。
    """
    from apps.soul_accounts.services import normalize_soul_code

    target = _reachable(account).filter(
        soul_account__soul__soul_code=normalize_soul_code(soul_code)
    ).select_related("soul_account").first()
    if target is None:
        raise ChatError("找不到这个灵魂。", "not_found", status=404)
    return target


# ── 发言权 ───────────────────────────────────────────────────────────────


def _live_identities(conversation):
    """{soul_id: (会话那一世的账号, 未停用的 ChatIdentity)}。

    账号取**会话记下的那一世**(`account_a` / `account_b`),不取灵魂此刻的本世账号:新一世的
    账号永远不会被算进前世的房间。那一世已转世停用的(ChatIdentity 已停用)不在里面。"""
    rows = {}
    for soul_id, account in ((conversation.soul_a_id, conversation.account_a),
                             (conversation.soul_b_id, conversation.account_b)):
        if soul_id is None or account is None:
            continue
        identity = ChatIdentity.objects.filter(account=account, deactivated_at__isnull=True).first()
        if identity is not None:
            rows[soul_id] = (account, identity)
    return rows


def refusal(conversation, account, peer_account=None):
    """`account` 此刻不能在这个会话里说话的理由(`ChatError`),能说则 None。"""
    if conversation.closed_at is not None:
        return ChatError("会话已关闭。", "closed", status=409)
    if conversation.kind == ConversationKind.OFFICER_INBOX:
        if account.soul.tenant_id != conversation.tenant_id:
            return ChatError("你已不在这个殿司,只能给当前所在的殿司写信。", "not_current_hall", status=403)
        return None
    if peer_account is None or not circle.is_current_soul(peer_account.user):
        return ChatError("对方账号已停用。", "peer_retired", status=409)
    if circle.active_mute(account.user) is not None:
        return ChatError("你已被禁言,期间不能私聊。", "muted", status=403)
    return None


def _speaking_levels(conversation, identities):
    """{mxid: 级别}。每个成员此刻该是几级 —— 发言权的唯一出处。"""
    levels = {}
    for soul_id, (account, identity) in identities.items():
        peer = next((acc for sid, (acc, _) in identities.items() if sid != soul_id), None)
        if peer is None and conversation.kind == ConversationKind.DIRECT:
            peer = conversation.other_account(account.pk)
        blocked = refusal(conversation, account, peer) is not None
        throttled = conversation.throttled and conversation.initiator_id == soul_id
        levels[identity.matrix_user_id] = SILENT if blocked or throttled else SPEAK
    return levels


def sync_levels(conversation, *, client=None):
    identities = _live_identities(conversation)
    if identities:
        (client or get_client()).set_user_levels(conversation.room_id, _speaking_levels(conversation, identities))


def sync_rooms(soul, *, client=None):
    """把 `soul` 所在的每个未关闭房间的发言权重算一遍并写进 Synapse(没变的不写)。

    **已关闭但还欠一次降权的也在里面**(`silenced_at` 为空):关闭时那一次写失败了
    (Synapse 不可达),下一次任何一方的同步 —— 留下的一方打开聊天、被禁言、被调拨 —— 补上。"""
    rows = Conversation.objects.filter(
        Q(soul_a=soul) | Q(soul_b=soul), Q(closed_at__isnull=True) | Q(silenced_at__isnull=True)
    )
    rows = list(rows.select_related(*ACCOUNT_JOINS))
    if not rows:
        return
    client = client or get_client()
    for conversation in rows:
        sync_levels(conversation, client=client)
        if conversation.closed_at is not None:
            _mark_silenced(conversation)


def _mark_silenced(conversation):
    conversation.silenced_at = timezone.now()
    Conversation.objects.filter(pk=conversation.pk, silenced_at__isnull=True).update(
        silenced_at=conversation.silenced_at)


#: 算发言权要读的关联:双方灵魂、双方那一世的账号与其 User(`is_current_soul` 看 User)。
ACCOUNT_JOINS = ("soul_a", "soul_b", "account_a__user", "account_b__user")


def sync_rooms_quietly(soul):
    """signals 用:聊天没启用、Synapse 不可达都只记日志,不阻断触发它的那件事(禁言、调拨)。"""
    try:
        sync_rooms(soul)
    except MatrixError as exc:
        logger.warning("chat: 同步发言权失败 soul=%s: %s", soul.pk, exc)


# ── 身份 ─────────────────────────────────────────────────────────────────


def chat_session(account):
    """`GET /me/chat/session/` 的内容。首次调用顺手把 Matrix 用户建出来;每次都把发言权对一遍
    (禁言到期在这里生效)。"""
    client = get_client()
    identity = ensure_identity(account, client=client)
    sync_rooms(account.soul, client=client)
    return {
        "homeserver": settings.MATRIX_PUBLIC_BASEURL,
        "user_id": identity.matrix_user_id,
        "login_type": "org.matrix.login.jwt",
        "token": login_jwt(identity.localpart),
        "expires_in": settings.MATRIX_LOGIN_TOKEN_TTL_SECONDS,
    }


def deactivate_for_account(account):
    """转世停用:先关会话(库里,一定成功),再停 Matrix 用户(= 离开它的所有房间,Synapse 语义)。

    聊天没启用、或 Synapse 暂时不可达时**不阻断转世**:账号本身已经登不进来了
    (`SoulJWTAuthentication` 认 `retired_at`),Matrix 侧留一条日志等人工或下次调用。
    """
    closing = Conversation.objects.filter(
        Q(account_a=account) | Q(account_b=account), closed_at__isnull=True
    )
    ids = list(closing.values_list("pk", flat=True))
    closing.update(closed_at=timezone.now())
    try:
        identity = deactivate_identity(account)
    except MatrixError as exc:
        logger.warning("chat: 停用 Matrix 用户失败 account=%s: %s", account.pk, exc)
        identity = None
    silence_closed(ids)
    return identity


def silence_closed(conversation_ids):
    """关闭的会话:把房间里还在的一方降到 0(`refusal` 对关闭的会话答 `closed`,所以
    `_speaking_levels` 给每个人都是 SILENT)。写成功才记 `silenced_at`;失败只记日志,
    留给 `sync_rooms` 下次补 —— 这一步不能拖住转世。"""
    rows = Conversation.objects.filter(pk__in=conversation_ids, closed_at__isnull=False,
                                       silenced_at__isnull=True).select_related(*ACCOUNT_JOINS)
    for conversation in rows:
        try:
            sync_levels(conversation)
        except MatrixError as exc:
            logger.warning("chat: 关闭后降权失败 room=%s: %s(下次同步补)", conversation.room_id, exc)
            continue
        _mark_silenced(conversation)


# ── 私聊 ─────────────────────────────────────────────────────────────────


def _pair(soul_a, soul_b):
    """按 UUID 升序 —— 见 `Conversation` 的唯一约束。"""
    return (soul_a, soul_b) if str(soul_a.id) < str(soul_b.id) else (soul_b, soul_a)


def open_direct(account, target_user, *, request=None):
    """取或建与 `target_user`(朋友圈 user_id)的私聊房间。

    返回 `(conversation, created)`。对方必须是本世灵魂账号(`_reachable`),不论在哪个文明;
    官员、前世账号与不存在答同一个 404。非互关建出来的房间带节流。
    """
    soul = account.soul
    if target_user.pk == account.user_id:
        raise ChatError("不能和自己私聊。", "self_conversation", status=400)
    if not _reachable(account).filter(pk=target_user.pk).exists():
        raise ChatError("找不到这个灵魂。", "not_found", status=404)
    target_account = target_user.soul_account
    target_soul = target_account.soul
    if circle.active_mute(account.user) is not None:
        raise ChatError("你已被禁言,期间不能私聊。", "muted", status=403)

    low, high = _pair(soul, target_soul)
    account_of = {soul.pk: account, target_soul.pk: target_account}
    existing = Conversation.objects.filter(
        kind=ConversationKind.DIRECT, soul_a=low, soul_b=high, closed_at__isnull=True
    ).select_related(*ACCOUNT_JOINS).first()
    if existing is not None:
        return refresh_throttle(existing), False

    client = get_client()
    mine = ensure_identity(account, client=client)
    theirs = ensure_identity(target_account, client=client)
    mutual = _mutual(account, target_account)

    room_id = client.create_room(
        name=f"{display_name(account)} · {display_name(target_account)}",
        power_levels=_power_levels(client.service_user, {
            # 非互关:发起方 0 级 —— 它在 Matrix 里发不出消息,只能走后端的 24 小时通道。
            mine.matrix_user_id: SPEAK if mutual else SILENT,
            theirs.matrix_user_id: SPEAK,
        }),
    )
    if not mutual:
        client.set_room_throttle(room_id, mine.matrix_user_id)
    client.force_join(room_id, mine.matrix_user_id)
    client.force_join(room_id, theirs.matrix_user_id)

    try:
        with transaction.atomic():
            conversation = Conversation.objects.create(
                kind=ConversationKind.DIRECT, room_id=room_id, soul_a=low, soul_b=high,
                account_a=account_of[low.pk], account_b=account_of[high.pk],
                tenant=soul.tenant, initiator=None if mutual else soul, throttled=not mutual,
            )
    except IntegrityError:
        # 并发:另一个请求先建成了。刚建的房间没有人能找到它(不在目录里、无别名)。
        # ponytail: 不清理孤儿房间;真出现频率不为零时再让服务账号 leave + forget。
        logger.warning("chat: 并发建房,丢弃 %s", room_id)
        return Conversation.objects.get(
            kind=ConversationKind.DIRECT, soul_a=low, soul_b=high, closed_at__isnull=True
        ), False

    audit("CREATE", conversation, f"开启私聊({'互关' if mutual else '私聊请求'})",
          actor=account.user, request=request)
    return conversation, True


def refresh_throttle(conversation, *, client=None):
    """被节流的会话:该解除就解除。两个解除条件(用户决定):**对方回过话**,或**两人已互关**。

    对方回话发生在 Matrix 里,后端不在那条路径上 —— 所以这里问 Synapse 一次,只在发起方要
    发言或打开会话时问,不轮询。
    """
    if not conversation.throttled or conversation.kind != ConversationKind.DIRECT:
        return conversation
    client = client or get_client()
    identities = _live_identities(conversation)
    initiator = identities.get(conversation.initiator_id)
    other = next((row for sid, row in identities.items() if sid != conversation.initiator_id), None)
    if initiator is None or other is None:
        return conversation

    reason = None
    if _mutual(initiator[0], other[0]):
        reason = "mutual"
    elif any(m["sender"] == other[1].matrix_user_id for m in client.recent_messages(conversation.room_id)):
        reason = "responded"
    if reason is None:
        return conversation

    conversation.throttled = False
    if reason == "responded":
        conversation.responded_at = timezone.now()
    conversation.save(update_fields=["throttled", "responded_at"])
    client.set_room_throttle(conversation.room_id, None)
    client.set_user_levels(conversation.room_id, _speaking_levels(conversation, identities))
    return conversation


def send_direct_message(account, conversation, body, *, request=None):
    """私聊经后端发一条。被节流时**这是 24 小时规则的唯一执行点**。

    行锁 `select_for_update(of=("self",))` 罩住「读上次时间 → 发 → 写这次时间」整段:
    两个并发请求若只靠读后写,两条都会认为额度还在。
    ponytail: 锁内有一次到 Synapse 的 HTTP(同一台机器、带超时)。要是它变慢,
    再拆成「锁内先占额度、锁外发送、失败退回」。
    """
    with transaction.atomic():
        conversation = (
            Conversation.objects.select_for_update(of=("self",))
            .select_related(*ACCOUNT_JOINS).get(pk=conversation.pk)
        )
        error = refusal(conversation, account, conversation.other_account(account.pk))
        if error is not None:
            raise error
        client = get_client()
        conversation = refresh_throttle(conversation, client=client)
        identity = _live_identity(account)
        if conversation.throttled:
            if conversation.initiator_id != account.soul_id:
                raise ChatError("这是对方发起的请求,你可以直接回复。", "not_initiator", status=409)
            interval = settings.CHAT_REQUEST_INTERVAL_SECONDS
            last = conversation.last_request_at
            if last is not None and (timezone.now() - last).total_seconds() < interval:
                raise _throttled(last + timedelta(seconds=interval))
            event_id = _send_request(client, conversation, identity, body)
        else:
            event_id = client.send_message(conversation.room_id, body, as_localpart=identity.localpart)
        now = timezone.now()
        conversation.last_message_at = now
        fields = ["last_message_at"]
        if conversation.throttled:
            conversation.last_request_at = now
            fields.append("last_request_at")
        conversation.save(update_fields=fields)

    audit("EXECUTE", conversation, "发送私聊请求" if conversation.throttled else "经后端发送私聊消息",
          actor=account.user, request=request)
    return event_id


def _send_request(client, conversation, identity, body):
    """临时提权、本人发、降回 0 —— 在调用方持有的会话行锁里。

    * 同一会话的两次后端请求被行锁串行,不会一个在另一个的窗口里再发;
    * 发起方在窗口里自己直接发的,被 Synapse 模块按凭据拒绝(一次性、绑房间与发送者、30 秒);
    * 降权放在 `finally`,发送失败也降;降权本身失败(Synapse 那一刻不可达)只记日志 ——
      那时发起方停在 50 级,但模块仍然只放行带凭据的消息,而凭据只有这里签得出;下一次
      `sync_rooms`(取会话、禁言、调拨时)按 `_speaking_levels` 把它写回 0。
    """
    mxid = identity.matrix_user_id
    grant = sign_grant(settings.MATRIX_JWT_SECRET, conversation.room_id, mxid)
    client.set_user_levels(conversation.room_id, {mxid: SPEAK})
    try:
        return client.send_message(conversation.room_id, body, as_localpart=identity.localpart,
                                   extra={GRANT_KEY: grant})
    finally:
        try:
            client.set_user_levels(conversation.room_id, {mxid: SILENT})
        except MatrixError as exc:
            logger.error("chat: 私聊请求发完降权失败 room=%s: %s(模块仍挡住无凭据消息)",
                         conversation.room_id, exc)


def _live_identity(account):
    identity = ChatIdentity.objects.filter(account=account, deactivated_at__isnull=True).first()
    if identity is None:
        raise ChatError("聊天身份尚未建立,请先打开聊天。", "no_chat_identity", status=409)
    return identity


def _throttled(retry_at):
    error = ChatError("对方还没有回复,每 24 小时只能发一条私聊请求。", "request_throttled", status=429)
    error.retry_at = retry_at
    return error


# ── 新书信推送 ───────────────────────────────────────────────────────────


def notify_new_message(room_id, event_id, sender):
    """Synapse 模块回调进来的一条新消息(已验签,`views.ChatPushHookView`)→ 给收件方记一条推送。

    收件方由会话定,不由回调说:
    * 私聊:发送者必须是会话双方之一(那一世的 Matrix 身份),收件方是另一方**那一世**的账号;
    * 殿司收件箱:只推服务账号发的(官员回信),收件方是写信的灵魂;灵魂写给殿司的不推(官员不用 App)。
    已关闭的会话(含收件方已转世的)、发送者对不上号:一律不推。
    返回新建的投递 id(测试断言用)。
    """
    conversation = (Conversation.objects.filter(room_id=room_id, closed_at__isnull=True)
                    .select_related(*ACCOUNT_JOINS).first())
    if conversation is None:
        return []
    # 「只推本世账号」由上一行的 `closed_at` 兑现:转世停用账号时先关它参与的每个会话
    # (`deactivate_for_account`),所以未关闭会话里的账号都是本世的。
    recipient = _recipient(conversation, sender)
    if recipient is None:
        return []
    from apps.soul_push import services as push

    ids = push.record_chat_message(recipient, conversation, event_id)
    if ids:
        transaction.on_commit(lambda: push.enqueue(ids))
    return ids


def _recipient(conversation, sender):
    if conversation.kind == ConversationKind.OFFICER_INBOX:
        service_user = f"@{settings.MATRIX_SERVICE_LOCALPART}:{settings.MATRIX_SERVER_NAME}"
        return conversation.account_a if sender == service_user else None
    accounts = [a for a in (conversation.account_a_id, conversation.account_b_id) if a is not None]
    sender_account = ChatIdentity.objects.filter(
        account_id__in=accounts, matrix_user_id=sender
    ).values_list("account_id", flat=True).first()
    return conversation.other_account(sender_account) if sender_account is not None else None


# ── 官员收件箱 ───────────────────────────────────────────────────────────


def open_officer_inbox(account, *, request=None):
    """灵魂 → **当前所在**殿司。每个殿司一份,暂居时写给暂居地的殿司。

    官员一侧是服务账号:官员不进灵魂的 Matrix 世界,收件箱里官员的身份是「殿司」而不是
    某个人。谁回的记在事件的 `io.soulledger.officer` 字段与审计里。
    """
    soul = account.soul
    if soul.tenant_id is None:
        raise ChatError("灵魂当前不属于任何殿司。", "no_tenant", status=409)

    existing = Conversation.objects.filter(
        kind=ConversationKind.OFFICER_INBOX, soul_a=soul, tenant_id=soul.tenant_id, closed_at__isnull=True
    ).first()
    if existing is not None:
        return existing, False

    client = get_client()
    identity = ensure_identity(account, client=client)
    room_id = client.create_room(
        name=f"{soul.tenant.display_name} · 殿司收件箱",
        power_levels=_power_levels(client.service_user, {identity.matrix_user_id: SPEAK}),
    )
    client.force_join(room_id, identity.matrix_user_id)
    try:
        with transaction.atomic():
            conversation = Conversation.objects.create(
                kind=ConversationKind.OFFICER_INBOX, room_id=room_id, soul_a=soul, account_a=account,
                tenant_id=soul.tenant_id,
            )
    except IntegrityError:
        logger.warning("chat: 并发建收件箱,丢弃 %s", room_id)
        return Conversation.objects.get(
            kind=ConversationKind.OFFICER_INBOX, soul_a=soul, tenant_id=soul.tenant_id, closed_at__isnull=True
        ), False

    audit("CREATE", conversation, f"开启殿司收件箱:{soul.tenant.display_name}",
          actor=account.user, request=request)
    return conversation, True


def send_inbox_message(account, conversation, body, *, request=None):
    """灵魂在收件箱里发一条。没有 24 小时限制,也不受朋友圈禁言约束(待拍板:见报告)——
    禁言的是灵魂之间的发言,给殿司写信(申诉、求助)不在其列。只能写给**当前所在**的殿司。"""
    error = refusal(conversation, account)
    if error is not None:
        raise error
    identity = _live_identity(account)
    client = get_client()
    event_id = client.send_message(conversation.room_id, body, as_localpart=identity.localpart)
    conversation.last_message_at = timezone.now()
    conversation.save(update_fields=["last_message_at"])
    audit("EXECUTE", conversation, f"致殿司:{conversation.tenant.display_name}",
          actor=account.user, request=request)
    return event_id


def officer_messages(conversation, officer, *, request=None, limit=50):
    """会话正文。**不落我们的库** —— 每次从 Synapse 读。官员读信本身记一条审计(不含正文)。

    `sender` 换成可读的名字:服务账号 = 殿司(带回复人),灵魂 = 朋友圈显示名。
    """
    client = get_client()
    names = {
        identity.matrix_user_id: display_name(identity.account)
        for identity in ChatIdentity.objects.filter(soul=conversation.soul_a).select_related(
            "account__user", "account__soul"
        )
    }
    rows = []
    for message in client.recent_messages(conversation.room_id, limit=limit):
        from_officer = message["sender"] == client.service_user
        rows.append({
            "event_id": message["event_id"],
            "from_officer": from_officer,
            "sender_name": (message["officer"] or "殿司") if from_officer else names.get(message["sender"], ""),
            "body": message["body"],
            "timestamp": message["timestamp"],
        })
    audit("READ", conversation, "查看殿司收件箱", actor=officer, request=request)
    return rows


def officer_reply(conversation, officer, body, *, request=None):
    """官员回复。以服务账号发出,`io.soulledger.officer` 带上是谁回的。"""
    if conversation.kind != ConversationKind.OFFICER_INBOX:
        raise ChatError("只有殿司收件箱可以由官员回复。", "not_inbox", status=409)
    if conversation.closed_at is not None:
        raise ChatError("会话已关闭(对方已转世)。", "closed", status=409)
    client = get_client()
    event_id = client.send_message(
        conversation.room_id, body,
        as_localpart=settings.MATRIX_SERVICE_LOCALPART,
        extra={"io.soulledger.officer": officer.get_full_name() or officer.username},
    )
    conversation.last_message_at = timezone.now()
    conversation.save(update_fields=["last_message_at"])
    audit("EXECUTE", conversation, "殿司回复", actor=officer, request=request)
    return event_id
