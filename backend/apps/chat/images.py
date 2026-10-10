"""书信图片:上传、发出、访问判定、签名地址(2026-10-10)。

**为什么不走 Matrix 的媒体仓库(`m.image` + `mxc://`)。** Synapse 的媒体按「有没有这台服务器的
access token」放行,不按房间:任何一个灵魂拿到 mxc id 就能取到,而这里要的是「只有这次会话的
双方取得到」。官员又没有 Matrix 身份,收件箱里的官员读不了它。所以图片放在我们自己的存储里 ——
**与朋友圈帖子图片同一条路**:同一个校验与重编码函数(`apps/social/images.reencode`:魔数 +
Pillow 解码 + 去 EXIF/GPS + 5 MB / 4000 万像素上限)、同一个 `private/` 前缀(nginx 与 DEBUG 路由都不公开)、
同一种签名短时地址、同一个文件出口写法(`media_views.serve_private_file`)。

消息事件里只有引用:正文 `[图片]`(老客户端、别的 Matrix 客户端照常显示一行字,不会崩),
`io.soulledger.image` = `{id, width, height}`。**事件里写了什么不授予任何访问**:取图永远
按 `ChatImage.conversation` 重算「你是不是这个会话的参与方」(`may_view`),所以灵魂在 Matrix 里手写一个
别人的 id 进事件,取到的也是 404。

发送是两步:先传(`upload`,每张一个请求,App 逐张显示进度),再发(`send`,经后端代发那一条事件,
带 `txn_id` 幂等:同一张图重发回第一次的 event_id,不发第二条)。图片和文字是两条消息,一条消息一张图。
"""
import uuid
from datetime import timedelta

from django.core import signing
from django.db import transaction
from django.db.models.signals import post_delete
from django.dispatch import receiver
from django.utils import timezone

from apps.chat import services as svc
from apps.chat.models import ChatImage, Conversation, ConversationKind
from apps.social import images as social_images
from apps.social.soul_circle import SOUL_ROLE

#: 一次最多发几张,也是「传了还没发」的上限(App 的挑选上限同值)。
MAX_PER_SEND = 4
#: 长边超过就等比缩小。与朋友圈同一个数。
MAX_EDGE = 2048
#: 未发出的图在上传之后多久算废弃,由该账号的下一次上传顺手清掉。
STALE_AFTER = timedelta(hours=24)
#: 签名地址的有效期(秒)。过期后客户端重新问一次 `GET /me/chat/images/<id>/` 即得新地址。
URL_TTL = 60 * 60
SIGNING_SALT = "chat.image"
READ_PERMISSION = "soul_inbox.read"


# ── 上传 ─────────────────────────────────────────────────────────────────


def _speaker_check(account, conversation):
    """能在这个会话里发图的前提:会话是我的、此刻能说话、不在被节流的请求阶段。
    不是我的会话答 404(不说出它存在)。"""
    if not conversation.has_account(account.pk):
        raise svc.ChatError("会话不存在。", "not_found", status=404)
    error = svc.refusal(conversation, account, conversation.other_account(account.pk))
    if error is not None:
        raise error
    if conversation.throttled:
        raise svc.ChatError("对方回复之前只能发文字请求。", "images_unavailable", status=409)


def upload(account, conversation, uploaded_file):
    """校验、重编码、存盘,建一行未发出的 `ChatImage`。拒绝时抛 `ChatError`(400 带 not_an_image /
    too_large / too_many_pixels;409 `too_many_pending`)。"""
    _speaker_check(account, conversation)
    purge_stale(account)
    pending = ChatImage.objects.filter(conversation=conversation, uploader=account, sent_at__isnull=True)
    if pending.count() >= MAX_PER_SEND:
        raise svc.ChatError(f"未发出的图片最多 {MAX_PER_SEND} 张。", "too_many_pending", status=409)
    try:
        image = social_images.reencode(uploaded_file, max_edge=MAX_EDGE)
    except social_images.ImageRejectedError as exc:
        raise svc.ChatError(str(exc), exc.code, status=400) from None
    row = ChatImage(conversation=conversation, uploader=account, width=image.width, height=image.height,
                    byte_size=image.file.size, content_type=image.content_type)
    row.file.save(f"{uuid.uuid4().hex}.{image.extension}", image.file, save=False)
    try:
        row.save()
    except Exception:
        row.file.storage.delete(row.file.name)
        raise
    return row


def purge_stale(account):
    """这个账号 24 小时前传了却没发的图:行与文件真删(文件由 post_delete 在提交后删)。
    ponytail: 只在该账号下一次上传时清;账号不再回来就留着最多 4 张/会话。要准点清再加一个定时任务。"""
    ChatImage.objects.filter(uploader=account, sent_at__isnull=True,
                             created_at__lt=timezone.now() - STALE_AFTER).delete()


@receiver(post_delete, sender=ChatImage)
def _remove_file(sender, instance, **kwargs):
    name = instance.file.name
    if name:
        storage = instance.file.storage
        transaction.on_commit(lambda: storage.delete(name))


# ── 发出 ─────────────────────────────────────────────────────────────────


def send(account, conversation, image_id, *, request=None):
    """把上传好的图作为一条消息发进会话,返回 event_id。同一张图再发回第一次的 event_id。

    图片行锁罩住「发 → 标已发」整段:同一张图的两个并发请求被串行,第二个看到 `sent_at`。
    ponytail: 锁内有一次到 Synapse 的 HTTP(与 `send_direct_message` 的会话行锁同一取舍)。
    """
    with transaction.atomic():
        image = (ChatImage.objects.select_for_update()
                 .filter(pk=image_id, conversation=conversation, uploader=account).first())
        if image is None:
            raise svc.ChatError("图片不存在。", "image_not_found", status=404)
        if image.sent_at is not None:
            return image.event_id
        _speaker_check(account, conversation)
        if conversation.kind == ConversationKind.OFFICER_INBOX:
            return svc.send_inbox_message(account, conversation, svc.IMAGE_LABEL, request=request, image=image)
        return svc.send_direct_message(account, conversation, svc.IMAGE_LABEL, request=request, image=image)


# ── 访问判定与签名地址 ───────────────────────────────────────────────────


def may_view(user, image, tenant_id=None):
    """`user` 此刻能不能拿到这张图。灵魂端的地址签发与文件出口用的是同一个判定。

    * 灵魂:本世账号是会话参与方;对方发的图要已发出,自己上传的图发出前也看得见。
    * 官员:图已发出、会话是收件箱、持 `soul_inbox.read`,且会话在自己的租户里(`scope_to_tenant`,
      与收件箱视图同一个函数)。`tenant_id` 是签发地址那次请求的租户(见 social.media._as_request)。
    """
    if user is None or not user.is_authenticated or not user.is_active:
        return False
    conversation = image.conversation
    if getattr(user, "role", None) == SOUL_ROLE:
        from apps.soul_accounts.models import SoulAccount

        account = SoulAccount.objects.filter(user=user, retired_at__isnull=True).first()
        return (account is not None and conversation.has_account(account.pk)
                and (image.sent_at is not None or image.uploader_id == account.pk))
    if image.sent_at is None or conversation.kind != ConversationKind.OFFICER_INBOX:
        return False
    from apps.core.tenant import scope_to_tenant
    from apps.perm.checker import check_permission
    from apps.social.media import _as_request

    req = _as_request(user, tenant_id)
    return (req is not None and check_permission(user, READ_PERMISSION)
            and scope_to_tenant(Conversation.objects.filter(pk=conversation.pk), req).exists())


def signed_url(image, viewer, tenant=None):
    """发给 `viewer` 的取图地址(站点根相对路径)。签名只说明「发给谁」,谁能看每次取文件时重算。"""
    value = f"{image.pk}.{viewer.pk}" + (f".{tenant.pk}" if tenant is not None else "")
    token = signing.TimestampSigner(salt=SIGNING_SALT).sign(value)
    return f"/api/v1/chat-images/{image.pk}/?t={token}"


def viewer_from_token(token, image_id):
    """验签,返回 `(查看者 user_id, 租户 id 或 None)`;坏了、过期了、签的不是这张图 → None。"""
    try:
        value = signing.TimestampSigner(salt=SIGNING_SALT).unsign(token or "", max_age=URL_TTL)
    except signing.BadSignature:
        return None
    signed_image, _, rest = value.partition(".")
    user_id, _, tenant_id = rest.partition(".")
    if signed_image != str(image_id) or not user_id.isdigit() or (tenant_id and not tenant_id.isdigit()):
        return None
    return int(user_id), (int(tenant_id) if tenant_id else None)


def describe(image, viewer, tenant=None):
    return {"id": image.pk, "url": signed_url(image, viewer, tenant), "width": image.width, "height": image.height}


def soul_view(account, image_id):
    """`GET /me/chat/images/<id>/`:这一世账号能看的图的签名地址;看不了(没有、别人的会话、
    对方还没发出)答 None,调用方统一 404。"""
    image = ChatImage.objects.select_related("conversation").filter(pk=image_id).first()
    if image is None or not may_view(account.user, image):
        return None
    return describe(image, account.user)


def _reference(content):
    """事件里的引用 → 图片 id(UUID),不合格式 → None。"""
    ref = content if isinstance(content, dict) else {}
    try:
        return uuid.UUID(str(ref.get("id")))
    except ValueError:
        return None


def officer_views(conversation, officer, timeline, service_user, *, tenant=None):
    """收件箱时间线里灵魂来信的图 → `{event_id: {id, url, width, height}}`。一次查询。
    只认**这个会话里、已发出**的图;别的会话的 id、没有的 id、官员自己发的事件:没有这一项。"""
    wanted = {m["event_id"]: _reference(m.get("image")) for m in timeline if m["sender"] != service_user}
    ids = {i for i in wanted.values() if i is not None}
    if not ids:
        return {}
    rows = {r.pk: r for r in ChatImage.objects.filter(pk__in=ids, conversation=conversation,
                                                      sent_at__isnull=False)}
    return {event_id: describe(rows[i], officer, tenant) for event_id, i in wanted.items() if i in rows}
