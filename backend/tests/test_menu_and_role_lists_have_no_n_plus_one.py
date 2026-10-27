"""`/menus/tree/` and `/perm/roles/` cost the same number of queries at 3 rows or 30.

Mutation: `.filter(is_active=True)` back on `obj.buttons` in MenuTreeSerializer, or
`user_count` back to its per-row `.count()`, and the second count grows -> red.
"""
import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework_simplejwt.tokens import RefreshToken

from apps.authentication.models import User
from apps.menus.models import Menu, MenuButton
from apps.perm.models import Role

pytestmark = pytest.mark.django_db


@pytest.fixture
def admin_client(api_client, admin_user, cn_tenant):
    token = RefreshToken.for_user(admin_user)
    if admin_user.tenant:
        token["tenant_code"] = admin_user.tenant.code
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return api_client


def _queries(client, url):
    client.get(url)  # warm-up: the first request also fills TenantMiddleware's per-worker hall copy
    with CaptureQueriesContext(connection) as ctx:
        response = client.get(url)
    assert response.status_code == 200
    return len(ctx), response


def test_menu_tree_query_count_does_not_grow_with_menus(admin_client):
    def add(n):
        for i in range(n):
            top = Menu.objects.create(name=f"T{n}-{i}", path=f"/t{n}-{i}", order=900 + i, is_active=True)
            child = Menu.objects.create(name=f"C{n}-{i}", path=f"/c{n}-{i}", order=1, parent=top, is_active=True)
            for menu in (top, child):
                MenuButton.objects.create(menu=menu, name="b", code=f"b{menu.pk}", permission="", order=1)
                MenuButton.objects.create(menu=menu, name="off", code=f"o{menu.pk}", permission="",
                                          order=2, is_active=False)

    add(2)
    few, _ = _queries(admin_client, "/api/v1/menus/tree/")
    add(20)
    many, response = _queries(admin_client, "/api/v1/menus/tree/")
    assert many == few
    top = next(m for m in response.data if m["name"] == "T20-0")
    assert [b["name"] for b in top["buttons"]] == ["b"]  # inactive button still filtered out


def test_role_list_query_count_does_not_grow_with_roles(admin_client, django_user_model):
    def add(n):
        for i in range(n):
            role = Role.objects.create(name=f"R{n}X{i}"[:20], display_name="r")
            User.objects.create_user(username=f"u{role.name}", password="x", role=role.name, is_active=True)
            User.objects.create_user(username=f"v{role.name}", password="x", role=role.name, is_active=False)

    add(2)
    few, _ = _queries(admin_client, "/api/v1/perm/roles/")
    add(20)
    many, response = _queries(admin_client, "/api/v1/perm/roles/")
    assert many == few
    row = next(r for r in response.data if r["name"] == "R20X0")
    assert (row["user_count"], row["member_count"]) == (1, 2)  # active only vs all
