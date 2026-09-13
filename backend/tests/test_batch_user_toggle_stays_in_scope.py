"""BP-17: batch activate/deactivate resolves ids the way the single-user actions do.

Before: `User.objects.filter(id__in=ids, tenant=request.tenant)`. An ADMIN whose
token carries no tenant claim has `request.tenant = None`, so the filter became
`tenant IS NULL` — the set that holds the other ADMINs (and the caller) and
excludes every tenant user the ADMIN actually selected. Measured on the
unfixed code: the other ADMIN and the caller were deactivated, the tenant user
was not, and the response said `updated: 2`.

Boundary now: ids are resolved through `get_queryset()` (the same scope as
`/users/{id}/deactivate/`), and a *batch* never touches an ADMIN-role account
or the caller. Toggling one ADMIN stays possible through the single-user action,
where the id is named on purpose rather than swept up in a selection.
"""
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

User = get_user_model()


def _client_for(user):
    client = APIClient()
    token = RefreshToken.for_user(user)
    if user.tenant:
        token["tenant_code"] = user.tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def people(db, cn_tenant):
    caller = User.objects.create_user(username="bp17_caller", password="x", role="ADMIN", tenant=None)
    other_admin = User.objects.create_user(username="bp17_other_admin", password="x", role="ADMIN", tenant=None)
    member = User.objects.create_user(username="bp17_member", password="x", role="VIEWER", tenant=cn_tenant)
    return caller, other_admin, member


@pytest.mark.django_db
def test_tenantless_admin_batch_deactivate_spares_admins_and_reaches_selected_user(people):
    caller, other_admin, member = people
    resp = _client_for(caller).post(
        "/api/v1/users/batch_deactivate/",
        {"user_ids": [caller.id, other_admin.id, member.id]},
        format="json",
    )
    assert resp.status_code == 200
    for u in people:
        u.refresh_from_db()
    assert other_admin.is_active, "a batch swept another ADMIN out"
    assert caller.is_active, "a batch locked the caller out"
    assert not member.is_active, "the tenant user that was selected was not touched"
    assert resp.data["updated"] == 1


@pytest.mark.django_db
def test_batch_activate_does_not_touch_admins_either(people):
    caller, other_admin, member = people
    User.objects.filter(pk__in=[other_admin.pk, member.pk]).update(is_active=False)
    resp = _client_for(caller).post(
        "/api/v1/users/batch_activate/",
        {"user_ids": [other_admin.id, member.id]},
        format="json",
    )
    assert resp.status_code == 200
    other_admin.refresh_from_db()
    member.refresh_from_db()
    assert not other_admin.is_active
    assert member.is_active
    assert resp.data["updated"] == 1
