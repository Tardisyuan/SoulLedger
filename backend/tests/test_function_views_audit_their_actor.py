"""Function views (`@api_view`) record who did it (security review 2026-10-27 #1).

Only the viewset mixin calls `set_current_user`; the perm endpoints are function
views, so their audit rows were written with `user = NULL`. `get_current_user`
now falls back to the authenticated user of the current request.
"""
import pytest
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.authentication.models import User
from apps.perm.models import Permission, Role
from tests.test_perm_matrix_and_role_table import CHANGES, _cell, world  # noqa: F401


def _last_pk():
    return AuditLog.objects.order_by("-pk").values_list("pk", flat=True).first() or 0


def _actors_since(before):
    return [(r.action, r.user_id) for r in AuditLog.objects.filter(pk__gt=before)]


@pytest.mark.django_db
def test_a_matrix_save_names_the_admin(world, django_capture_on_commit_callbacks):  # noqa: F811
    p = world["perms"]
    before = _last_pk()
    with django_capture_on_commit_callbacks(execute=True):
        r = world["client"].post(CHANGES, {"changes": [_cell("SCRIBE", p["ledger.manage"], "grant")]}, format="json")
    assert r.status_code == 200, r.content
    rows = _actors_since(before)
    assert rows, "the save wrote no audit row"
    assert all(uid == world["admin"].pk for _, uid in rows), rows


@pytest.mark.django_db
def test_create_role_and_delete_permission_name_the_admin(world, django_capture_on_commit_callbacks):  # noqa: F811
    client, admin = world["client"], world["admin"]
    before = _last_pk()
    with django_capture_on_commit_callbacks(execute=True):
        assert client.post("/api/v1/perm/roles/create/", {"name": "CLERK", "display_name": "文书"},
                           format="json").status_code == 201
        assert client.delete(f"/api/v1/perm/permissions/{world['perms']['ledger.read'].pk}/").status_code == 204
    assert Role.objects.filter(name="CLERK").exists()
    assert not Permission.objects.filter(codename="ledger.read").exists()
    rows = _actors_since(before)
    assert rows
    assert all(uid == admin.pk for _, uid in rows), rows


@pytest.mark.django_db
def test_a_real_jwt_request_is_attributed_too(world, django_capture_on_commit_callbacks):  # noqa: F811
    from rest_framework_simplejwt.tokens import RefreshToken

    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(world['admin']).access_token}")
    before = _last_pk()
    with django_capture_on_commit_callbacks(execute=True):
        r = client.post("/api/v1/perm/roles/create/", {"name": "CLERK_JWT", "display_name": "文书"}, format="json")
    assert r.status_code == 201, r.content
    rows = _actors_since(before)
    assert rows
    assert all(uid == world["admin"].pk for _, uid in rows), rows


@pytest.mark.django_db
def test_an_anonymous_request_is_not_an_actor(db):
    from django.contrib.auth.models import AnonymousUser
    from django.test import RequestFactory

    from apps.core.request_local import clear_current_user, get_current_user, set_current_request

    req = RequestFactory().get("/")
    req.user = AnonymousUser()
    set_current_request(req)
    try:
        assert get_current_user() is None
        req.user = User.objects.create_user(username="fv_u", password="x")
        assert get_current_user() == req.user
    finally:
        clear_current_user()
