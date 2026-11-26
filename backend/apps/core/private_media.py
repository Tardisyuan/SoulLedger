"""私有文件的出口:签名检查通过之后发文件(朋友圈图片、书信图片、案卷附件、灵魂数据导出共用)。

`settings.POST_MEDIA_X_ACCEL` 打开时(生产,前面是 nginx)回空响应带
`X-Accel-Redirect: /protected-media/<private/ 之下的相对路径>`,nginx 的 internal location
(nginx.conf)把它映射到 `MEDIA_ROOT/private/` 发出去 —— daphne 不再占着连接流文件。
关着时(DEBUG、没有 nginx 的 staging)照旧 `FileResponse`。

2026-11-26 从 `apps/social/media_views.py` 搬来:核心域(案卷附件)不该为此 import 朋友圈(ADR 0004)。
"""
import posixpath
import re

from django.conf import settings
from django.http import FileResponse, Http404, HttpResponse

#: 私有文件(帖子图片、书信图片、案卷附件、导出)存在 MEDIA_ROOT 之下、这个前缀之内。**这个前缀不公开服务**:
#: nginx 对 `/media/private/` 答 404,DEBUG 下 config/urls.py 同样挡住 —— 文件只经各自带签名、每次重查
#: 可见性的接口出去(帖子图片:`GET /api/v1/social-media/<id>/`,见 apps/social/media.py)。
PRIVATE_MEDIA_PREFIX = "private/"
#: nginx.conf 里那个 `internal` location 的前缀;它 alias 到 MEDIA_ROOT/private/。
ACCEL_PREFIX = "/protected-media/"
_SAFE_NAME = re.compile(r"[A-Za-z0-9_\-./]+")


def accel_path(name):
    """存储名(`private/post_media/…`)→ `X-Accel-Redirect` 的值。

    存储名由 `_post_media_path` 生成(随机文件名),不含客户端输入,所以这里本不会遇到越界的名字;
    但这是把路径交给 nginx 的最后一道,仍然断言:只收 `private/` 之下、字符安全、规范化后不变的名字,
    其余一律 404(不回头、不猜)。"""
    if (not _SAFE_NAME.fullmatch(name) or not name.startswith(PRIVATE_MEDIA_PREFIX)
            or posixpath.normpath(name) != name or ".." in name.split("/")):
        raise Http404
    return ACCEL_PREFIX + name[len(PRIVATE_MEDIA_PREFIX):]


def serve_private_file(media, ttl):
    """检查通过之后发文件(`media.file`、`media.content_type`)。朋友圈图片与书信图片共用。

    私有缓存,且不超过签名的有效期:可见性收回之后,共享缓存里不能还留着一份。"""
    if settings.POST_MEDIA_X_ACCEL:
        response = HttpResponse(content_type=media.content_type)
        response["X-Accel-Redirect"] = accel_path(media.file.name)
    else:
        response = FileResponse(media.file.open("rb"), content_type=media.content_type)
    response["Cache-Control"] = f"private, max-age={ttl}"
    response["X-Content-Type-Options"] = "nosniff"
    return response
