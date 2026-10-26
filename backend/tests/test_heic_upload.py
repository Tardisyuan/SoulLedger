"""HEIC / HEIF 上传(2026-10-15):服务端转成 JPEG。

四条上传路径(头像、朋友圈图片、书信图片、案卷附件)共用 `apps/social/images.reencode`,所以转换本身在这里测一次;
再各挑两个入口(案卷附件、朋友圈图片)走完整请求。
"""
import io

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

from apps.judgment.models import CaseAttachment, Judgment
from apps.social import images
from tests.soul_account_support import dead_soul, officer_client
from tests.soul_social_support import SOCIAL, soul

pytestmark = pytest.mark.django_db

FAKE_HEIC = b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic"


def heic_bytes(size=(64, 48), orientation=None, gps=False):
    """真 HEIC:左半红、右半蓝,可带 EXIF 方向与 GPS。"""
    img = Image.new("RGB", size, (200, 0, 0))
    img.paste((0, 0, 200), (size[0] // 2, 0, size[0], size[1]))
    exif = Image.Exif()
    if orientation:
        exif[0x0112] = orientation
    if gps:
        exif[0x010F] = "CameraMaker"
        exif[0x8825] = {2: (1.0, 2.0, 3.0)}
    buf = io.BytesIO()
    img.save(buf, "HEIF", **({"exif": exif.tobytes()} if (orientation or gps) else {}))
    return buf.getvalue()


def as_upload(raw, name="IMG_0001.HEIC", ctype="image/heic"):
    return SimpleUploadedFile(name, raw, content_type=ctype)


def test_heic_becomes_jpeg_with_orientation_applied_and_metadata_gone():
    raw = heic_bytes(orientation=6, gps=True)
    assert b"CameraMaker" in raw, "前提:上传的 HEIC 带 EXIF"
    out = images.reencode(as_upload(raw), max_edge=2048)
    assert (out.format, out.content_type, out.extension) == ("JPEG", "image/jpeg", "jpg")
    data = out.file.read()
    assert data.startswith(b"\xff\xd8\xff") and b"CameraMaker" not in data
    with Image.open(io.BytesIO(data)) as img:
        assert img.format == "JPEG" and not img.getexif() and "icc_profile" not in img.info
        assert img.size == (48, 64) == (out.width, out.height)  # 方向 6:64x48 转正成 48x64


def test_the_name_and_declared_type_are_not_what_decides():
    out = images.reencode(as_upload(heic_bytes(), name="x.png", ctype="image/png"), max_edge=2048)
    assert out.format == "JPEG"


@pytest.mark.parametrize("tail", [b"\x00" * 200, b""])
def test_an_undecodable_heic_is_refused(tail):
    with pytest.raises(images.ImageRejectedError) as exc:
        images.reencode(as_upload(FAKE_HEIC + tail), max_edge=2048)
    assert exc.value.code == "not_an_image"


def test_a_truncated_heic_is_refused():
    raw = heic_bytes(size=(256, 256))
    with pytest.raises(images.ImageRejectedError):
        images.reencode(as_upload(raw[: len(raw) // 2]), max_edge=2048)


def test_the_size_limit_is_checked_on_the_uploaded_bytes():
    with pytest.raises(images.ImageRejectedError) as exc:
        images.reencode(as_upload(heic_bytes()), max_edge=2048, max_bytes=100)
    assert exc.value.code == "too_large"


def test_case_attachment_stores_a_jpg(cn_tenant, judge_user, settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path
    s = dead_soul(cn_tenant, name="附件灵魂")
    case = Judgment.objects.create(soul=s, civilization=s.civilization, court="第一殿", tenant=cn_tenant)
    url = f"/api/v1/judgment/{case.pk}/attachments/"
    client = officer_client(judge_user)
    res = client.post(url, {"file": as_upload(heic_bytes())}, format="multipart")
    assert res.status_code == 201, res.data
    # 显示名跟存下的格式走(2026-10-27):转成 JPG 就叫 .jpg,网页上不再像一张打不开的 HEIC。
    assert res.data["content_type"] == "image/jpeg" and res.data["name"] == "IMG_0001.jpg"
    row = CaseAttachment.all_objects.get(pk=res.data["id"])
    assert row.file.name.endswith(".jpg") and row.content_type == "image/jpeg"
    bad = client.post(url, {"file": as_upload(FAKE_HEIC)}, format="multipart")
    assert bad.status_code == 400 and bad.data["code"] == "bad_type"


def test_post_media_stores_a_jpg(cn_tenant, settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path / "media")
    _, client = soul(cn_tenant, "作者")
    res = client.post(f"{SOCIAL}/media/", {"file": as_upload(heic_bytes())}, format="multipart")
    assert res.status_code == 201, res.content
    assert res.json()["content_type"] == "image/jpeg"
    assert [p.suffix for p in (tmp_path / "media").rglob("*") if p.is_file()] == [".jpg"]


def test_the_display_name_follows_the_stored_format():
    from apps.judgment.attachments import _with_extension

    assert _with_extension("IMG_0001.HEIC", "jpg") == "IMG_0001.jpg"
    assert _with_extension("scan.jpeg", "jpg") == "scan.jpeg"
    assert _with_extension("scan.JPG", "jpg") == "scan.JPG"
    assert _with_extension("notes.pdf", "pdf") == "notes.pdf"
    assert _with_extension("no-extension", "jpg") == "no-extension"
    assert _with_extension(".hidden", "jpg") == ".hidden"
