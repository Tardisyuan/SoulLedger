"""官员朋友圈的配图(2026-10-02 用户决定:官员也能发图;官员流仍不含灵魂帖子)。

与灵魂端(tests/test_soul_social_media.py)同一套存储、校验、签名地址;这里只测官员这一面
多出来的东西:上传入口、挂到官员帖子、三个序列化器带 `media`、取文件时按**官员动态流**
的可见性重查(租户 + 四档),以及作者删帖时文件真删。访问一律按取文件的地址测。
"""
import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

from apps.social import media as post_media
from apps.social.models import Post, PostMedia, Visibility
from apps.social.services import FollowService
from tests.soul_social_support import officer_client, soul
from tests.test_soul_social_media import fetch, image_bytes, stored
from tests.test_soul_social_media import post_with_images as soul_post_with_images

pytestmark = pytest.mark.django_db
SOCIAL = "/api/v1/social"


@pytest.fixture(autouse=True)
def media_root(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path / "media")
    return tmp_path / "media"


def officer(django_user_model, tenant, name, role="JUDGE"):
    # 不用 ADMIN:它跨租户,拿它测隔离测到的是豁免。
    return django_user_model.objects.create(username=name, role=role, tenant=tenant)


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
        f"{SOCIAL}/posts/", {"content": content, "visibility": visibility, "media": media_ids}, format="json",
    )


def post_with_images(client, n=2, **kw):
    ids = [uploaded(client)["id"] for _ in range(n)]
    res = create_post(client, ids, **kw)
    assert res.status_code == 201, res.content
    return res.json()["id"], ids


def detail_urls(client, post_id):
    res = client.get(f"{SOCIAL}/posts/{post_id}/")
    assert res.status_code == 200, res.content
    return [m["url"] for m in res.json()["media"]]


@pytest.fixture
def cn_a(django_user_model, cn_tenant):
    return officer(django_user_model, cn_tenant, "cn_officer_a")


@pytest.fixture
def cn_b(django_user_model, cn_tenant):
    return officer(django_user_model, cn_tenant, "cn_officer_b")


@pytest.fixture
def eu_a(django_user_model, eu_tenant):
    return officer(django_user_model, eu_tenant, "eu_officer_a")


class TestUpload:
    def test_an_officer_upload_is_reencoded_without_exif_and_stored_privately(self, cn_a, media_root):
        exif = Image.Exif()
        exif[0x010F] = "CameraMaker"
        body = uploaded(officer_client(cn_a), content=image_bytes("JPEG", exif=exif.tobytes()),
                        name="holiday.jpg", content_type="image/jpeg")
        assert (body["content_type"], body["width"], body["height"]) == ("image/jpeg", 64, 48)
        assert body["url"].startswith(f"/api/v1/social-media/{body['id']}/?t=")
        (f,) = stored(media_root)
        assert str(f.relative_to(media_root)).startswith("private/post_media/")
        assert "holiday" not in f.name
        with Image.open(f) as img:
            assert not img.getexif()
        assert fetch(body["url"])[0] == 200  # 还没挂帖:上传者本人看得见

    def test_a_non_image_is_refused_with_the_same_code(self, cn_a, media_root):
        res = upload(officer_client(cn_a), content=b"<?php ?>", name="a.png")
        assert (res.status_code, res.json()["code"]) == (400, "not_an_image")
        assert stored(media_root) == []

    def test_a_missing_file_is_400(self, cn_a):
        res = officer_client(cn_a).post(f"{SOCIAL}/media/", {}, format="multipart")
        assert (res.status_code, res.json()["code"]) == (400, "file_required")

    def test_pending_uploads_are_capped(self, cn_a, monkeypatch):
        monkeypatch.setattr(post_media, "MAX_PENDING", 1)
        client = officer_client(cn_a)
        uploaded(client)
        res = upload(client)
        assert (res.status_code, res.json()["code"]) == (409, "too_many_pending")

    def test_limits_come_from_the_backend(self, cn_a, monkeypatch):
        monkeypatch.setattr(post_media, "MAX_PER_POST", 4)
        res = officer_client(cn_a).get(f"{SOCIAL}/media/")
        assert res.status_code == 200
        assert res.json()["max_per_post"] == 4

    def test_anonymous_and_soul_tokens_are_refused(self, cn_tenant, media_root):
        from rest_framework.test import APIClient

        assert upload(APIClient()).status_code == 401
        _, soul_client = soul(cn_tenant, "灵魂")
        assert upload(soul_client).status_code in (401, 403)
        assert stored(media_root) == []

    def test_a_pending_upload_is_removable_by_its_uploader_only(self, cn_a, cn_b, media_root,
                                                                django_capture_on_commit_callbacks):
        mine = uploaded(officer_client(cn_a))
        assert officer_client(cn_b).delete(f"{SOCIAL}/media/{mine['id']}/").status_code == 404
        assert fetch(post_media.signed_url(PostMedia.objects.get(pk=mine["id"]), cn_b))[0] == 404
        with django_capture_on_commit_callbacks(execute=True):
            assert officer_client(cn_a).delete(f"{SOCIAL}/media/{mine['id']}/").status_code == 204
        assert stored(media_root) == []


class TestAttachAndSerialize:
    def test_list_detail_and_feed_carry_ordered_signed_media(self, cn_a, cn_b):
        author = officer_client(cn_a)
        ids = [uploaded(author)["id"] for _ in range(3)]
        ids.reverse()
        # PUBLIC:关注流只收 PUBLIC / FOLLOWERS(PostViewSet.feed)。
        res = create_post(author, ids, visibility=Visibility.PUBLIC)
        assert res.status_code == 201, res.content
        post_id = res.json()["id"]

        reader = officer_client(cn_b)
        FollowService.follow(cn_b, cn_a, cn_a.tenant)
        rows = {
            "list": next(p for p in reader.get(f"{SOCIAL}/posts/").json()["results"] if p["id"] == post_id),
            "detail": reader.get(f"{SOCIAL}/posts/{post_id}/").json(),
            "feed": next(p for p in reader.get(f"{SOCIAL}/posts/feed/").json()["results"] if p["id"] == post_id),
        }
        for where, row in rows.items():
            assert [m["id"] for m in row["media"]] == ids, where
            assert {(m["width"], m["height"]) for m in row["media"]} == {(64, 48)}, where
            status, content = fetch(row["media"][0]["url"])
            assert (status, content[:8]) == (200, b"\x89PNG\r\n\x1a\n"), where

    def test_a_text_only_post_has_an_empty_media_list(self, cn_a):
        client = officer_client(cn_a)
        res = create_post(client, [], content="只有字")
        assert res.status_code == 201, res.content
        assert client.get(f"{SOCIAL}/posts/{res.json()['id']}/").json()["media"] == []

    def test_images_alone_make_a_post_but_nothing_does_not(self, cn_a):
        client = officer_client(cn_a)
        assert create_post(client, [uploaded(client)["id"]], content="").status_code == 201
        res = create_post(client, [], content="  ")
        assert res.status_code == 400 and "content" in res.json()

    def test_more_than_the_limit_is_refused_and_no_post_is_created(self, cn_a, monkeypatch):
        monkeypatch.setattr(post_media, "MAX_PER_POST", 2)
        client = officer_client(cn_a)
        ids = [uploaded(client)["id"] for _ in range(3)]
        res = create_post(client, ids)
        assert res.status_code == 400 and "media" in res.json()
        assert not Post.objects.filter(author=cn_a).exists()
        assert PostMedia.objects.filter(post__isnull=True).count() == 3

    def test_someone_elses_upload_cannot_be_attached(self, cn_a, cn_b):
        theirs = uploaded(officer_client(cn_b))["id"]
        res = create_post(officer_client(cn_a), [theirs])
        assert res.status_code == 400 and "media" in res.json()
        assert not Post.objects.filter(author=cn_a).exists()

    def test_an_image_cannot_be_attached_twice(self, cn_a):
        client = officer_client(cn_a)
        _, ids = post_with_images(client, 1)
        assert create_post(client, ids).status_code == 400


class TestFileAccess:
    def test_another_tenant_cannot_fetch_even_a_public_post_or_attach(self, cn_a, eu_a):
        post_id, ids = post_with_images(officer_client(cn_a), 1, visibility=Visibility.PUBLIC)
        row = PostMedia.objects.get(pk=ids[0])
        assert fetch(post_media.signed_url(row, cn_a))[0] == 200
        assert fetch(post_media.signed_url(row, eu_a))[0] == 404
        assert officer_client(eu_a).get(f"{SOCIAL}/posts/{post_id}/").status_code == 404
        cn_pending = uploaded(officer_client(cn_a))["id"]
        assert create_post(officer_client(eu_a), [cn_pending]).status_code == 400

    @pytest.mark.parametrize("visibility,b_follows,b_sees", [
        (Visibility.TENANT, False, True),
        (Visibility.PRIVATE, False, False),
        (Visibility.FOLLOWERS, False, False),
        (Visibility.FOLLOWERS, True, True),
    ])
    def test_visibility_tiers_reach_the_file(self, cn_a, cn_b, visibility, b_follows, b_sees):
        if b_follows:
            FollowService.follow(cn_b, cn_a, cn_a.tenant)
        _, ids = post_with_images(officer_client(cn_a), 1, visibility=visibility)
        row = PostMedia.objects.get(pk=ids[0])
        assert fetch(post_media.signed_url(row, cn_a))[0] == 200
        assert fetch(post_media.signed_url(row, cn_b))[0] == (200 if b_sees else 404)

    def test_an_earlier_url_dies_when_the_post_turns_private(self, cn_a, cn_b):
        post_id, _ = post_with_images(officer_client(cn_a), 1)
        url = detail_urls(officer_client(cn_b), post_id)[0]
        assert fetch(url)[0] == 200
        Post.objects.filter(pk=post_id).update(visibility=Visibility.PRIVATE)
        assert fetch(url)[0] == 404

    def test_an_expired_url_is_404(self, cn_a, monkeypatch):
        post_id, _ = post_with_images(officer_client(cn_a), 1)
        url = detail_urls(officer_client(cn_a), post_id)[0]
        assert fetch(url)[0] == 200
        monkeypatch.setattr(post_media, "URL_TTL", -1)
        assert fetch(url)[0] == 404

    def test_a_deactivated_officer_gets_nothing(self, cn_a, cn_b):
        post_id, _ = post_with_images(officer_client(cn_a), 1)
        url = detail_urls(officer_client(cn_b), post_id)[0]
        type(cn_b).objects.filter(pk=cn_b.pk).update(is_active=False)
        assert fetch(url)[0] == 404

    def test_the_author_deleting_the_post_really_deletes_the_files(
        self, cn_a, media_root, django_capture_on_commit_callbacks,
    ):
        client = officer_client(cn_a)
        post_id, _ = post_with_images(client, 2)
        url = detail_urls(client, post_id)[0]
        assert len(stored(media_root)) == 2
        with django_capture_on_commit_callbacks(execute=True):
            assert client.delete(f"{SOCIAL}/posts/{post_id}/").status_code == 204
        assert fetch(url)[0] == 404
        assert stored(media_root) == [] and not PostMedia.all_objects.exists()


class TestSoulPostsStayOut:
    def test_the_officer_feed_still_has_no_soul_post_and_its_image_is_not_served_by_this_path(
        self, cn_tenant, cn_a,
    ):
        _, soul_client = soul(cn_tenant, "作者")
        body = soul_post_with_images(soul_client, 1, visibility=Visibility.PUBLIC)
        ids = [p["id"] for p in officer_client(cn_a).get(f"{SOCIAL}/posts/").json()["results"]]
        assert body["id"] not in ids
        # JUDGE 不持有 social.moderate:灵魂帖子的图对他不经官员动态流这条路放行。
        row = PostMedia.objects.get(pk=body["media"][0]["id"])
        assert fetch(post_media.signed_url(row, cn_a))[0] == 404


def client_in(user, tenant):
    """令牌里的租户是 `tenant`,不是 `user.tenant` —— `request.tenant` 来自令牌(TenantMiddleware)。"""
    from rest_framework.test import APIClient
    from rest_framework_simplejwt.tokens import RefreshToken

    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


class TestTheFileIsJudgedInTheListRequestsTenant:
    """2026-10-02:取文件时的可见性在**签发地址那次请求**的租户里判,而不是查看者自己的租户。
    此前 ADMIN 在 X 文明的上下文里看得见 X 的「本域可见」帖子,图却 404。"""

    @pytest.fixture
    def admin(self, django_user_model):
        return django_user_model.objects.create(username="global_admin", role="ADMIN", tenant=None)

    def test_an_admin_in_another_tenant_opens_that_tenants_tenant_visible_images(self, admin, cn_a, cn_tenant):
        post_id, ids = post_with_images(officer_client(cn_a), 1, visibility=Visibility.TENANT)
        res = client_in(admin, cn_tenant).get(f"{SOCIAL}/posts/")
        row = next(p for p in res.json()["results"] if p["id"] == post_id)
        assert [m["id"] for m in row["media"]] == ids
        assert fetch(row["media"][0]["url"])[0] == 200
        # 同一张图不带租户签发(退回 ADMIN 自己的租户:没有)→ 404。上面的 200 来自签名里的租户。
        assert fetch(post_media.signed_url(PostMedia.objects.get(pk=ids[0]), admin))[0] == 404

    def test_an_officer_of_another_tenant_cannot_borrow_the_tenant_in_the_signature(self, cn_a, eu_a, cn_tenant):
        _, ids = post_with_images(officer_client(cn_a), 1, visibility=Visibility.TENANT)
        row = PostMedia.objects.get(pk=ids[0])
        assert fetch(post_media.signed_url(row, eu_a, cn_tenant))[0] == 404
        assert fetch(post_media.signed_url(row, eu_a, eu_a.tenant))[0] == 404

    def test_an_officer_moved_after_signing_loses_the_old_url(self, cn_a, cn_b, eu_tenant):
        post_id, _ = post_with_images(officer_client(cn_a), 1, visibility=Visibility.TENANT)
        url = detail_urls(officer_client(cn_b), post_id)[0]
        assert fetch(url)[0] == 200
        type(cn_b).objects.filter(pk=cn_b.pk).update(tenant=eu_tenant)
        assert fetch(url)[0] == 404

    def test_soul_posts_stay_out_of_the_admins_officer_feed(self, admin, cn_tenant):
        _, soul_client = soul(cn_tenant, "作者")
        body = soul_post_with_images(soul_client, 1, visibility=Visibility.PUBLIC)
        ids = [p["id"] for p in client_in(admin, cn_tenant).get(f"{SOCIAL}/posts/").json()["results"]]
        assert body["id"] not in ids

