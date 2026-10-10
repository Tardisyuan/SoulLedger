"""`POST /notifications/batch-read/` and `/batch-delete/` (Design batch 15, C2).

The inbox is the caller's own: a batch that names someone else's id (same hall
or another) neither errors nor touches it, and the response counts only what
really changed.
"""
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.notifications.models import UserNotification
from apps.tenants.models import Tenant

User = get_user_model()
READ = "/api/v1/notifications/batch-read/"
DELETE = "/api/v1/notifications/batch-delete/"


def _client(user):
    token = RefreshToken.for_user(user)
    token["tenant_code"] = user.tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def inbox(db):
    cn = Tenant.objects.get_or_create(code="NB_A", defaults={"display_name": "A"})[0]
    eg = Tenant.objects.get_or_create(code="NB_B", defaults={"display_name": "B"})[0]
    me = User.objects.create_user(username="nb_me", password="x", role="JUDGE", tenant=cn)
    peer = User.objects.create_user(username="nb_peer", password="x", role="JUDGE", tenant=cn)
    far = User.objects.create_user(username="nb_far", password="x", role="JUDGE", tenant=eg)

    def make(user, n, **kw):
        return [UserNotification.objects.create(user=user, title=f"t{i}", message="m", **kw) for i in range(n)]

    return {
        "client": _client(me), "mine": make(me, 3), "peer": make(peer, 1), "far": make(far, 1),
        "read": make(me, 1, is_read=True),
    }


def _ids(*groups):
    return [n.pk for g in groups for n in g]


def test_batch_read_marks_only_my_unread_rows(inbox):
    response = inbox["client"].post(
        READ, {"ids": _ids(inbox["mine"][:2], inbox["read"], inbox["peer"], inbox["far"]) + [999999]}, format="json"
    )
    assert response.status_code == 200
    assert response.json() == {"marked_read": 2}  # the already-read one is not counted
    assert [UserNotification.objects.get(pk=n.pk).is_read for n in inbox["mine"]] == [True, True, False]
    assert not UserNotification.objects.get(pk=inbox["peer"][0].pk).is_read
    assert not UserNotification.objects.get(pk=inbox["far"][0].pk).is_read


def test_batch_delete_removes_only_my_rows_and_reports_the_real_count(inbox):
    response = inbox["client"].post(
        DELETE, {"ids": _ids(inbox["mine"][:2], inbox["peer"], inbox["far"]) + [999999]}, format="json"
    )
    assert response.status_code == 200
    assert response.json() == {"deleted": 2}
    remaining = set(UserNotification.objects.values_list("pk", flat=True))
    assert not remaining & set(_ids(inbox["mine"][:2]))
    assert {inbox["peer"][0].pk, inbox["far"][0].pk, inbox["mine"][2].pk} <= remaining
    # soft delete, like DELETE /notifications/{id}/
    assert UserNotification.all_objects.get(pk=inbox["mine"][0].pk).is_deleted


def test_batch_ids_are_validated_and_capped(inbox):
    for url in (READ, DELETE):
        assert inbox["client"].post(url, {"ids": []}, format="json").status_code == 400
        assert inbox["client"].post(url, {"ids": list(range(1, 102))}, format="json").status_code == 400
        assert inbox["client"].post(url, {"ids": ["x"]}, format="json").status_code == 400
        assert inbox["client"].post(url, {"ids": list(range(1, 101))}, format="json").status_code == 200


def test_batch_needs_a_login(db):
    assert APIClient().post(DELETE, {"ids": [1]}, format="json").status_code in (401, 403)
