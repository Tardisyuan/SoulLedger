"""「导出我的资料」(Design 第二十八批 S3):申请、排队生成、取文件、过期清理。模型见 `SoulDataExport`。

**流程**

    POST /me/export/ (密码或面容凭据)  → `request_export`:账号行锁下查「有没有在准备的」,建一行 QUEUED,
        提交后入队 `soul_accounts.build_data_export`(celery;入队失败不丢 —— 行停在 QUEUED,
        `prune_expired` 每天顺手把停了 10 分钟以上的重新入队)
    build_data_export → `build`:认领(QUEUED→RUNNING)→ 写 zip 进私有存储 → READY + 7 天有效期 → 记一条推送
    GET /me/export/ → 状态;GET /me/export/file/?t=… → 文件(`export_views.py`)

**包里有什么 / 没有什么** 是这个文件的核心,每一节都从「这个账号自己」出发,不接受任何 id:

    有   profile.json            基本资料与编号(`MeProfileSerializer`,与 App「我」同一份)
         life.json / past_lives.json  功过记录、审判结果(灵魂 App 看得到的那几个字段,`MeLifeSerializer`)、处置、转生申请
         circle/…                本世账号发的帖子与评论,以及这些帖子里**自己上传的**图
         letters/…               本世账号参与的每个会话的全部消息(殿司收件箱 + 私聊),以及**自己发出的**图
         sign_ins.json           最近 90 天的登录记录(与 App「登录设备与记录」同一份)
    没有 官员之间的评议(`JudgmentComment`)、审判备注 `Judgment.notes`、证据采纳理由、审核/举报的处理记录
         (`moderation_*`)、收件箱里官员的草稿与经办人(`InboxOfficerState` / `Conversation.assignee`)、
         别人的书信(别的会话一条也不读)、别人在会话里发的图(只在消息里留引用)。
    缺口 书信正文在 Synapse,历史由 `SynapseClient.history` 分页读出;聊天没配置(`MATRIX_ENABLED` 关着)时
         会话只列元数据,`manifest.json` 里写 `letters.available=false`。Synapse 配了却读不到:整份导出记失败,
         灵魂可以重新申请 —— 不交一份缺了书信却说「已准备好」的包。

文件放 `private/exports/<id>.zip`(nginx 与 DEBUG 路由都不公开 `private/`),只经 `export_views` 的
签名 + 灵魂令牌出去。7 天后 `prune_expired` 删文件、行标 EXPIRED。
"""
import json
import logging
import tempfile
import zipfile
from datetime import timedelta

from django.core import signing
from django.core.files import File
from django.core.files.storage import default_storage
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.utils.encoders import JSONEncoder

from apps.soul_accounts.models import EXPORT_IN_PROGRESS, DataExportStatus, SoulAccount, SoulDataExport
from apps.soul_accounts.services import SoulAccountError, audit

logger = logging.getLogger(__name__)

#: 文件可取多久(Design:7 天)。签名链接与库里的 `expires_at` 同一个数。
LINK_TTL = timedelta(days=7)
STORAGE_DIR = "private/exports"
SIGNING_SALT = "soul_accounts.data_export"
#: 停在 QUEUED 这么久还没被认领,说明入队丢了:`prune_expired` 重新入队。
REQUEUE_AFTER = timedelta(minutes=10)
#: 停在 RUNNING 这么久,说明 worker 死了:标 FAILED,让灵魂能重新申请。
STUCK_AFTER = timedelta(hours=2)
#: 书信历史最多翻这么多页(每页 100 条)—— 防止一个坏房间让任务永远翻下去。
MAX_HISTORY_PAGES = 500


# ── 申请 ─────────────────────────────────────────────────────────────────


def latest(account):
    return SoulDataExport.objects.filter(account=account).order_by("-requested_at").first()


def effective_status(export, now=None):
    """READY 过了有效期就读作 EXPIRED(定时任务晚到一会儿也不让 App 看到一个已失效的下载按钮)。"""
    now = now or timezone.now()
    if export.status == DataExportStatus.READY and export.expires_at is not None and export.expires_at <= now:
        return DataExportStatus.EXPIRED
    return export.status


def request_export(account, *, request=None):
    """建一份排队中的导出。已有一份在准备 → 409 `export_in_progress`。调用方已核对过身份(密码 / 面容)。"""
    try:
        with transaction.atomic():
            SoulAccount.objects.select_for_update().get(pk=account.pk)
            if SoulDataExport.objects.filter(account=account, status__in=EXPORT_IN_PROGRESS).exists():
                raise SoulAccountError("已经有一份资料在准备了。", "export_in_progress")
            export = SoulDataExport.objects.create(account=account, soul=account.soul)
            audit("CREATE", account.soul, "申请导出个人资料", actor=account.user, request=request,
                  resource="soul_data_export", resource_id=export.pk)
            transaction.on_commit(lambda: enqueue(export.pk))
    except IntegrityError:  # 并发时部分唯一约束挡住的那一个
        raise SoulAccountError("已经有一份资料在准备了。", "export_in_progress") from None
    return export


def enqueue(export_id):
    """尽力入队。失败不丢:行停在 QUEUED,`prune_expired` 会重新入队。"""
    from apps.soul_accounts.tasks import build_data_export

    try:
        build_data_export.delay(str(export_id))
    except Exception:  # noqa: BLE001
        logger.exception("soul_accounts: 导出 %s 入队失败,留给每日清理重新入队", export_id)


# ── 生成 ─────────────────────────────────────────────────────────────────


def build(export_id):
    """认领并生成一份导出。同步可调(测试直接调它;celery 任务也只是调它)。幂等:不是 QUEUED 就什么都不做。"""
    with transaction.atomic():
        export = SoulDataExport.objects.select_for_update().filter(pk=export_id, status=DataExportStatus.QUEUED).first()
        if export is None:
            return None
        export.status = DataExportStatus.RUNNING
        export.save(update_fields=["status"])
    export = SoulDataExport.objects.select_related("account__user", "account__soul").get(pk=export_id)
    try:
        stored, size = _store_archive(export)
    except Exception as exc:  # noqa: BLE001 — 任何失败都要释放「一次一份」的名额
        logger.exception("soul_accounts: 导出 %s 生成失败", export_id)
        SoulDataExport.objects.filter(pk=export.pk).update(
            status=DataExportStatus.FAILED, finished_at=timezone.now(), error=type(exc).__name__[:200])
        return SoulDataExport.objects.get(pk=export.pk)
    now = timezone.now()
    with transaction.atomic():
        export.status, export.finished_at, export.expires_at = DataExportStatus.READY, now, now + LINK_TTL
        export.file_path, export.byte_size = stored, size
        export.file_name = f"soulledger-{export.soul.soul_code}-{now:%Y%m%d}.zip"
        export.save(update_fields=["status", "finished_at", "expires_at", "file_path", "byte_size", "file_name"])
        audit("EXECUTE", export.soul, "个人资料导出已生成", actor=export.account.user,
              resource="soul_data_export", resource_id=export.pk, changes={"bytes": size})
        _notify_ready(export)
    return export


def _notify_ready(export):
    """好了通知灵魂:走灵魂推送的记录路径(通知记录里留一行,没有设备也留)。提交后才入队。"""
    from apps.soul_push import services as push

    ids = push.record_export_ready(export.account, export)
    if ids:
        transaction.on_commit(lambda: push.enqueue(ids))


def _store_archive(export):
    with tempfile.SpooledTemporaryFile(max_size=32 * 1024 * 1024) as buffer:
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, payload in sections(export.account):
                archive.writestr(name, payload)
        size = buffer.tell()
        buffer.seek(0)
        stored = default_storage.save(f"{STORAGE_DIR}/{export.pk}.zip", File(buffer))
    return stored, size


def _json(data):
    return json.dumps(data, ensure_ascii=False, indent=2, cls=JSONEncoder).encode("utf-8")


def sections(account):
    """`(包内路径, 字节)` 的序列。**唯一决定包里有什么的地方** —— 每一节的范围都由 `account` 一个参数定。"""
    from apps.soul_accounts.me_views import build_lives
    from apps.soul_accounts.serializers import MeLifeSerializer, MeProfileSerializer
    from apps.soul_accounts.session_views import SignInRecordSerializer, sign_in_history

    context = {"account": account}
    yield "profile.json", _json(MeProfileSerializer(account.soul, context=context).data)
    yield "life.json", _json(MeLifeSerializer(build_lives(account, past=False)[0], context=context).data)
    if account.cycle:
        yield "past_lives.json", _json(MeLifeSerializer(build_lives(account, past=True), many=True,
                                                         context=context).data)
    yield "sign_ins.json", _json(SignInRecordSerializer(sign_in_history(account), many=True).data)
    yield from _circle(account)
    letters, available = _letters(account)
    yield from letters
    yield "manifest.json", _json({
        "generated_at": timezone.now(),
        "soul_code": account.soul.soul_code,
        "life": account.cycle,
        "letters": {"available": available},
        "not_included": ["officer_deliberation", "letters_not_addressed_to_you", "images_sent_by_others"],
    })


# ── 朋友圈 ───────────────────────────────────────────────────────────────


def _file_bytes(media):
    with media.file.open("rb") as handle:
        return handle.read()


def _extension(media):
    return {"image/png": "png", "image/webp": "webp"}.get(media.content_type, "jpg")


def _circle(account):
    from apps.social.models import Comment, Post

    posts = list(Post.objects.filter(author=account.user).order_by("create_time").prefetch_related("media"))
    rows, files = [], []
    for post in posts:
        media = []
        for item in post.media.all():
            path = f"circle/images/{item.pk}.{_extension(item)}"
            files.append((path, item))
            media.append({"id": str(item.pk), "file": path, "width": item.width, "height": item.height})
        rows.append({
            "id": str(post.pk), "content": post.content, "visibility": post.visibility,
            "created_at": post.create_time, "edited_at": post.edited_at,
            "comment_count": post.comment_count, "reaction_count": post.reaction_count, "images": media,
        })
    yield "circle/posts.json", _json(rows)
    comments = Comment.objects.filter(author=account.user).order_by("create_time")
    yield "circle/comments.json", _json([
        {"id": str(c.pk), "post_id": str(c.post_id), "parent_id": str(c.parent_id) if c.parent_id else None,
         "content": c.content, "created_at": c.create_time} for c in comments])
    for path, item in files:
        yield path, _file_bytes(item)


# ── 书信 ─────────────────────────────────────────────────────────────────


def _letters(account):
    """`([(路径, 字节)…], 书信正文是否读到了)`。聊天没配置 → 只列会话元数据;配了却读不到 → 抛出,整份失败。"""
    from apps.chat.matrix import MatrixNotConfiguredError, get_client
    from apps.chat.models import Conversation

    conversations = list(Conversation.objects.filter(Q(account_a=account) | Q(account_b=account))
                         .select_related("tenant", "account_a__user", "account_a__soul",
                                         "account_b__user", "account_b__soul").order_by("created_at"))
    try:
        client = get_client()
    except MatrixNotConfiguredError:
        client = None
    out = []
    for index, conversation in enumerate(conversations, start=1):
        messages, images = _thread(account, conversation, client)
        stem = f"letters/{index:03d}-{conversation.kind.lower()}"
        out.append((f"{stem}.json", _json(_conversation_row(account, conversation, messages))))
        out.extend(images)
    return out, client is not None


def _conversation_row(account, conversation, messages):
    from apps.chat.identity import display_name
    from apps.chat.models import ConversationKind

    inbox = conversation.kind == ConversationKind.OFFICER_INBOX
    peer = conversation.other_account(account.pk)
    return {
        "kind": conversation.kind,
        "with": conversation.tenant.hall_names.get("zh-Hans", "") if inbox else (display_name(peer) if peer else ""),
        "started_at": conversation.created_at, "closed_at": conversation.closed_at,
        "messages": messages,
    }


def _thread(account, conversation, client):
    """这个会话里的消息(旧的在前)与自己发出的图。会话是 `account` 参与的 —— 调用方已按账号筛过。"""
    from apps.chat.identity import display_name
    from apps.chat.models import ChatIdentity, ChatImage

    if client is None:
        return [], []
    me = ChatIdentity.objects.filter(account=account).values_list("matrix_user_id", flat=True).first()
    peer = conversation.other_account(account.pk)
    own = {str(i.pk): i for i in ChatImage.objects.filter(conversation=conversation, uploader=account,
                                                         sent_at__isnull=False)}
    rows, files = [], []
    for message in client.history(conversation.room_id, max_pages=MAX_HISTORY_PAGES):
        mine = message["sender"] == me
        hall = message["sender"] == client.service_user
        row = {
            "at": message["timestamp"],
            "from": "me" if mine else ("hall" if hall else "them"),
            "sender": display_name(account) if mine else (
                (message.get("officer") or "殿司") if hall else (display_name(peer) if peer else "")),
            "body": message["body"],
        }
        reference = message.get("image")
        if reference:
            image = own.get(str(reference.get("id")))
            path = f"letters/images/{image.pk}.{_extension(image)}" if image is not None else None
            row["image"] = {"id": reference.get("id"), "file": path}
            if image is not None:
                files.append((path, _file_bytes(image)))
        rows.append(row)
    return rows, files


# ── 取文件 ───────────────────────────────────────────────────────────────


def signed_path(export):
    token = signing.TimestampSigner(salt=SIGNING_SALT).sign(f"{export.pk}.{export.account_id}")
    return f"/api/v1/me/export/file/?t={token}"


def export_from_token(token, account):
    """验签并取出**这个账号自己的**、仍可取的导出;其余(签名坏了、过期了、别人的、已过期的文件)一律 None。"""
    try:
        value = signing.TimestampSigner(salt=SIGNING_SALT).unsign(token or "", max_age=int(LINK_TTL.total_seconds()))
    except signing.BadSignature:
        return None
    export_id, _, account_id = value.partition(".")
    if account_id != str(account.pk):
        return None
    try:
        export = SoulDataExport.objects.filter(pk=export_id, account=account).first()
    except (ValueError, TypeError):  # 不是 UUID
        return None
    if export is None or effective_status(export) != DataExportStatus.READY or not export.file_path:
        return None
    return export


# ── 定时清理 ─────────────────────────────────────────────────────────────


def prune_expired(now=None):
    """过期的文件与行:删文件、标 EXPIRED(行留着,灵魂能看到「过期了,重新申请」)。同时扫两种卡住的:
    停在 QUEUED 的重新入队,停在 RUNNING 太久的标 FAILED。返回各自的条数。"""
    now = now or timezone.now()
    expired = list(SoulDataExport.objects.filter(status=DataExportStatus.READY, expires_at__lte=now))
    for export in expired:
        _remove_file(export.file_path)
    SoulDataExport.objects.filter(pk__in=[e.pk for e in expired]).update(status=DataExportStatus.EXPIRED, file_path="")
    stale = list(SoulDataExport.objects.filter(status=DataExportStatus.QUEUED,
                                               requested_at__lte=now - REQUEUE_AFTER).values_list("pk", flat=True))
    for pk in stale:
        enqueue(pk)
    stuck = SoulDataExport.objects.filter(status=DataExportStatus.RUNNING, requested_at__lte=now - STUCK_AFTER)
    failed = stuck.update(status=DataExportStatus.FAILED, finished_at=now, error="StuckWorker")
    return {"expired": len(expired), "requeued": len(stale), "failed": failed}


def _remove_file(name):
    if not name:
        return
    try:
        default_storage.delete(name)
    except Exception:  # noqa: BLE001 — 一个文件删不掉不能让同一批里其余的留下
        logger.exception("soul_accounts: 删除导出文件 %s 失败", name)

