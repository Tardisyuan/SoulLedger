"""朋友圈帖子图片(2026-09-25):上传、挂载、访问、审核、回收站、孤儿清理。

访问一律**按取文件的地址测**,不只看列表:列表里没有一条帖子,不等于它的图拿不到。
签名地址是发给某个查看者的;每次取文件都用那个人重算可见性 —— 所以「先拿到地址、
帖子后来被隐藏」是这里最要紧的一种情形。
"""
import io
import os
from datetime import timedelta

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from apps.core.recycle_bin import list_bin_entries
from apps.social import media as post_media
from apps.social import moderation as mod
from apps.social.models import ModerationStatus, Post, PostMedia, Visibility
from tests.soul_social_support import MODERATION, SOCIAL, feed_ids, follow, officer_client, post, soul

pytestmark = pytest.mark.django_db
BIN = "/api/v1/recycle-bin/"


@pytest.fixture(autouse=True)
def media_root(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path / "media")
    return tmp_path / "media"


@pytest.fixture
def moderator(db, django_user_model, cn_tenant):
    return django_user_model.objects.create(username="media_moderator", role="MODERATOR", tenant=cn_tenant)


@pytest.fixture
def eu_moderator(db, django_user_model, eu_tenant):
    # 不用 ADMIN:它是唯一跨租户的角色,拿它测隔离测到的是豁免。
    return django_user_model.objects.create(username="eu_media_moderator", role="MODERATOR", tenant=eu_tenant)


def image_bytes(fmt="PNG", size=(64, 48), exif=None, noise=False):
    if noise:
        img = Image.frombytes("RGB", size, os.urandom(size[0] * size[1] * 3))
    else:
        img = Image.new("RGB", size, (30, 90, 200))
    buf = io.BytesIO()
    img.save(buf, fmt, **({"exif": exif} if exif is not None else {}))
    return buf.getvalue()


def upload(client, content=None, name="p.png", content_type="image/png"):
    content = image_bytes() if content is None else content
    return client.post(
        f"{SOCIAL}/media/", {"file": SimpleUploadedFile(name, content, content_type=content_type)},
        format="multipart",
    )


def uploaded(client, **kw):
    res = upload(client, **kw)
    assert res.status_code == 201, res.content
    return res.json()


def create_post(client, media_ids, content="配图的帖子", visibility=Visibility.TENANT):
    return client.post(
        f"{SOCIAL}/feed/", {"content": content, "visibility": visibility, "media": media_ids}, format="json",
    )


def stored(root):
    return sorted(p for p in root.rglob("*") if p.is_file()) if root.exists() else []


def fetch(url):
    """匿名客户端取文件:地址本身就是凭据。"""
    res = APIClient().get(url)
    body = b"".join(res.streaming_content) if getattr(res, "streaming", False) else res.content
    return res.status_code, body


def post_with_images(client, n=2, **kw):
    ids = [uploaded(client)["id"] for _ in range(n)]
    res = create_post(client, ids, **kw)
    assert res.status_code == 201, res.content
    return res.json()


def urls_for(client, post_id):
    res = client.get(f"{SOCIAL}/posts/{post_id}/")
    assert res.status_code == 200, res.content
    return [m["url"] for m in res.json()["media"]]


# ── 上传校验 ─────────────────────────────────────────────────────────────


class TestUploadValidation:
    def test_png_jpeg_webp_are_accepted_and_stored_privately_under_a_random_name(self, cn_tenant, media_root):
        _, client = soul(cn_tenant, "作者")
        for fmt, ctype in (("PNG", "image/png"), ("JPEG", "image/jpeg"), ("WEBP", "image/webp")):
            body = uploaded(client, content=image_bytes(fmt), name="holiday photo.bin", content_type=ctype)
            assert (body["content_type"], body["width"], body["height"]) == (ctype, 64, 48)
            assert body["url"].startswith(f"/api/v1/social-media/{body['id']}/?t=")
        files = stored(media_root)
        assert len(files) == 3
        assert all(str(f.relative_to(media_root)).startswith("private/post_media/") for f in files)
        assert not any("holiday" in f.name for f in files)
        assert PostMedia.objects.filter(post__isnull=True).count() == 3

    def test_exif_including_gps_is_stripped(self, cn_tenant, media_root):
        _, client = soul(cn_tenant, "作者")
        exif = Image.Exif()
        exif[0x010F] = "CameraMaker"
        exif[0x8825] = {2: (1.0, 2.0, 3.0)}  # GPSInfo
        raw = image_bytes("JPEG", exif=exif.tobytes())
        with Image.open(io.BytesIO(raw)) as check:
            assert check.getexif(), "前提:上传的文件带 EXIF"
        uploaded(client, content=raw, name="a.jpg", content_type="image/jpeg")
        (f,) = stored(media_root)
        with Image.open(f) as img:
            assert not img.getexif()
        assert b"CameraMaker" not in f.read_bytes()

    @pytest.mark.parametrize("content,name,ctype", [
        (b"just some words", "notes.png", "image/png"),
        (b"<?php system($_GET['c']); ?>", "evil.jpg", "image/jpeg"),
        (b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', "a.png", "image/png"),
        # 魔数对了,内容不是图:按魔数认格式之后仍要完整解码。
        (b"\x89PNG\r\n\x1a\n" + b"\x00" * 200, "fake.png", "image/png"),
        (b"\xff\xd8\xff" + b"not a jpeg" * 20, "fake.jpg", "image/jpeg"),
    ])
    def test_a_file_wearing_an_image_name_and_type_is_refused(self, cn_tenant, media_root, content, name, ctype):
        _, client = soul(cn_tenant, "作者")
        res = upload(client, content=content, name=name, content_type=ctype)
        assert res.status_code == 400, res.content
        assert res.json()["code"] == "not_an_image"
        assert stored(media_root) == [] and not PostMedia.all_objects.exists()

    def test_a_real_image_outside_the_allowlist_is_refused(self, cn_tenant, media_root):
        _, client = soul(cn_tenant, "作者")
        res = upload(client, content=image_bytes("GIF"), name="a.png", content_type="image/png")
        assert (res.status_code, res.json()["code"]) == (400, "not_an_image")
        assert stored(media_root) == []

    def test_a_png_claiming_to_be_jpeg_is_stored_as_what_it_is(self, cn_tenant, media_root):
        _, client = soul(cn_tenant, "作者")
        body = uploaded(client, content=image_bytes("PNG"), name="a.jpg", content_type="image/jpeg")
        assert body["content_type"] == "image/png"
        (f,) = stored(media_root)
        assert f.suffix == ".png"

    def test_an_oversized_file_is_refused(self, cn_tenant, media_root):
        from apps.social.images import MAX_BYTES

        _, client = soul(cn_tenant, "作者")
        raw = image_bytes("PNG", size=(1400, 1400), noise=True)
        assert len(raw) > MAX_BYTES, "前提:超过上限"
        res = upload(client, content=raw)
        assert (res.status_code, res.json()["code"]) == (400, "too_large")
        assert stored(media_root) == []

    def test_a_large_image_is_scaled_to_the_max_edge(self, cn_tenant):
        _, client = soul(cn_tenant, "作者")
        body = uploaded(client, content=image_bytes("PNG", size=(4096, 1024)))
        assert (body["width"], body["height"]) == (post_media.MAX_EDGE, post_media.MAX_EDGE // 4)

    def test_pending_uploads_are_capped(self, cn_tenant, monkeypatch):
        monkeypatch.setattr(post_media, "MAX_PENDING", 2)
        _, client = soul(cn_tenant, "作者")
        uploaded(client)
        uploaded(client)
        res = upload(client)
        assert (res.status_code, res.json()["code"]) == (409, "too_many_pending")

    def test_a_muted_soul_cannot_upload(self, cn_tenant, moderator, media_root):
        account, client = soul(cn_tenant, "作者")
        mod.mute_user(account.user, cn_tenant, 3, actor=moderator)
        res = upload(client)
        assert (res.status_code, res.json()["code"]) == (403, "muted")
        assert stored(media_root) == []

    def test_an_officer_token_cannot_upload(self, cn_tenant, moderator):
        res = upload(officer_client(moderator))
        assert res.status_code == 403


# ── 挂载 ─────────────────────────────────────────────────────────────────


class TestAttach:
    def test_up_to_nine_attach_in_the_given_order(self, cn_tenant):
        _, client = soul(cn_tenant, "作者")
        ids = [uploaded(client)["id"] for _ in range(post_media.MAX_PER_POST)]
        ids.reverse()
        res = create_post(client, ids)
        assert res.status_code == 201, res.content
        assert [m["id"] for m in res.json()["media"]] == ids
        assert list(PostMedia.objects.filter(post_id=res.json()["id"]).order_by("position").values_list(
            "position", flat=True)) == list(range(9))

    def test_ten_are_refused_and_no_post_is_created(self, cn_tenant, monkeypatch):
        monkeypatch.setattr(post_media, "MAX_PENDING", 20)
        _, client = soul(cn_tenant, "作者")
        ids = [uploaded(client)["id"] for _ in range(post_media.MAX_PER_POST + 1)]
        res = create_post(client, ids)
        assert res.status_code == 400, res.content
        assert not Post.objects.exists()
        assert PostMedia.objects.filter(post__isnull=True).count() == 10

    def test_someone_elses_upload_cannot_be_attached(self, cn_tenant):
        _, a = soul(cn_tenant, "甲")
        _, b = soul(cn_tenant, "乙")
        theirs = uploaded(a)["id"]
        res = create_post(b, [theirs])
        assert (res.status_code, res.json()["code"]) == (400, "media_not_found")
        assert not Post.objects.exists()
        assert PostMedia.objects.get(pk=theirs).post_id is None

    def test_an_image_cannot_be_attached_twice(self, cn_tenant):
        _, client = soul(cn_tenant, "作者")
        mid = uploaded(client)["id"]
        assert create_post(client, [mid]).status_code == 201
        res = create_post(client, [mid], content="又一条")
        assert (res.status_code, res.json()["code"]) == (400, "media_not_found")
        res = create_post(client, [uploaded(client)["id"]] * 2, content="重复")
        assert (res.status_code, res.json()["code"]) == (400, "duplicate_media")

    def test_images_alone_make_a_post_but_nothing_does_not(self, cn_tenant):
        _, client = soul(cn_tenant, "作者")
        assert create_post(client, [uploaded(client)["id"]], content="").status_code == 201
        res = create_post(client, [], content="  ")
        assert (res.status_code, res.json()["code"]) == (400, "empty_post")

    def test_a_pending_upload_can_be_removed_by_its_uploader_only(self, cn_tenant, media_root):
        _, a = soul(cn_tenant, "甲")
        _, b = soul(cn_tenant, "乙")
        mid = uploaded(a)["id"]
        assert b.delete(f"{SOCIAL}/media/{mid}/").status_code == 404
        assert len(stored(media_root)) == 1
        assert a.delete(f"{SOCIAL}/media/{mid}/").status_code == 204
        assert not PostMedia.all_objects.filter(pk=mid).exists()

    def test_removing_a_pending_upload_deletes_its_file(self, cn_tenant, media_root, django_capture_on_commit_callbacks):
        _, a = soul(cn_tenant, "甲")
        mid = uploaded(a)["id"]
        with django_capture_on_commit_callbacks(execute=True):
            assert a.delete(f"{SOCIAL}/media/{mid}/").status_code == 204
        assert stored(media_root) == []

    def test_an_attached_image_is_not_removable_as_pending(self, cn_tenant):
        _, a = soul(cn_tenant, "甲")
        body = post_with_images(a, 1)
        assert a.delete(f"{SOCIAL}/media/{body['media'][0]['id']}/").status_code == 404


# ── 谁拿得到文件 ──────────────────────────────────────────────────────────


class TestAccess:
    def test_feed_and_detail_carry_ordered_media_with_dimensions(self, cn_tenant):
        _, author = soul(cn_tenant, "作者")
        _, reader = soul(cn_tenant, "读者")
        body = post_with_images(author, 3)
        feed = reader.get(f"{SOCIAL}/feed/").json()["results"]
        (row,) = [r for r in feed if r["id"] == body["id"]]
        assert [m["id"] for m in row["media"]] == [m["id"] for m in body["media"]]
        assert all((m["width"], m["height"]) == (64, 48) for m in row["media"])
        # 发给读者的地址不是发给作者的那一个:签名里是查看者。
        assert row["media"][0]["url"] != body["media"][0]["url"]
        status, content = fetch(row["media"][0]["url"])
        assert status == 200 and content[:8] == b"\x89PNG\r\n\x1a\n"

    def test_an_unsigned_tampered_or_swapped_url_is_404(self, cn_tenant):
        _, author = soul(cn_tenant, "作者")
        body = post_with_images(author, 2)
        first, second = (m["url"] for m in body["media"])
        assert fetch(first.split("?")[0])[0] == 404
        assert fetch(first[:-2] + ("aa" if not first.endswith("aa") else "bb"))[0] == 404
        # 图 1 的签名配图 2 的 id。
        token = first.split("?t=")[1]
        assert fetch(f"/api/v1/social-media/{body['media'][1]['id']}/?t={token}")[0] == 404
        assert fetch(second)[0] == 200

    def test_an_expired_url_is_404(self, cn_tenant, monkeypatch):
        _, author = soul(cn_tenant, "作者")
        url = post_with_images(author, 1)["media"][0]["url"]
        assert fetch(url)[0] == 200
        monkeypatch.setattr(post_media, "URL_TTL", -1)
        assert fetch(url)[0] == 404

    def test_a_pending_upload_is_only_for_its_uploader(self, cn_tenant):
        a_account, a = soul(cn_tenant, "甲")
        b_account, _ = soul(cn_tenant, "乙")
        row = PostMedia.objects.get(pk=uploaded(a)["id"])
        assert fetch(post_media.signed_url(row, a_account.user))[0] == 200
        assert fetch(post_media.signed_url(row, b_account.user))[0] == 404

    def test_hidden_post_media_is_not_served_to_souls_even_with_an_earlier_url(self, cn_tenant, moderator):
        _, author = soul(cn_tenant, "作者")
        _, reader = soul(cn_tenant, "读者")
        body = post_with_images(author, 2)
        reader_urls = urls_for(reader, body["id"])
        assert [fetch(u)[0] for u in reader_urls] == [200, 200]

        mod.moderate_content(Post.objects.get(pk=body["id"]), "HIDE", actor=moderator, reason="违规")

        assert [fetch(u)[0] for u in reader_urls] == [404, 404]
        assert body["id"] not in feed_ids(reader)
        assert reader.get(f"{SOCIAL}/posts/{body['id']}/").status_code == 404
        # 作者本人仍看得见自己被隐藏的帖子,连图一起(带状态)。
        author_urls = urls_for(author, body["id"])
        assert [fetch(u)[0] for u in author_urls] == [200, 200]
        # 官员也看得见。
        officer_urls = [m["url"] for m in officer_client(moderator).get(
            f"{MODERATION}/posts/{body['id']}/").json()["media"]]
        assert [fetch(u)[0] for u in officer_urls] == [200, 200]

        mod.moderate_content(Post.objects.get(pk=body["id"]), "RESTORE", actor=moderator)
        assert [fetch(u)[0] for u in reader_urls] == [200, 200]

    def test_pending_review_post_media_is_the_authors_alone(self, cn_tenant):
        from apps.social.models import SensitiveWord

        SensitiveWord.objects.create(tenant=cn_tenant, word="米铺")
        author_account, author = soul(cn_tenant, "作者")
        reader_account, _ = soul(cn_tenant, "读者")
        body = post_with_images(author, 1, content="城南米铺")
        assert body["moderation_status"] == ModerationStatus.PENDING
        row = PostMedia.objects.get(pk=body["media"][0]["id"])
        assert fetch(post_media.signed_url(row, author_account.user))[0] == 200
        assert fetch(post_media.signed_url(row, reader_account.user))[0] == 404

    def test_visibility_tiers_reach_the_file(self, cn_tenant):
        author_account, author = soul(cn_tenant, "作者")
        fan_account, _ = soul(cn_tenant, "关注者")
        stranger_account, _ = soul(cn_tenant, "路人")
        follow(fan_account, author_account)
        followers_only = PostMedia.objects.get(pk=post_with_images(author, 1, visibility=Visibility.FOLLOWERS)["media"][0]["id"])
        private = PostMedia.objects.get(pk=post_with_images(author, 1, visibility=Visibility.PRIVATE)["media"][0]["id"])

        def code(row, account):
            return fetch(post_media.signed_url(row, account.user))[0]

        assert (code(followers_only, fan_account), code(followers_only, stranger_account)) == (200, 404)
        assert (code(private, author_account), code(private, fan_account)) == (200, 404)

    def test_a_retired_or_deactivated_viewer_gets_nothing(self, cn_tenant):
        _, author = soul(cn_tenant, "作者")
        reader_account, reader = soul(cn_tenant, "读者")
        url = urls_for(reader, post_with_images(author, 1)["id"])[0]
        type(reader_account.user).objects.filter(pk=reader_account.user.pk).update(is_active=False)
        assert fetch(url)[0] == 404


class TestTenantIsolation:
    def test_another_civilization_cannot_fetch_or_list(self, cn_tenant, eu_tenant, moderator, eu_moderator):
        _, author = soul(cn_tenant, "作者")
        eu_soul, eu_client = soul(eu_tenant, "异乡人")
        body = post_with_images(author, 1, visibility=Visibility.PUBLIC)
        row = PostMedia.objects.get(pk=body["media"][0]["id"])
        # 灵魂:不在列表里,给它签的地址也拿不到。
        assert body["id"] not in feed_ids(eu_client)
        assert fetch(post_media.signed_url(row, eu_soul.user))[0] == 404
        # 另一个文明的审核官:详情 404,签的地址 404;本文明的审核官 200。
        assert officer_client(eu_moderator).get(f"{MODERATION}/posts/{body['id']}/").status_code == 404
        assert fetch(post_media.signed_url(row, eu_moderator))[0] == 404
        assert fetch(post_media.signed_url(row, moderator))[0] == 200

    def test_an_eu_soul_cannot_attach_a_cn_upload(self, cn_tenant, eu_tenant):
        _, cn = soul(cn_tenant, "甲")
        _, eu = soul(eu_tenant, "乙")
        res = create_post(eu, [uploaded(cn)["id"]])
        assert (res.status_code, res.json()["code"]) == (400, "media_not_found")

    def test_an_officer_without_moderation_read_gets_nothing(self, cn_tenant, judge_user):
        _, author = soul(cn_tenant, "作者")
        row = PostMedia.objects.get(pk=post_with_images(author, 1)["media"][0]["id"])
        from apps.perm.checker import check_permission

        assert not check_permission(judge_user, "social.moderate"), "前提:JUDGE 不持有审核码名"
        assert fetch(post_media.signed_url(row, judge_user))[0] == 404


# ── 审核后台 ─────────────────────────────────────────────────────────────


class TestModeration:
    def test_detail_carries_the_grid_and_list_rows_carry_the_count(self, cn_tenant, moderator):
        from apps.social.models import SensitiveWord

        SensitiveWord.objects.create(tenant=cn_tenant, word="米铺")
        author_account, author = soul(cn_tenant, "作者")
        reader_account, reader = soul(cn_tenant, "读者")
        pending = post_with_images(author, 3, content="城南米铺")
        reported = post_with_images(author, 2, content="普通的帖子")
        res = reader.post(f"{SOCIAL}/reports/", {"target_type": "POST", "target_id": reported["id"],
                                                  "reason": "SPAM"}, format="json")
        assert res.status_code == 201, res.content

        officer = officer_client(moderator)
        rows = officer.get(f"{MODERATION}/posts/").json()["results"]
        (row,) = [r for r in rows if r["id"] == pending["id"]]
        assert row["media_count"] == 3
        (report,) = officer.get(f"{MODERATION}/reports/").json()["results"]
        assert report["media_count"] == 2

        detail = officer.get(f"{MODERATION}/posts/{pending['id']}/").json()
        assert [m["id"] for m in detail["media"]] == [m["id"] for m in pending["media"]]
        assert all((m["width"], m["height"]) == (64, 48) for m in detail["media"])

    def test_a_text_only_post_has_no_media(self, cn_tenant, moderator):
        author_account, _ = soul(cn_tenant, "作者")
        p = post(author_account, "只有字")
        Post.objects.filter(pk=p.pk).update(moderation_status=ModerationStatus.PENDING)
        detail = officer_client(moderator).get(f"{MODERATION}/posts/{p.pk}/").json()
        assert (detail["media"], detail["media_count"]) == ([], 0)


# ── 删除:官员删进回收站,作者删是真删 ──────────────────────────────────────


class TestDeletion:
    def test_recycle_bin_round_trip_takes_the_media_along(self, cn_tenant, moderator, admin_user):
        _, author = soul(cn_tenant, "作者")
        _, reader = soul(cn_tenant, "读者")
        body = post_with_images(author, 3)
        reader_urls = urls_for(reader, body["id"])
        target = Post.objects.get(pk=body["id"])

        mod.moderate_content(target, "DELETE", actor=moderator, reason="违规")

        target = Post.all_objects.get(pk=target.pk)
        media = PostMedia.all_objects.filter(post=target)
        assert media.count() == 3 and all(m.is_deleted for m in media)
        assert {m.delete_cascade_id for m in media} == {target.delete_cascade_id}
        assert [fetch(u)[0] for u in reader_urls] == [404] * 3
        # 回收站里是一条,「含 3 项关联」;官员在回收站里仍能看图。
        (entry,) = [e for e in list_bin_entries(is_admin=True) if e["id"] == target.pk]
        assert entry["dependent_count"] == 3
        officer_row = PostMedia.all_objects.filter(post=target).first()
        assert fetch(post_media.signed_url(officer_row, moderator))[0] == 200

        res = officer_client(admin_user).post(f"{BIN}restore/", {"cascade_id": entry["cascade_id"]}, format="json")
        assert res.status_code == 200 and res.json() == {"restored": 4}, res.content
        assert not PostMedia.all_objects.filter(post=target, is_deleted=True).exists()
        assert [fetch(u)[0] for u in reader_urls] == [200] * 3
        assert [m["id"] for m in reader.get(f"{SOCIAL}/posts/{body['id']}/").json()["media"]] == [
            m["id"] for m in body["media"]
        ]

    def test_hard_delete_from_the_bin_removes_rows_and_files(
        self, cn_tenant, moderator, admin_user, media_root, django_capture_on_commit_callbacks,
    ):
        _, author = soul(cn_tenant, "作者")
        body = post_with_images(author, 2)
        mod.moderate_content(Post.objects.get(pk=body["id"]), "DELETE", actor=moderator)
        Post.all_objects.filter(pk=body["id"]).update(deleted_at=timezone.now() - timedelta(days=31))
        assert len(stored(media_root)) == 2
        with django_capture_on_commit_callbacks(execute=True):
            res = officer_client(admin_user).post(
                f"{BIN}hard-delete/", {"entity_type": "social_post", "id": body["id"]}, format="json"
            )
        assert res.status_code == 204, res.content
        assert not PostMedia.all_objects.exists()
        assert stored(media_root) == []

    def test_a_soul_deleting_its_own_post_really_deletes_the_files(
        self, cn_tenant, media_root, django_capture_on_commit_callbacks,
    ):
        _, author = soul(cn_tenant, "作者")
        body = post_with_images(author, 2)
        keep = post_with_images(author, 1, content="留着的")
        urls = urls_for(author, body["id"])
        assert len(stored(media_root)) == 3
        with django_capture_on_commit_callbacks(execute=True):
            assert author.delete(f"{SOCIAL}/posts/{body['id']}/").status_code == 204
        assert not PostMedia.all_objects.filter(post_id=body["id"]).exists()
        assert len(stored(media_root)) == 1
        assert [fetch(u)[0] for u in urls] == [404, 404]
        assert fetch(urls_for(author, keep["id"])[0])[0] == 200
        # 不在回收站里。
        assert not [e for e in list_bin_entries(is_admin=True) if str(e["id"]) == body["id"]]


# ── 孤儿清理 ─────────────────────────────────────────────────────────────


class TestOrphanCleanup:
    def test_old_unattached_uploads_and_stray_files_go_recent_and_attached_stay(
        self, cn_tenant, media_root, django_capture_on_commit_callbacks,
    ):
        _, author = soul(cn_tenant, "作者")
        old = uploaded(author)["id"]
        recent = uploaded(author)["id"]
        attached = post_with_images(author, 1)["media"][0]["id"]
        PostMedia.objects.filter(pk__in=[old, attached]).update(created_at=timezone.now() - timedelta(hours=25))
        stray = media_root / "private" / "post_media" / "2026" / "01" / "stray.png"
        stray.parent.mkdir(parents=True)
        stray.write_bytes(b"x")
        os.utime(stray, (0, 0))
        assert len(stored(media_root)) == 4

        out = io.StringIO()
        call_command("cleanup_orphan_post_media", "--dry-run", stdout=out)
        assert "would delete 1 orphan image(s) and 1 unreferenced file(s)" in out.getvalue()
        assert len(stored(media_root)) == 4

        out = io.StringIO()
        with django_capture_on_commit_callbacks(execute=True):
            call_command("cleanup_orphan_post_media", stdout=out)
        assert "deleted 1 orphan image(s) and 1 unreferenced file(s)" in out.getvalue()
        assert set(PostMedia.all_objects.values_list("pk", flat=True)) == {
            PostMedia.objects.get(pk=recent).pk, PostMedia.objects.get(pk=attached).pk,
        }
        assert len(stored(media_root)) == 2 and not stray.exists()

        out = io.StringIO()
        call_command("cleanup_orphan_post_media", stdout=out)
        assert "deleted 0 orphan image(s) and 0 unreferenced file(s)" in out.getvalue()
