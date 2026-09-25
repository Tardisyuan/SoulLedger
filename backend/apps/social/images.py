"""上传图片的唯一一道检查与重编码 —— 头像与朋友圈帖子图片共用。

**客户端说的一概不信**:扩展名、Content-Type、文件名都不看。先看文件头的魔数
(`sniff_format`),只认 PNG / JPEG / WebP;再交给 Pillow **只用那一个格式的解码器**
完整解码。存下来的是解码后像素的重编码 —— 应用方向、去掉 EXIF(含 GPS)、
ICC 与文本块 —— 不是客户端送来的字节。

头像(`serializers.AvatarUploadSerializer`)在 2026-09-14 定下这套规则;帖子图片
(`media.py`,2026-09-25)沿用同一个函数,只换边长上限。
"""
import io
from dataclasses import dataclass

from django.core.files.base import ContentFile
from PIL import Image, ImageOps, UnidentifiedImageError

#: 与头像同一个上限。
MAX_BYTES = 5 * 1024 * 1024
# 在解码任何像素之前按文件头判:100 KB 的 PNG 可以声称 50,000 x 50,000,加载时要几个 GB。
MAX_PIXELS = 40_000_000
#: Pillow 格式名 -> 存盘扩展名。
FORMATS = {"PNG": "png", "JPEG": "jpg", "WEBP": "webp"}
CONTENT_TYPES = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}


class ImageRejectedError(ValueError):
    """`code` 给 App 分支用:not_an_image / too_large / too_many_pixels。"""

    def __init__(self, message, code):
        super().__init__(message)
        self.code = code


def sniff_format(head: bytes):
    """按魔数认格式;不认得返回 None。只看前 12 字节。"""
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "PNG"
    if head.startswith(b"\xff\xd8\xff"):
        return "JPEG"
    if len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "WEBP"
    return None


@dataclass
class Reencoded:
    file: ContentFile
    format: str
    width: int
    height: int

    @property
    def content_type(self):
        return CONTENT_TYPES[self.format]

    @property
    def extension(self):
        return FORMATS[self.format]


def reencode(upload, *, max_edge, max_bytes=MAX_BYTES) -> Reencoded:
    """校验并重编码一个上传文件。拒绝时抛 `ImageRejectedError`。

    `max_edge`:长边超过它就按比例缩小(头像 512,帖子图片见 media.MAX_EDGE)。
    返回的 `ContentFile` 没有名字 —— 存盘名由调用方随机生成。
    """
    if upload.size > max_bytes:
        raise ImageRejectedError(f"Image must be at most {max_bytes // (1024 * 1024)} MB.", "too_large")
    not_an_image = ImageRejectedError("Upload a PNG, JPEG or WebP image.", "not_an_image")
    upload.seek(0)
    sniffed = sniff_format(upload.read(12))
    if sniffed is None:
        raise not_an_image
    upload.seek(0)
    try:
        # 只让魔数认出的那一个格式的解码器碰这份字节:GIF、TIFF 之类的解析器根本不运行。
        with Image.open(upload, formats=[sniffed]) as img:
            if img.width * img.height > MAX_PIXELS:
                raise ImageRejectedError("Image dimensions are too large.", "too_many_pixels")
            img.load()  # 完整解码:截断或损坏的内容在这里失败
            out = ImageOps.exif_transpose(img)
            out.thumbnail((max_edge, max_edge))
            if sniffed == "JPEG" and out.mode not in ("RGB", "L"):
                out = out.convert("RGB")
            out.info = {}  # 存盘前丢掉 exif / icc_profile / text
            buf = io.BytesIO()
            out.save(buf, sniffed)
            width, height = out.size
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, SyntaxError, ValueError) as exc:
        if isinstance(exc, ImageRejectedError):
            raise
        raise not_an_image from None
    return Reencoded(ContentFile(buf.getvalue()), sniffed, width, height)
