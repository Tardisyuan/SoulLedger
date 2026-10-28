"""`reborn` scopes the soul lookup with `scope_to_tenant`, which fails closed.

The hand-rolled filter before it read `if role != "ADMIN" and user_tenant:` — so a non-ADMIN
whose request carried no tenant was not filtered at all and could reach any hall's soul.
`TenantPermission.has_permission` refuses that caller first today, so this drives the action
with the permission layer removed: the lookup itself must hold on its own.
"""
import pytest
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.reincarnation.views import ReincarnationViewSet
from apps.souls.models import Soul, SoulState
from apps.tenants.models import Tenant

pytestmark = pytest.mark.django_db


def test_a_non_admin_with_no_tenant_cannot_reach_another_halls_soul(django_user_model):
    mine = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "CN"})[0]
    theirs = Tenant.objects.get_or_create(code="EU_HEAVEN", defaults={"display_name": "EU"})[0]
    judge = django_user_model.objects.create_user(username="rb_nt_judge", password="x", role="JUDGE", tenant=mine)
    soul = Soul.objects.create(name="Elsewhere", tenant=theirs, current_state=SoulState.DISPOSED)

    view = ReincarnationViewSet.as_view({"post": "reborn"}, permission_classes=[])
    request = APIRequestFactory().post("/api/v1/reincarnation/reborn/", {"soul_id": str(soul.pk)}, format="json")
    force_authenticate(request, user=judge)  # no token, so no tenant on the request
    response = view(request)

    assert response.status_code == 404, getattr(response, "data", None)
    soul.refresh_from_db()
    assert soul.current_state == SoulState.DISPOSED
