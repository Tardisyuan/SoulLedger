"""案卷附件:校验、存盘、删除规则、访问判定、签名地址(2026-10-15,Design 第二十八批 W4)。

**与朋友圈图片、书信图片同一条路**:同一个 `private/` 前缀(nginx 与 DEBUG 路由都不公开)、同一种签名短时
地址、同一个文件出口写法(`apps/social/media_views.serve_private_file`)、图片同一个重编码函数
(`apps/social/images.reencode`:魔数 + Pillow 解码 + 去 EXIF/GPS)。客户端说的文件名、Content-Type 一概不信:
只看文件头的魔数,PDF 认 `%PDF-`,图片认 PNG / JPEG。

**HEIC 收,存成 JPG**(2026-10-15):`pillow-heif` 在 `SocialConfig.ready` 注册,`images.reencode` 负责转换。
PDF 页数不取:压缩对象流里的页数无法廉价而可靠地数出,宁可不显示也不显示错的。

**「结案」= `verdict` 非空或 `is_final`**(与 `claims.py` 判「已办结」同一条,`services.py` 结案时同时写下两者)。
**结案后上传、删除都不行**(2026-10-15 负责人定):上传在锁住案子行之后与上限同一处检查,403 `concluded`;
删除另外只许上传人。
"""
import uuid

from django.core import signing
from django.db import transaction
from django.db.models.signals import post_delete
from django.dispatch import receiver
from django.utils import timezone

from apps.judgment.models import CaseAttachment, Judgment
from apps.social import images as social_images

MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_TOTAL_BYTES = 100 * 1024 * 1024
MAX_COUNT = 30
#: 签名地址的有效期(秒)。
URL_TTL = 10 * 60
SIGNING_SALT = "judgment.case_attachment"
READ_PERMISSION = "judgment.read"
#: 图片长边上限:卷宗扫描要看清字,不像朋友圈那样缩到 2048。像素总数仍受 `images.MAX_PIXELS` 约束。
MAX_EDGE = 10000

PDF_CONTENT_TYPE = "application/pdf"


class AttachmentError(Exception):
    """`code` 给前端分支用:bad_type / too_large / case_full / too_many / concluded / not_uploader。"""

    def __init__(self, message, code, status):
        super().__init__(message)
        self.code = code
        self.status = status


def is_concluded(judgment):
    return judgment.verdict is not None or judgment.is_final


def live(judgment):
    return CaseAttachment.all_objects.filter(judgment=judgment, deleted_at__isnull=True)


def usage(judgment):
    """`(个数, 合计字节)`,不含已删。"""
    rows = list(live(judgment).values_list("byte_size", flat=True))
    return len(rows), sum(rows)


# ── 上传 ─────────────────────────────────────────────────────────────────


def _bad_type():
    return AttachmentError("Only images or PDF.", "bad_type", 400)


def _check_room(judgment, size):
    count, total = usage(judgment)
    if count >= MAX_COUNT:
        raise AttachmentError(f"At most {MAX_COUNT} attachments per case.", "too_many", 409)
    if total + size > MAX_TOTAL_BYTES:
        raise AttachmentError("This case already has 100 MB of attachments.", "case_full", 409)


def _prepare(uploaded_file):
    """魔数认类型 → `(ContentFile 或原文件, content_type, 扩展名)`。图片重编码,PDF 原样存。"""
    uploaded_file.seek(0)
    head = uploaded_file.read(12)
    uploaded_file.seek(0)
    if head.startswith(b"%PDF-"):
        return uploaded_file, PDF_CONTENT_TYPE, "pdf"
    if social_images.sniff_format(head) not in ("PNG", "JPEG", "HEIF"):  # WebP、GIF……不收
        raise _bad_type()
    try:
        image = social_images.reencode(uploaded_file, max_edge=MAX_EDGE, max_bytes=MAX_FILE_BYTES)
    except social_images.ImageRejectedError as exc:
        raise (_bad_type() if exc.code == "not_an_image" else
               AttachmentError(str(exc), "too_large", 400)) from None
    return image.file, image.content_type, image.extension


def _with_extension(name, ext):
    """存下来的格式定后缀:HEIC 转成 JPG 后,显示名不再写 `.heic`(2026-10-27 模拟器上看到 `IMG_0111.heic`)。
    原名没有后缀或后缀已对(`.jpeg` 也算 JPG)时不动。"""
    stem, dot, old = name.rpartition(".")
    if not dot or not stem:
        return name
    same = {"jpg": {"jpg", "jpeg"}}.get(ext, {ext})
    return name if old.lower() in same else f"{stem}.{ext}"


def upload(user, judgment, uploaded_file):
    """校验、存盘、建行。拒绝时抛 `AttachmentError`。已在调用方的租户划界与权限闸门之后。"""
    if uploaded_file.size > MAX_FILE_BYTES:
        raise AttachmentError("Each file must be at most 20 MB.", "too_large", 400)
    name = (uploaded_file.name or "").replace("\\", "/").rsplit("/", 1)[-1].strip()[:255] or "attachment"
    with transaction.atomic():
        # 锁案子行:两个并发上传不能同时通过「已满」检查。
        locked = Judgment.all_objects.select_for_update().get(pk=judgment.pk)
        if is_concluded(locked):
            raise AttachmentError("The case is concluded; attachments can no longer be added.", "concluded", 403)
        _check_room(locked, uploaded_file.size)
        content, content_type, ext = _prepare(uploaded_file)
        size = content.size
        if size > MAX_FILE_BYTES:
            raise AttachmentError("Each file must be at most 20 MB.", "too_large", 400)
        _check_room(locked, size)  # 重编码后的大小才是存下来的大小
        name = _with_extension(name, ext)
        row = CaseAttachment(
            judgment=locked, tenant_id=locked.tenant_id, uploader=user, name=name,
            byte_size=size, content_type=content_type,
        )
        row.file.save(f"{uuid.uuid4().hex}.{ext}", content, save=False)
        try:
            row.save()
        except Exception:
            row.file.storage.delete(row.file.name)
            raise
    return row


# ── 删除 ─────────────────────────────────────────────────────────────────


def ensure_can_delete(user, attachment):
    """设计稿 W4 的答复:上传人、结案前;结案后谁都不行 —— 殿主、管理员也不行。"""
    if is_concluded(attachment.judgment):
        raise AttachmentError("The case is concluded; attachments can no longer be deleted.", "concluded", 403)
    if attachment.uploader_id != user.pk:
        raise AttachmentError("Only the uploader can delete an attachment.", "not_uploader", 403)


def delete(user, attachment):
    """标记已删并删文件(提交后)。行留着:审计对账、打印清单不含已删。"""
    with transaction.atomic():
        locked_judgment = Judgment.all_objects.select_for_update().get(pk=attachment.judgment_id)
        attachment.judgment = locked_judgment  # 结案判定读锁后的值:与结案事务串行
        ensure_can_delete(user, attachment)
        attachment.deleted_at = timezone.now()
        attachment.save(update_fields=["deleted_at"])
        name, storage = attachment.file.name, attachment.file.storage
        transaction.on_commit(lambda: storage.delete(name))


@receiver(post_delete, sender=CaseAttachment)
def _remove_file(sender, instance, **kwargs):
    """行真被删(案子被级联删除)时文件跟着删;提交之后再删。"""
    name = instance.file.name
    if name and instance.deleted_at is None:
        storage = instance.file.storage
        transaction.on_commit(lambda: storage.delete(name))


# ── 访问判定与签名地址 ────────────────────────────────────────────────────


def may_view(user, attachment, tenant_id=None):
    """`user` 此刻能不能取到这份文件:没删、不是灵魂、持 `judgment.read`、案子在签发地址那次请求的租户里且在他的数据范围内。
    签发地址与文件出口用的是同一个判定。"""
    if user is None or not user.is_authenticated or not user.is_active or attachment.deleted_at is not None:
        return False
    from apps.perm.checker import check_permission
    from apps.social.media import as_request
    from apps.social.soul_circle import SOUL_ROLE

    if getattr(user, "role", None) == SOUL_ROLE:
        return False
    req = as_request(user, tenant_id)
    if req is None or not check_permission(user, READ_PERMISSION):
        return False
    from apps.core.tenant import scope_to_tenant
    from apps.perm.filters import DataScopeFilter

    # 附件跟它所属案子的数据范围走(用户 2026-10-27):看不到案子,就看不到它的附件。
    judgments = scope_to_tenant(Judgment.all_objects.filter(pk=attachment.judgment_id), req)
    return DataScopeFilter.filter_queryset(req, judgments, Judgment).exists()


def signed_url(attachment, viewer, tenant=None):
    value = f"{attachment.pk}.{viewer.pk}" + (f".{tenant.pk}" if tenant is not None else "")
    token = signing.TimestampSigner(salt=SIGNING_SALT).sign(value)
    return f"/api/v1/case-attachments/{attachment.pk}/?t={token}"


def viewer_from_token(token, attachment_id):
    """验签,返回 `(查看者 user_id, 租户 id 或 None)`;坏了、过期了、签的不是这份 → None。"""
    try:
        value = signing.TimestampSigner(salt=SIGNING_SALT).unsign(token or "", max_age=URL_TTL)
    except signing.BadSignature:  # SignatureExpired 是它的子类
        return None
    signed_id, _, rest = value.partition(".")
    user_id, _, tenant_id = rest.partition(".")
    if signed_id != str(attachment_id) or not user_id.isdigit() or (tenant_id and not tenant_id.isdigit()):
        return None
    return int(user_id), (int(tenant_id) if tenant_id else None)
