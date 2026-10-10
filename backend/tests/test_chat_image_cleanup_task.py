"""`chat.cleanup_unsent_images`: the daily sweep of letter images uploaded and never sent.

Before it, an unsent image was only swept by the same account's next upload; an account that never
came back left up to four files per conversation for good. The task deletes every unsent image older
than `images.STALE_AFTER` (row, then file after commit) and never touches a sent one.
"""
from datetime import timedelta
from unittest import mock

import pytest
from django.utils import timezone

from apps.chat.models import ChatImage
from apps.chat.tasks import cleanup_unsent_images
from tests.chat_support import matrix  # noqa: F401
from tests.test_chat_images import hall, media_root, send, stored, uploaded  # noqa: F401

pytestmark = pytest.mark.django_db


def _age(image_id, hours):
    ChatImage.objects.filter(pk=image_id).update(created_at=timezone.now() - timedelta(hours=hours))


def _sweep(capture):
    with capture(execute=True):
        return cleanup_unsent_images()


def test_an_unsent_expired_image_loses_its_row_and_its_file(hall, media_root, django_capture_on_commit_callbacks):  # noqa: F811
    _, client, cid = hall
    old = uploaded(client, cid)["id"]
    _age(old, 25)
    assert len(stored(media_root)) == 1
    assert _sweep(django_capture_on_commit_callbacks) == {"deleted": 1}
    assert not ChatImage.objects.filter(pk=old).exists()
    assert stored(media_root) == []


def test_an_unexpired_unsent_image_stays(hall, media_root, django_capture_on_commit_callbacks):  # noqa: F811
    _, client, cid = hall
    fresh = uploaded(client, cid)["id"]
    _age(fresh, 23)
    assert _sweep(django_capture_on_commit_callbacks) == {"deleted": 0}
    assert ChatImage.objects.filter(pk=fresh).exists() and len(stored(media_root)) == 1


def test_a_sent_image_stays_however_old(hall, matrix, media_root, django_capture_on_commit_callbacks):  # noqa: F811
    _, client, cid = hall
    sent = uploaded(client, cid)["id"]
    assert send(client, sent).status_code == 201
    _age(sent, 24 * 90)
    assert _sweep(django_capture_on_commit_callbacks) == {"deleted": 0}
    assert ChatImage.objects.filter(pk=sent).exists() and len(stored(media_root)) == 1


def test_one_file_that_cannot_be_deleted_does_not_keep_the_rest(hall, media_root, django_capture_on_commit_callbacks, caplog):  # noqa: F811
    _, client, cid = hall
    first, second = uploaded(client, cid)["id"], uploaded(client, cid)["id"]
    for i in (first, second):
        _age(i, 25)
    from django.core.files.storage import FileSystemStorage

    real = FileSystemStorage.delete
    calls = []

    def flaky(self, name):
        calls.append(name)
        if len(calls) == 1:
            raise OSError("disk says no")
        return real(self, name)

    with mock.patch.object(FileSystemStorage, "delete", flaky):
        result = _sweep(django_capture_on_commit_callbacks)
    assert result == {"deleted": 2} and not ChatImage.objects.exists()
    assert len(calls) == 2 and len(stored(media_root)) == 1  # the second was still deleted
    assert "could not delete chat image file" in caplog.text
