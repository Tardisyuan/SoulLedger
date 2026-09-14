"""Avatars are uploaded to this site, never linked from elsewhere (user decision, 2026-09-14).

Before: two avatars. `User.avatar` was an ImageField nothing could write, and
`UserProfile.avatar_url` was a free-text URL the social profile form filled in
and `ProfileCard` put straight into `<img src>`. Production CSP is
`img-src 'self' data:`, so every such avatar was blocked in the browser — and
where it was not, it was a tracking pixel on whatever host the user named.

Now: one avatar, `User.avatar`, written only through
`POST /api/v1/social/profiles/me/avatar/`. The upload is decoded with Pillow and
re-encoded, so what lands on disk is pixels this server produced — not the bytes
the client sent, not its EXIF, not its file name.

The on-disk half (`/media/` actually serving the file, and serving nothing
else) is in `tests/test_debug_does_not_serve_the_source_tree.py`: it needs
DEBUG at URLconf import time, which only a subprocess gives.
"""
import io
import os

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image
from rest_framework import status

from apps.social.models import UserProfile

URL = "/api/v1/social/profiles/me/avatar/"


@pytest.fixture(autouse=True)
def media_root(settings, tmp_path):
    settings.MEDIA_ROOT = str(tmp_path / "media")
    return tmp_path / "media"


def _image_bytes(fmt="PNG", size=(64, 64), exif=None, noise=False):
    if noise:
        img = Image.frombytes("RGB", size, os.urandom(size[0] * size[1] * 3))
    else:
        img = Image.new("RGB", size, (200, 30, 30))
    buf = io.BytesIO()
    kwargs = {"exif": exif} if exif is not None else {}
    img.save(buf, fmt, **kwargs)
    return buf.getvalue()


def _upload(client, content, name="me.png", content_type="image/png"):
    return client.post(
        URL, {"avatar": SimpleUploadedFile(name, content, content_type=content_type)},
        format="multipart",
    )


def _stored_files(root):
    return [p for p in root.rglob("*") if p.is_file()] if root.exists() else []


@pytest.mark.django_db
class TestAccepted:
    def test_a_png_is_stored_under_media_and_returned_as_the_profile_avatar(
        self, auth_client, user, media_root
    ):
        resp = _upload(auth_client, _image_bytes("PNG"), name="holiday photo.png")
        assert resp.status_code == status.HTTP_200_OK, resp.data
        user.refresh_from_db()
        assert user.avatar.name.startswith("avatars/")
        files = _stored_files(media_root)
        assert len(files) == 1
        # The client's file name is not used — not even as a prefix.
        assert "holiday" not in files[0].name
        assert files[0].suffix == ".png"
        assert resp.data["avatar"].endswith(f"/media/{user.avatar.name}")
        # Pillow can open what was written: it is an image, not the raw upload.
        with Image.open(files[0]) as img:
            assert img.format == "PNG"

    def test_a_jpeg_loses_its_exif(self, auth_client, media_root):
        exif = Image.Exif()
        exif[0x010F] = "CameraMaker"  # Make
        exif[0x8825] = {2: (1.0, 2.0, 3.0)}  # GPSInfo
        raw = _image_bytes("JPEG", exif=exif.tobytes())
        with Image.open(io.BytesIO(raw)) as check:
            assert check.getexif(), "precondition: the upload carries EXIF"
        resp = _upload(auth_client, raw, name="a.jpg", content_type="image/jpeg")
        assert resp.status_code == status.HTTP_200_OK, resp.data
        (stored,) = _stored_files(media_root)
        assert stored.suffix == ".jpg"
        with Image.open(stored) as img:
            assert not img.getexif(), "EXIF survived the upload"
        assert b"CameraMaker" not in stored.read_bytes()

    def test_replacing_an_avatar_removes_the_old_file(self, auth_client, media_root):
        assert _upload(auth_client, _image_bytes("PNG")).status_code == 200
        (first,) = _stored_files(media_root)
        assert _upload(auth_client, _image_bytes("PNG")).status_code == 200
        (second,) = _stored_files(media_root)
        assert first != second
        assert not first.exists()

    def test_me_shows_the_uploaded_avatar(self, auth_client, user):
        _upload(auth_client, _image_bytes("PNG"))
        user.refresh_from_db()
        resp = auth_client.get("/api/v1/social/profiles/me/")
        assert resp.data["avatar"].endswith(f"/media/{user.avatar.name}")


@pytest.mark.django_db
class TestRejected:
    def assert_rejected(self, resp, user, media_root):
        assert resp.status_code == status.HTTP_400_BAD_REQUEST, resp.data
        user.refresh_from_db()
        assert not user.avatar
        assert _stored_files(media_root) == []

    def test_a_text_file(self, auth_client, user, media_root):
        resp = _upload(auth_client, b"just some words", name="notes.txt", content_type="text/plain")
        self.assert_rejected(resp, user, media_root)

    def test_a_text_file_wearing_a_png_name_and_content_type(self, auth_client, user, media_root):
        resp = _upload(auth_client, b"<?php system($_GET['c']); ?>", name="evil.png")
        self.assert_rejected(resp, user, media_root)

    def test_an_svg_wearing_a_png_name(self, auth_client, user, media_root):
        svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
        resp = _upload(auth_client, svg, name="avatar.png")
        self.assert_rejected(resp, user, media_root)

    def test_a_real_image_in_a_format_outside_the_allowlist(self, auth_client, user, media_root):
        resp = _upload(auth_client, _image_bytes("GIF"), name="a.gif", content_type="image/gif")
        self.assert_rejected(resp, user, media_root)

    def test_an_oversized_image(self, auth_client, user, media_root):
        from apps.social.serializers import AVATAR_MAX_BYTES

        raw = _image_bytes("PNG", size=(1400, 1400), noise=True)
        assert len(raw) > AVATAR_MAX_BYTES, "precondition: the upload is over the limit"
        resp = _upload(auth_client, raw)
        self.assert_rejected(resp, user, media_root)

    def test_anonymous(self, user, media_root):
        from rest_framework.test import APIClient

        resp = _upload(APIClient(), _image_bytes("PNG"))
        assert resp.status_code == status.HTTP_401_UNAUTHORIZED
        assert _stored_files(media_root) == []


@pytest.mark.django_db
class TestNoExternalAvatar:
    def test_the_profile_no_longer_has_an_avatar_url(self, auth_client, user):
        profile = UserProfile.objects.create(user=user)
        assert not hasattr(profile, "avatar_url")
        resp = auth_client.get("/api/v1/social/profiles/me/")
        assert "avatar_url" not in resp.data
        assert "avatar" in resp.data and resp.data["avatar"] is None

    def test_patching_a_url_does_not_set_an_avatar(self, auth_client, user):
        profile = UserProfile.objects.create(user=user)
        resp = auth_client.patch(
            f"/api/v1/social/profiles/{profile.pk}/",
            {"avatar_url": "https://tracker.example/pixel.png", "avatar": "https://x.example/a.png"},
            format="json",
        )
        assert resp.status_code == status.HTTP_200_OK
        assert "avatar_url" not in resp.data, "the update endpoint still accepts a link"
        user.refresh_from_db()
        assert not user.avatar

    def test_opening_post_for_the_upload_did_not_open_profile_creation(self, auth_client, user):
        """The viewset now allows POST (for me/avatar/). A ModelViewSet would
        have routed `POST /profiles/` to `create` at the same moment."""
        resp = auth_client.post("/api/v1/social/profiles/", {"bio": "x"}, format="json")
        assert resp.status_code == status.HTTP_405_METHOD_NOT_ALLOWED
        assert not UserProfile.objects.filter(user=user).exists()
