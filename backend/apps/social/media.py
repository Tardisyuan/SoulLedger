"""朋友圈帖子图片:上传、挂到帖子、访问判定、签名地址、删除(2026-09-25)。

**存储与头像同一条路**:Django 默认存储(FileSystemStorage,`MEDIA_ROOT`,compose 里是
`media_files` 卷,备份一并打包),同一个校验与重编码函数(`images.reencode`,魔数 +
Pillow 解码 + 去 EXIF)。**服务不同**:头像经 nginx 公开的 `/media/` 出去,谁都能拿;
帖子图片可能属于 PRIVATE / FOLLOWERS / 被隐藏的帖子,所以存在 `private/` 前缀下
(nginx 与 DEBUG 路由都不公开它),只经 `GET /api/v1/social-media/<id>/?t=<签名>` 出去。

**为什么是签名地址而不是带令牌的请求。** 网页端 `<img src>` 带不上 `Authorization`
头,App 的图片组件也不走 axios 的拦截器。所以序列化器给每个查看者签一个短时地址:
签名里是 (图片 id, 查看者 user_id),`URL_TTL` 秒后过期。**签名只说明「这个地址是发给谁的」,
不说明「谁能看」**:每一次取文件都用签名里的查看者重算一遍 `may_view` —— 帖子在签发之后
被隐藏、被删、查看者取关了作者,旧地址立刻 404。
"""
import uuid
from datetime import timedelta

from django.core import signing
from django.core.files.storage import default_storage
from django.db import transaction
from django.db.models.signals import post_delete
from django.dispatch import receiver
from django.utils import timezone

from apps.social import images
from apps.social.models import DELETED_BY_OFFICER, PRIVATE_MEDIA_PREFIX, PostMedia
from apps.social.soul_circle import SOUL_ROLE, SocialError, ensure_can_write, visible_posts_for_soul

#: 每条帖子最多几张。
MAX_PER_POST = 9
#: 长边超过就等比缩小。手机屏幕全屏看一张图用不到更大的。
MAX_EDGE = 2048
#: 一个人同时最多有几张「传了还没发」的图 —— 两条满帖。防止只传不发把磁盘塞满。
MAX_PENDING = 2 * MAX_PER_POST
#: 未挂到帖子的图片,上传多久之后算孤儿(清理命令的默认值)。
ORPHAN_AFTER = timedelta(hours=24)
#: 签名地址的有效期(秒)。过期后客户端重新拉一次列表即得新地址。
URL_TTL = 60 * 60
SIGNING_SALT = "social.post_media"
MODERATE = "social.moderate"


def _not_found():
    return SocialError("对象不存在。", "not_found", 404)


# ── 上传与挂载 ────────────────────────────────────────────────────────────


def upload(user, uploaded_file):
    """校验、重编码、存盘,建一行 `post=None` 的 PostMedia。返回它。"""
    ensure_can_write(user)
    if PostMedia.objects.filter(uploader=user, post__isnull=True).count() >= MAX_PENDING:
        raise SocialError(
            f"未发出的图片最多 {MAX_PENDING} 张,先发帖或移除一些。", "too_many_pending", 409,
        )
    try:
        image = images.reencode(uploaded_file, max_edge=MAX_EDGE)
    except images.ImageRejectedError as exc:
        raise SocialError(str(exc), exc.code, 400) from None
    media = PostMedia(
        uploader=user, width=image.width, height=image.height,
        byte_size=image.file.size, content_type=image.content_type,
    )
    media.file.save(f"{uuid.uuid4().hex}.{image.extension}", image.file, save=False)
    try:
        media.save()
    except Exception:
        media.file.storage.delete(media.file.name)
        raise
    return media


def attach(post, user, media_ids):
    """把上传者自己的、尚未挂载的图片按 `media_ids` 的顺序挂到 `post` 上。

    在 `create_post` 的事务里调用。任何一个 id 不是「本人上传、还没挂载、没被删」的
    → 整条帖子不建(400 `media_not_found`),不给「这个 id 属于别人」留探测口。
    """
    media_ids = list(media_ids or [])
    if not media_ids:
        return []
    if len(media_ids) > MAX_PER_POST:
        raise SocialError(f"每条帖子最多 {MAX_PER_POST} 张图片。", "too_many_media", 400)
    if len(set(media_ids)) != len(media_ids):
        raise SocialError("同一张图片不能出现两次。", "duplicate_media", 400)
    rows = {
        row.pk: row
        for row in PostMedia.objects.select_for_update().filter(
            pk__in=media_ids, uploader=user, post__isnull=True
        )
    }
    if len(rows) != len(media_ids):
        raise SocialError("图片不存在或已被使用。", "media_not_found", 400)
    for position, pk in enumerate(media_ids):
        PostMedia.objects.filter(pk=pk).update(post=post, position=position)
    return [rows[pk] for pk in media_ids]


def delete_pending(user, media_id):
    """上传者移除一张还没发出去的图:行与文件真删。"""
    row = PostMedia.objects.filter(pk=media_id, uploader=user, post__isnull=True).first()
    if row is None:
        raise _not_found()
    # 查询集的 delete 是真 DELETE(软删除只覆盖了实例的 delete);文件由 post_delete 收走。
    PostMedia.all_objects.filter(pk=row.pk).delete()


def purge_for_post(post):
    """作者自己删帖:这条帖子的图片行与文件都真删(不进回收站,也没有恢复路径)。"""
    PostMedia.all_objects.filter(post=post).delete()


def orphans(older_than=ORPHAN_AFTER):
    """上传超过 `older_than` 仍未挂到帖子的图片。"""
    return PostMedia.all_objects.filter(post__isnull=True, created_at__lt=timezone.now() - older_than)


MEDIA_DIR = f"{PRIVATE_MEDIA_PREFIX}post_media"


def _walk(storage, path):
    if not storage.exists(path):
        return
    dirs, files = storage.listdir(path)
    for name in files:
        yield f"{path}/{name}"
    for name in dirs:
        yield from _walk(storage, f"{path}/{name}")


def _stray_files(before):
    """`private/post_media/` 下没有任何行指向、且早于 `before` 的文件(存盘成功、建行失败的残留)。"""
    known = set(PostMedia.all_objects.values_list("file", flat=True))
    return [
        name for name in _walk(default_storage, MEDIA_DIR)
        if name not in known and default_storage.get_modified_time(name) < before
    ]


def cleanup_orphans(older_than=ORPHAN_AFTER, *, dry_run=False) -> dict:
    """删孤儿图片(行与文件)与无主文件。`manage.py cleanup_orphan_post_media` 与定时任务
    `social.cleanup_orphan_post_media` 共用这一个函数。幂等:第二次运行什么也不删。"""
    rows = orphans(older_than)
    count = rows.count()
    if not dry_run:
        rows.delete()  # 真 DELETE;文件由 PostMedia 的 post_delete 在提交后删
    stray = _stray_files(timezone.now() - older_than)
    if not dry_run:
        for name in stray:
            default_storage.delete(name)
    return {"orphans": count, "stray_files": len(stray), "dry_run": dry_run}


# ── 访问判定与签名地址 ────────────────────────────────────────────────────


def may_view(user, media):
    """`user` 此刻能不能拿到这张图的文件。列表序列化与文件服务用的是同一个判定。

    * 还没挂到帖子:只有上传者本人。
    * 灵魂:图片没被删,且帖子在 `visible_posts_for_soul(user)` 里 —— 与动态流同一条规则,
      所以被隐藏 / 待审的帖子只有作者本人看得见它的图,PRIVATE、FOLLOWERS 各按其档。
    * 官员:持 `social.moderate`,帖子在自己的文明(ADMIN 不限)且作者是灵魂。
      被官员删除、躺在回收站里的帖子,图也看得见(回收站里要能判断恢复不恢复);
      作者自己删掉的帖子没有图可看 —— 行已经没了。
    """
    if user is None or not user.is_authenticated or not user.is_active:
        return False
    if media.post_id is None:
        return not media.is_deleted and media.uploader_id == user.pk
    if getattr(user, "role", None) == SOUL_ROLE:
        return not media.is_deleted and visible_posts_for_soul(user).filter(pk=media.post_id).exists()
    return _officer_may_view(user, media)


def _officer_may_view(user, media):
    """租户经帖子(`post__tenant`),由 `scope_to_tenant` 判 —— 与审核后台每个视图同一个函数。
    取文件的请求不带令牌,所以「请求所在的租户」就是签名里那个官员自己的租户。"""
    from types import SimpleNamespace

    from apps.core.tenant import scope_to_tenant
    from apps.perm.checker import check_permission
    from apps.social.models import Post

    if not check_permission(user, MODERATE):
        return False
    as_request = SimpleNamespace(user=user, tenant=getattr(user, "tenant", None), method="GET")
    scoped = scope_to_tenant(
        PostMedia.all_objects.filter(pk=media.pk, post__author__role=SOUL_ROLE), as_request, field="post__tenant",
    )
    if not scoped.exists():
        return False
    if media.is_deleted:
        # 只在回收站里的帖子(被官员删除)上看得见已删除的图。
        return Post.all_objects.filter(DELETED_BY_OFFICER, pk=media.post_id, is_deleted=True).exists()
    return True


def signed_url(media, viewer):
    """发给 `viewer` 的取图地址(站点根相对路径)。客户端把它接在 API 的源上。"""
    token = signing.TimestampSigner(salt=SIGNING_SALT).sign(f"{media.pk}.{viewer.pk}")
    return f"/api/v1/social-media/{media.pk}/?t={token}"


def viewer_from_token(token, media_id):
    """验签并取出查看者 user_id。签名坏了、过期了、签的不是这张图 → None。"""
    try:
        value = signing.TimestampSigner(salt=SIGNING_SALT).unsign(token or "", max_age=URL_TTL)
    except signing.BadSignature:  # SignatureExpired 是它的子类
        return None
    signed_media, _, user_id = value.partition(".")
    if signed_media != str(media_id) or not user_id.isdigit():
        return None
    return int(user_id)


def describe(rows, viewer):
    """序列化用:按顺序的 `{id, url, width, height}`。`rows` 已经是这条帖子未删除的图。"""
    return [
        {"id": row.pk, "url": signed_url(row, viewer), "width": row.width, "height": row.height}
        for row in rows
    ]


# ── 文件跟着行走 ──────────────────────────────────────────────────────────


@receiver(post_delete, sender=PostMedia)
def _remove_file(sender, instance, **kwargs):
    """行真被删掉时(作者删帖、清理孤儿、回收站彻底删除帖子时的级联),文件跟着删。

    提交之后再删:事务回滚时行还在,文件也得在。软删除不走这里 —— 那是 UPDATE。
    """
    name = instance.file.name
    if not name:
        return
    storage = instance.file.storage
    transaction.on_commit(lambda: storage.delete(name))
