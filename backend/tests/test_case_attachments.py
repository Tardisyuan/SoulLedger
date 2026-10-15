"""案卷附件(Design 第二十八批 W4):类型 / 大小 / 个数 / 合计上限在服务端,删除规则,租户与权限,签名地址。"""
import io
import time

import pytest
from django.core import signing
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from PIL import Image

from apps.audit.models import AuditLog
from apps.authentication.models import User
from apps.judgment import attachments as svc
from apps.judgment.models import CaseAttachment, Judgment, Verdict
from tests.soul_account_support import dead_soul, officer_client, ready_soul

pytestmark = pytest.mark.django_db

PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"


@pytest.fixture(autouse=True)
def _media(settings, tmp_path):
    settings.MEDIA_ROOT = tmp_path


def _case(tenant, **fields):
    soul = dead_soul(tenant, name="附件灵魂")
    return Judgment.objects.create(soul=soul, civilization=soul.civilization, court="第一殿", tenant=tenant, **fields)


def _conclude(case):
    Judgment.all_objects.filter(pk=case.pk).update(verdict=Verdict.PASSED, is_final=True, concluded_at=timezone.now())


def _png(name="a.png", size=(8, 8)):
    buf = io.BytesIO()
    Image.new("RGB", size, "red").save(buf, "PNG")
    return SimpleUploadedFile(name, buf.getvalue(), content_type="image/png")


def _pdf(name="a.pdf", pad=0):
    return SimpleUploadedFile(name, PDF + b"x" * pad, content_type="application/pdf")


def _url(case, suffix=""):
    return f"/api/v1/judgment/{case.pk}/attachments/{suffix}"


def _post(client, case, upload):
    return client.post(_url(case), {"file": upload}, format="multipart")


@pytest.fixture
def moderator(django_user_model, cn_tenant):
    return django_user_model.objects.create_user(username="lead", password="x", role="MODERATOR", tenant=cn_tenant)


# ── 类型:看魔数,不看扩展名与客户端声明的类型 ────────────────────────────


def test_png_and_pdf_are_accepted_and_listed_with_usage(cn_tenant, judge_user):
    case = _case(cn_tenant)
    client = officer_client(judge_user)
    image = _post(client, case, _png("现场.png"))
    assert image.status_code == 201, image.data
    assert image.data["content_type"] == "image/png" and image.data["name"] == "现场.png"
    assert image.data["uploader"] == judge_user.pk and image.data["can_delete"] is True
    assert _post(client, case, _pdf("契约.pdf")).status_code == 201
    body = client.get(_url(case)).data
    assert [r["name"] for r in body["items"]] == ["现场.png", "契约.pdf"]
    assert body["count"] == 2 and body["total_bytes"] == sum(r["byte_size"] for r in body["items"])
    assert (body["max_count"], body["max_file_bytes"], body["max_total_bytes"]) == (30, 20 * 2**20, 100 * 2**20)
    assert body["concluded"] is False
    row = CaseAttachment.all_objects.get(pk=image.data["id"])
    assert row.tenant_id == cn_tenant.id and row.file.name.startswith("private/case_attachments/")
    assert row.file.name.endswith(".png") and "现场" not in row.file.name  # 客户端的文件名不落盘


@pytest.mark.parametrize("name,payload,declared", [
    ("fake.png", b"MZ\x90\x00 not an image at all", "image/png"),          # 扩展名与声明都说图片,魔数不是
    ("audio.m4a", b"\x00\x00\x00\x18ftypM4A \x00\x00", "audio/mp4"),
    ("photo.heic", b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic", "image/heic"),  # HEIC 不收
    ("pic.webp", b"RIFF\x24\x00\x00\x00WEBPVP8 ", "image/webp"),
    ("real.pdf", b"<html>%PDF-</html>", "application/pdf"),                # 声称 PDF,头不是 %PDF-
])
def test_type_is_sniffed_not_trusted(cn_tenant, judge_user, name, payload, declared):
    case = _case(cn_tenant)
    res = _post(officer_client(judge_user), case, SimpleUploadedFile(name, payload, content_type=declared))
    assert res.status_code == 400 and res.data["code"] == "bad_type"
    assert CaseAttachment.all_objects.count() == 0


def test_a_pdf_renamed_to_jpg_is_stored_as_the_pdf_it_is(cn_tenant, judge_user):
    case = _case(cn_tenant)
    res = _post(officer_client(judge_user), case, _pdf("scan.jpg"))
    assert res.status_code == 201 and res.data["content_type"] == "application/pdf"


# ── 大小与个数 ───────────────────────────────────────────────────────────


def test_a_file_over_20_mb_is_refused_and_exactly_20_mb_passes(cn_tenant, judge_user):
    case = _case(cn_tenant)
    client = officer_client(judge_user)
    over = _pdf("big.pdf", pad=svc.MAX_FILE_BYTES - len(PDF) + 1)
    res = _post(client, case, over)
    assert res.status_code == 400 and res.data["code"] == "too_large"
    assert _post(client, case, _pdf("ok.pdf", pad=svc.MAX_FILE_BYTES - len(PDF))).status_code == 201


def test_the_case_total_stops_at_100_mb(cn_tenant, judge_user):
    case = _case(cn_tenant)
    client = officer_client(judge_user)
    for i in range(5):  # 5 × 20 MB 正好 100 MB
        assert _post(client, case, _pdf(f"{i}.pdf", pad=svc.MAX_FILE_BYTES - len(PDF))).status_code == 201
    res = _post(client, case, _pdf("one-more.pdf"))
    assert res.status_code == 409 and res.data["code"] == "case_full"
    assert CaseAttachment.all_objects.count() == 5


def test_a_deleted_attachment_frees_its_room(cn_tenant, judge_user):
    case = _case(cn_tenant)
    client = officer_client(judge_user)
    ids = [_post(client, case, _pdf(f"{i}.pdf", pad=svc.MAX_FILE_BYTES - len(PDF))).data["id"] for i in range(5)]
    assert _post(client, case, _pdf()).status_code == 409
    assert client.delete(_url(case, f"{ids[0]}/")).status_code == 204
    assert _post(client, case, _pdf()).status_code == 201


def test_at_most_30_files(cn_tenant, judge_user, monkeypatch):
    case = _case(cn_tenant)
    client = officer_client(judge_user)
    for i in range(30):
        assert _post(client, case, _pdf(f"{i}.pdf")).status_code == 201
    res = _post(client, case, _pdf("31.pdf"))
    assert res.status_code == 409 and res.data["code"] == "too_many"
    assert CaseAttachment.all_objects.count() == 30


# ── 租户与权限 ───────────────────────────────────────────────────────────


def test_another_halls_case_is_404_for_every_verb(cn_tenant, eu_tenant, judge_user):
    foreign = _case(eu_tenant)
    row = CaseAttachment.all_objects.create(
        judgment=foreign, tenant=eu_tenant, name="x.pdf", byte_size=3, content_type="application/pdf", file="private/x.pdf")
    client = officer_client(judge_user)
    assert client.get(_url(foreign)).status_code == 404
    assert _post(client, foreign, _pdf()).status_code == 404
    assert client.delete(_url(foreign, f"{row.pk}/")).status_code == 404
    assert client.get(_url(foreign, f"{row.pk}/link/")).status_code == 404
    assert CaseAttachment.all_objects.count() == 1


def test_someone_without_judgment_codenames_gets_403(cn_tenant):
    case = _case(cn_tenant)
    viewer = User.objects.create_user(username="v", password="x", role="VIEWER", tenant=cn_tenant)
    client = officer_client(viewer)
    assert client.get(_url(case)).status_code == 403
    assert _post(client, case, _pdf()).status_code == 403


def test_a_soul_cannot_reach_case_attachments(cn_tenant, judge_user):
    case = _case(cn_tenant)
    row = _post(officer_client(judge_user), case, _pdf()).data
    _, soul_client = ready_soul(cn_tenant, name="想看的灵魂")
    assert soul_client.get(_url(case)).status_code in (401, 403, 404)
    assert _post(soul_client, case, _pdf()).status_code in (401, 403, 404)
    assert soul_client.get(_url(case, f"{row['id']}/link/")).status_code in (401, 403, 404)
    # 就算拿到了别人的签名地址,文件出口也不认灵魂这个角色
    account, _ = ready_soul(cn_tenant, name="另一个灵魂")
    token = signing.TimestampSigner(salt=svc.SIGNING_SALT).sign(f"{row['id']}.{account.user.pk}")
    from rest_framework.test import APIClient
    assert APIClient().get(f"/api/v1/case-attachments/{row['id']}/?t={token}").status_code == 404


# ── 删除:上传人、结案前;结案后谁都不行 ───────────────────────────────────


def test_the_uploader_deletes_before_conclusion_and_it_is_audited(cn_tenant, judge_user, django_capture_on_commit_callbacks):
    case = _case(cn_tenant)
    client = officer_client(judge_user)
    row = _post(client, case, _pdf("撤我.pdf")).data
    stored = CaseAttachment.all_objects.get(pk=row["id"]).file
    path = stored.path
    with django_capture_on_commit_callbacks(execute=True):
        assert client.delete(_url(case, f"{row['id']}/")).status_code == 204
    gone = CaseAttachment.all_objects.get(pk=row["id"])
    assert gone.deleted_at is not None
    import os
    assert not os.path.exists(path)
    assert client.get(_url(case)).data["items"] == []
    log = AuditLog.objects.get(resource="judgment.attachment", action="DELETE")
    assert log.user_id == judge_user.pk and log.description.startswith("删除附件") and "撤我.pdf" in log.description
    assert client.delete(_url(case, f"{row['id']}/")).status_code == 404  # 已删的再删:不存在


def test_a_colleague_who_is_not_the_uploader_cannot_delete(cn_tenant, judge_user, moderator):
    case = _case(cn_tenant)
    row = _post(officer_client(judge_user), case, _pdf()).data
    res = officer_client(moderator).delete(_url(case, f"{row['id']}/"))
    assert res.status_code == 403 and res.data["code"] == "not_uploader"
    assert CaseAttachment.all_objects.get(pk=row["id"]).deleted_at is None
    listed = officer_client(moderator).get(_url(case)).data["items"][0]
    assert listed["can_delete"] is False


@pytest.mark.parametrize("who", ["judge_user", "moderator", "admin_user"])
def test_after_conclusion_nobody_can_delete(cn_tenant, judge_user, moderator, admin_user, who):
    case = _case(cn_tenant)
    row = _post(officer_client(judge_user), case, _pdf()).data
    _conclude(case)
    user = {"judge_user": judge_user, "moderator": moderator, "admin_user": admin_user}[who]
    res = officer_client(user).delete(_url(case, f"{row['id']}/"))
    assert res.status_code == 403 and res.data["code"] == "concluded"
    assert CaseAttachment.all_objects.get(pk=row["id"]).deleted_at is None
    assert not AuditLog.objects.filter(resource="judgment.attachment", action="DELETE").exists()
    body = officer_client(user).get(_url(case)).data
    assert body["concluded"] is True and body["items"][0]["can_delete"] is False


def test_uploading_after_conclusion_is_still_allowed_for_the_approval_stage(cn_tenant, judge_user):
    case = _case(cn_tenant)
    _conclude(case)
    assert _post(officer_client(judge_user), case, _pdf()).status_code == 201


# ── 签名地址 ─────────────────────────────────────────────────────────────


def test_link_serves_the_file_and_expires_after_ten_minutes(cn_tenant, judge_user, monkeypatch):
    case = _case(cn_tenant)
    client = officer_client(judge_user)
    row = _post(client, case, _pdf("契约.pdf")).data
    link = client.get(_url(case, f"{row['id']}/link/")).data
    assert link["url"].startswith(f"/api/v1/case-attachments/{row['id']}/?t=")
    assert link["name"] == "契约.pdf" and link["content_type"] == "application/pdf"
    anon = type(client)()  # 不带 Authorization:凭据只有地址里的签名
    ok = anon.get(link["url"])
    assert ok.status_code == 200 and ok["Content-Type"] == "application/pdf"
    assert ok["Content-Disposition"].startswith("inline") and ok["X-Frame-Options"] == "SAMEORIGIN"
    assert b"".join(ok.streaming_content).startswith(b"%PDF-")
    assert anon.get(link["url"] + "&dl=1")["Content-Disposition"].startswith("attachment")
    now = time.time()
    monkeypatch.setattr(signing.time, "time", lambda: now + svc.URL_TTL - 5)
    assert anon.get(link["url"]).status_code == 200
    monkeypatch.setattr(signing.time, "time", lambda: now + svc.URL_TTL + 5)
    assert anon.get(link["url"]).status_code == 404
    assert svc.URL_TTL == 600


def test_link_for_one_attachment_does_not_open_another_and_garbage_is_404(cn_tenant, judge_user):
    case = _case(cn_tenant)
    client = officer_client(judge_user)
    a = _post(client, case, _pdf("a.pdf")).data
    b = _post(client, case, _pdf("b.pdf")).data
    token = client.get(_url(case, f"{a['id']}/link/")).data["url"].split("?t=")[1]
    anon = type(client)()
    assert anon.get(f"/api/v1/case-attachments/{b['id']}/?t={token}").status_code == 404
    assert anon.get(f"/api/v1/case-attachments/{b['id']}/").status_code == 404
    assert anon.get(f"/api/v1/case-attachments/{b['id']}/?t=garbage").status_code == 404


def test_a_link_stops_working_once_the_attachment_is_deleted(cn_tenant, judge_user):
    case = _case(cn_tenant)
    client = officer_client(judge_user)
    row = _post(client, case, _pdf()).data
    url = client.get(_url(case, f"{row['id']}/link/")).data["url"]
    client.delete(_url(case, f"{row['id']}/"))
    assert type(client)().get(url).status_code == 404


def test_a_link_signed_in_one_hall_is_dead_for_an_officer_moved_elsewhere(cn_tenant, eu_tenant, judge_user):
    case = _case(cn_tenant)
    client = officer_client(judge_user)
    row = _post(client, case, _pdf()).data
    url = client.get(_url(case, f"{row['id']}/link/")).data["url"]
    User.objects.filter(pk=judge_user.pk).update(tenant=eu_tenant)
    assert type(client)().get(url).status_code == 404
