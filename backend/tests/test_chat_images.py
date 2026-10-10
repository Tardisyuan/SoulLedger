"""书信图片(2026-10-10):上传校验、发出、访问控制、官员读到、老客户端兼容、推送不带 URL。

图片文件在我们自己的存储里(与朋友圈同一条校验与重编码),Synapse 里只有 `{id, width, height}` 引用。
**核心断言是访问控制**:只有会话参与方取得到,别的灵魂 / 别的殿 / 没权限的官员 / 匿名 / 过期的签名,
拿着 id 或签名地址都是 404。
"""
import io
import os
from datetime import timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from apps.authentication.models import User
from apps.chat import images
from apps.chat.models import ChatImage, Conversation
from apps.chat.services import IMAGE_KEY, IMAGE_LABEL
from apps.soul_push.models import PushDelivery
from tests.chat_support import FakeMatrix, deliver_hooks, matrix, mutual, mxid  # noqa: F401
from tests.soul_account_support import officer_client, ready_soul
from tests.soul_push_support import TOKEN_B, register

pytestmark = pytest.mark.django_db

CONVERSATIONS = "/api/v1/me/chat/conversations/"
INBOX = "/api/v1/chat/inbox/"


@pytest.fixture(autouse=True)
def media_root(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path / "media")
    return tmp_path / "media"


def image_bytes(fmt="PNG", size=(64, 48), noise=False, **save):
    img = Image.frombytes("RGB", size, os.urandom(size[0] * size[1] * 3)) if noise else Image.new("RGB", size, (30, 90, 200))
    buf = io.BytesIO()
    img.save(buf, fmt, **save)
    return buf.getvalue()


def upload(client, conversation_id, content=None, name="p.png", content_type="image/png"):
    content = image_bytes() if content is None else content
    return client.post(f"{CONVERSATIONS}{conversation_id}/images/",
                       {"file": SimpleUploadedFile(name, content, content_type=content_type)}, format="multipart")


def send(client, image_id):
    return client.post(f"/api/v1/me/chat/images/{image_id}/send/")


def uploaded(client, conversation_id, **kw):
    res = upload(client, conversation_id, **kw)
    assert res.status_code == 201, res.content
    return res.json()


def stored(root):
    return sorted(p for p in root.rglob("*") if p.is_file()) if root.exists() else []


def fetch(url):
    """匿名客户端取文件:地址本身就是凭据。"""
    return APIClient().get(url)


def open_hall(client):
    res = client.post(CONVERSATIONS, {"kind": "OFFICER_INBOX"}, format="json")
    assert res.status_code in (200, 201), res.data
    return res.data["id"]


def moderator(tenant, username):
    return User.objects.create_user(username=username, password="x", role="MODERATOR", tenant=tenant)


@pytest.fixture
def hall(cn_tenant, matrix):  # noqa: F811
    account, client = ready_soul(cn_tenant, name="甲")
    return account, client, open_hall(client)


# ── 上传校验 ─────────────────────────────────────────────────────────────


class TestUploadValidation:
    def test_a_png_is_stored_privately_and_described(self, hall, media_root):
        _, client, cid = hall
        body = uploaded(client, cid, content=image_bytes(size=(80, 40)))
        assert (body["width"], body["height"]) == (80, 40)
        (f,) = stored(media_root)
        assert "private/chat_images" in f.as_posix()  # nginx 与 DEBUG 路由都不公开的前缀

    def test_the_type_is_read_from_the_bytes_not_the_name_or_content_type(self, hall, media_root):
        _, client, cid = hall
        res = upload(client, cid, content=image_bytes("GIF"), name="a.png", content_type="image/png")
        assert (res.status_code, res.json()["code"]) == (400, "not_an_image")
        res = upload(client, cid, content=b"<html>not an image</html>", name="a.png", content_type="image/png")
        assert (res.status_code, res.json()["code"]) == (400, "not_an_image")
        assert stored(media_root) == [] and not ChatImage.objects.exists()
        # 反过来:PNG 谎称 jpeg,存下来的是它真正的样子。
        body = uploaded(client, cid, content=image_bytes("PNG"), name="a.jpg", content_type="image/jpeg")
        assert ChatImage.objects.get(pk=body["id"]).content_type == "image/png"

    def test_an_oversized_file_is_refused(self, hall, media_root):
        from apps.social.images import MAX_BYTES

        _, client, cid = hall
        raw = image_bytes("PNG", size=(1400, 1400), noise=True)
        assert len(raw) > MAX_BYTES, "前提:超过上限"
        res = upload(client, cid, content=raw)
        assert (res.status_code, res.json()["code"]) == (400, "too_large")
        assert stored(media_root) == []

    def test_a_pixel_bomb_is_refused_before_decoding(self, hall, media_root):
        _, client, cid = hall
        buf = io.BytesIO()
        Image.new("L", (7000, 7000), 0).save(buf, "PNG")  # 4900 万像素,几十 KB
        res = upload(client, cid, content=buf.getvalue())
        assert (res.status_code, res.json()["code"]) == (400, "too_many_pixels")
        assert stored(media_root) == []

    def test_exif_including_gps_is_stripped_and_a_large_image_scaled(self, hall):
        _, client, cid = hall
        exif = Image.Exif()
        exif[0x010F] = "SecretCamera"
        exif[0x8825] = {1: "N", 2: (39.0, 54.0, 0.0), 3: "E", 4: (116.0, 23.0, 0.0)}  # GPS
        body = uploaded(client, cid, content=image_bytes("JPEG", size=(4096, 1024), exif=exif.tobytes()),
                        name="a.jpg", content_type="image/jpeg")
        assert (body["width"], body["height"]) == (images.MAX_EDGE, images.MAX_EDGE // 4)
        row = ChatImage.objects.get(pk=body["id"])
        with row.file.open("rb") as fh:
            raw = fh.read()
        assert b"SecretCamera" not in raw and b"Exif" not in raw
        with Image.open(io.BytesIO(raw)) as out:
            assert not out.getexif() and "exif" not in out.info

    def test_a_missing_file_is_a_400(self, hall):
        _, client, cid = hall
        res = client.post(f"{CONVERSATIONS}{cid}/images/", {}, format="multipart")
        assert (res.status_code, res.json()["code"]) == (400, "file_required")

    def test_at_most_four_unsent_images_per_conversation(self, hall):
        _, client, cid = hall
        ids = [uploaded(client, cid)["id"] for _ in range(images.MAX_PER_SEND)]
        res = upload(client, cid)
        assert (res.status_code, res.json()["code"]) == (409, "too_many_pending")
        assert send(client, ids[0]).status_code == 201  # 发出一张,位置就空出来
        assert upload(client, cid).status_code == 201

    def test_stale_unsent_images_are_swept_by_the_next_upload(self, hall, media_root, django_capture_on_commit_callbacks):
        _, client, cid = hall
        old = uploaded(client, cid)["id"]
        ChatImage.objects.filter(pk=old).update(created_at=timezone.now() - timedelta(hours=25))
        with django_capture_on_commit_callbacks(execute=True):
            uploaded(client, cid)
        assert not ChatImage.objects.filter(pk=old).exists()
        assert len(stored(media_root)) == 1


# ── 发出 ─────────────────────────────────────────────────────────────────


class TestSending:
    def test_an_image_is_one_message_with_the_label_and_a_reference(self, hall, matrix):  # noqa: F811
        account, client, cid = hall
        body = uploaded(client, cid)
        res = send(client, body["id"])
        assert res.status_code == 201, res.content
        room_id, sent = matrix.sent[-1]
        assert sent["body"] == IMAGE_LABEL and sent["sender"] == mxid(account)
        assert sent["image"] == {"id": body["id"], "width": 64, "height": 48}
        # 引用之外,事件里没有任何地址。
        assert "chat-images" not in str(sent)
        row = ChatImage.objects.get(pk=body["id"])
        assert row.event_id == res.json()["event_id"] and row.sent_at is not None
        assert Conversation.objects.get(pk=cid).last_from == "soul"

    def test_text_and_image_are_separate_messages(self, hall, matrix):  # noqa: F811
        _, client, cid = hall
        assert client.post(f"{CONVERSATIONS}{cid}/messages/", {"body": "请看附图"}, format="json").status_code == 201
        send(client, uploaded(client, cid)["id"])
        bodies = [(m["body"], m["image"]) for _, m in matrix.sent]
        assert [b for b, _ in bodies] == ["请看附图", IMAGE_LABEL]
        assert bodies[0][1] is None and bodies[1][1] is not None

    def test_sending_the_same_image_again_posts_nothing_new(self, hall, matrix):  # noqa: F811
        _, client, cid = hall
        image_id = uploaded(client, cid)["id"]
        first = send(client, image_id).json()["event_id"]
        again = send(client, image_id)
        assert again.status_code == 201 and again.json()["event_id"] == first
        assert len(matrix.sent) == 1

    def test_nobody_can_send_someone_elses_image(self, hall, cn_tenant, matrix):  # noqa: F811
        _, client, cid = hall
        image_id = uploaded(client, cid)["id"]
        _, other = ready_soul(cn_tenant, name="乙")
        assert send(other, image_id).status_code == 404
        assert matrix.sent == []

    def test_a_closed_conversation_takes_no_images(self, hall, matrix):  # noqa: F811
        _, client, cid = hall
        image_id = uploaded(client, cid)["id"]
        Conversation.objects.filter(pk=cid).update(closed_at=timezone.now())
        for res in (upload(client, cid), send(client, image_id)):
            assert (res.status_code, res.json()["code"]) == (409, "closed")
        assert matrix.sent == []

    def test_a_soul_who_left_the_hall_cannot_send_images_there(self, hall, eu_tenant, matrix):  # noqa: F811
        account, client, cid = hall
        image_id = uploaded(client, cid)["id"]
        account.soul.tenant = eu_tenant
        account.soul.save()
        for res in (upload(client, cid), send(client, image_id)):
            assert (res.status_code, res.json()["code"]) == (403, "not_current_hall")
        assert matrix.sent == []

    def test_a_muted_soul_cannot_send_images_to_a_soul_but_can_to_the_hall(self, cn_tenant, matrix):  # noqa: F811
        from apps.social import moderation

        a, a_client = ready_soul(cn_tenant, name="甲")
        b, _ = ready_soul(cn_tenant, name="乙")
        mutual(a, b)
        direct = a_client.post(CONVERSATIONS, {"target_user": b.user_id}, format="json").data["id"]
        hall_id = open_hall(a_client)
        moderation.mute_user(a.user, cn_tenant, 3, actor=None)
        res = upload(a_client, direct)
        assert (res.status_code, res.json()["code"]) == (403, "muted")
        assert upload(a_client, hall_id).status_code == 201  # 给殿司写信不在禁言之列

    def test_a_throttled_request_room_takes_no_images(self, cn_tenant, matrix):  # noqa: F811
        a, a_client = ready_soul(cn_tenant, name="甲")
        b, _ = ready_soul(cn_tenant, name="乙")  # 不互关:陌生人请求,每 24 小时一条文字
        opened = a_client.post(CONVERSATIONS, {"target_user": b.user_id}, format="json").data
        assert opened["throttled"] is True
        res = upload(a_client, opened["id"])
        assert (res.status_code, res.json()["code"]) == (409, "images_unavailable")

    def test_mutual_souls_can_send_each_other_images(self, cn_tenant, matrix):  # noqa: F811
        a, a_client = ready_soul(cn_tenant, name="甲")
        b, b_client = ready_soul(cn_tenant, name="乙")
        mutual(a, b)
        cid = a_client.post(CONVERSATIONS, {"target_user": b.user_id}, format="json").data["id"]
        image_id = uploaded(a_client, cid)["id"]
        assert send(a_client, image_id).status_code == 201
        assert matrix.sent[-1][1]["image"]["id"] == image_id
        # 对方取得到,自己也取得到。
        for client in (a_client, b_client):
            view = client.get(f"/api/v1/me/chat/images/{image_id}/")
            assert view.status_code == 200 and fetch(view.json()["url"]).status_code == 200


# ── 访问控制 ─────────────────────────────────────────────────────────────


class TestAccess:
    def sent_image(self, client, cid):
        image_id = uploaded(client, cid)["id"]
        assert send(client, image_id).status_code == 201
        return image_id

    def test_the_owner_gets_a_signed_url_and_the_file(self, hall):
        _, client, cid = hall
        image_id = self.sent_image(client, cid)
        view = client.get(f"/api/v1/me/chat/images/{image_id}/")
        assert view.status_code == 200
        assert view.json()["url"].startswith(f"/api/v1/chat-images/{image_id}/?t=")
        res = fetch(view.json()["url"])
        assert res.status_code == 200 and res["Content-Type"] == "image/png"
        assert "private" in res["Cache-Control"] and res["X-Content-Type-Options"] == "nosniff"

    def test_another_soul_cannot_get_it_by_id_or_by_a_forged_signature(self, hall, cn_tenant):
        _, client, cid = hall
        image_id = self.sent_image(client, cid)
        stranger, stranger_client = ready_soul(cn_tenant, name="路人")
        assert stranger_client.get(f"/api/v1/me/chat/images/{image_id}/").status_code == 404
        # 即使给陌生人签了地址(签名只说「发给谁」),取文件时仍按会话参与方重算。
        image = ChatImage.objects.get(pk=image_id)
        assert fetch(images.signed_url(image, stranger.user)).status_code == 404
        # 没登录、没签名、签名属于别的图:都是 404。
        assert APIClient().get(f"/api/v1/me/chat/images/{image_id}/").status_code == 401
        assert fetch(f"/api/v1/chat-images/{image_id}/").status_code == 404
        assert fetch(f"/api/v1/chat-images/{image_id}/?t=garbage").status_code == 404
        other_id = self.sent_image(client, cid)
        wrong = images.signed_url(ChatImage.objects.get(pk=other_id), image.uploader.user)
        assert fetch(wrong.replace(other_id, image_id)).status_code == 404

    def test_a_former_life_account_cannot_get_it(self, hall):
        """会话属于那一世的账号:同一个灵魂的别的账号(这里用另一个账号模拟新一世)不在参与方里。"""
        account, client, cid = hall
        image_id = self.sent_image(client, cid)
        image = ChatImage.objects.get(pk=image_id)
        Conversation.objects.filter(pk=cid).update(account_a=None)
        assert not images.may_view(account.user, ChatImage.objects.select_related("conversation").get(pk=image_id))
        assert fetch(images.signed_url(image, account.user)).status_code == 404

    def test_an_unsent_image_is_visible_to_its_uploader_only(self, cn_tenant, matrix):  # noqa: F811
        a, a_client = ready_soul(cn_tenant, name="甲")
        b, b_client = ready_soul(cn_tenant, name="乙")
        mutual(a, b)
        cid = a_client.post(CONVERSATIONS, {"target_user": b.user_id}, format="json").data["id"]
        image_id = uploaded(a_client, cid)["id"]  # 传了没发
        assert a_client.get(f"/api/v1/me/chat/images/{image_id}/").status_code == 200
        assert b_client.get(f"/api/v1/me/chat/images/{image_id}/").status_code == 404
        assert fetch(images.signed_url(ChatImage.objects.get(pk=image_id), b.user)).status_code == 404

    def test_the_halls_officer_reads_it_and_no_one_else_does(self, hall, cn_tenant, eu_tenant, matrix):  # noqa: F811
        _, client, cid = hall
        image_id = self.sent_image(client, cid)
        officer = officer_client(moderator(cn_tenant, "cn_mod"))
        rows = officer.get(f"{INBOX}{cid}/messages/").json()
        [row] = rows
        assert row["body"] == IMAGE_LABEL  # 老读者仍有一行字
        assert row["image"]["id"] == image_id and (row["image"]["width"], row["image"]["height"]) == (64, 48)
        assert fetch(row["image"]["url"]).status_code == 200

        # 别的殿的官员:读不到这个收件箱;给他签一个地址也取不到。
        eu_user = moderator(eu_tenant, "eu_mod")
        assert officer_client(eu_user).get(f"{INBOX}{cid}/messages/").status_code == 404
        image = ChatImage.objects.get(pk=image_id)
        assert fetch(images.signed_url(image, eu_user, eu_tenant)).status_code == 404
        assert fetch(images.signed_url(image, eu_user)).status_code == 404
        # 本殿但没有 soul_inbox.read 的官员(VIEWER)。
        viewer = User.objects.create_user(username="viewer", password="x", role="VIEWER", tenant=cn_tenant)
        assert officer_client(viewer).get(f"{INBOX}{cid}/messages/").status_code == 403
        assert fetch(images.signed_url(image, viewer, cn_tenant)).status_code == 404

    def test_an_officer_cannot_see_an_image_that_was_never_sent(self, hall, cn_tenant):
        _, client, cid = hall
        image_id = uploaded(client, cid)["id"]
        officer = moderator(cn_tenant, "cn_mod")
        assert fetch(images.signed_url(ChatImage.objects.get(pk=image_id), officer, cn_tenant)).status_code == 404

    def test_a_forged_reference_to_another_conversations_image_shows_nothing(self, hall, cn_tenant, matrix):  # noqa: F811
        """灵魂绕过后端、在 Matrix 里手写别人的图片 id:事件里写什么不授予任何访问。
        变异:`officer_views` 去掉 `conversation=conversation` 过滤 → 官员读到别的会话的图,红。"""
        _, client, cid = hall
        victim_image = self.sent_image(client, cid)
        thief, thief_client = ready_soul(cn_tenant, name="乙")
        thief_cid = open_hall(thief_client)
        room = Conversation.objects.get(pk=thief_cid).room_id
        FakeMatrix.says(room, mxid(thief), IMAGE_LABEL, extra={IMAGE_KEY: {"id": victim_image, "width": 1, "height": 1}})
        FakeMatrix.says(room, mxid(thief), IMAGE_LABEL, extra={IMAGE_KEY: {"id": "not-a-uuid"}})
        officer = officer_client(moderator(cn_tenant, "cn_mod"))
        rows = officer.get(f"{INBOX}{thief_cid}/messages/").json()
        assert len(rows) == 2 and all(r["image"] is None and r["body"] == IMAGE_LABEL for r in rows)
        # 取图本身也不认事件:乙对甲的图仍是 404。
        assert thief_client.get(f"/api/v1/me/chat/images/{victim_image}/").status_code == 404

    def test_an_expired_signature_is_a_404(self, hall, monkeypatch):
        _, client, cid = hall
        image_id = self.sent_image(client, cid)
        url = client.get(f"/api/v1/me/chat/images/{image_id}/").json()["url"]
        monkeypatch.setattr(images, "URL_TTL", -1)
        assert fetch(url).status_code == 404

    def test_an_image_follows_its_row_the_file_goes_when_the_row_does(self, hall, media_root, django_capture_on_commit_callbacks):
        _, client, cid = hall
        self.sent_image(client, cid)
        assert len(stored(media_root)) == 1
        with django_capture_on_commit_callbacks(execute=True):
            ChatImage.objects.all().delete()
        assert stored(media_root) == []

    def test_there_is_no_officer_upload_route(self, hall, cn_tenant):
        """官员回信暂不支持发图:没有这样的路由,而不是路由在、权限拒绝。"""
        _, _, cid = hall
        officer = officer_client(moderator(cn_tenant, "cn_mod"))
        res = officer.post(f"{INBOX}{cid}/images/", {"file": SimpleUploadedFile("a.png", image_bytes())},
                           format="multipart")
        assert res.status_code == 404
        res = officer.post(f"{INBOX}{cid}/reply/", {"body": "x", "image_id": "y"}, format="json")
        assert res.status_code == 201 and FakeMatrix.sent[-1][1]["image"] is None  # 多余字段被忽略,发的是文字


# ── 推送 ─────────────────────────────────────────────────────────────────


def test_an_image_message_pushes_like_a_letter_without_any_body_or_url(cn_tenant, matrix):  # noqa: F811
    a, a_client = ready_soul(cn_tenant, name="甲")
    b, b_client = ready_soul(cn_tenant, name="乙")
    assert register(b_client, TOKEN_B).status_code == 201
    mutual(a, b)
    cid = a_client.post(CONVERSATIONS, {"target_user": b.user_id}, format="json").data["id"]
    image_id = uploaded(a_client, cid)["id"]
    assert send(a_client, image_id).status_code == 201
    deliver_hooks()
    [push] = PushDelivery.objects.filter(account=b, kind="chat_message")
    text = f"{push.title}{push.body}{push.data}"
    assert "chat-images" not in text and image_id not in text and "http" not in text
