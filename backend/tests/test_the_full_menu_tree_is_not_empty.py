"""`GET /menus/all/` must return the tree, not the trunk.

WHY THIS FILE EXISTS. `MenuSerializer` resolves `children` and `buttons`
through `self.context` — `_caller()` reads `context["user"]`, then
`context["request"].user`, and both `get_children` and `get_buttons` fail
**closed**, returning `[]` when neither yields an authenticated caller.

`MenuViewSet.all` was the one call site of three that instantiated the
serializer bare: `MenuSerializer(menus, many=True)`, no context. So the ADMIN
"full resource tree" endpoint — the one whose entire purpose is to show every
menu with its buttons — returned every menu with `children: []` and
`buttons: []`, and a client could not distinguish that from "this menu has no
buttons".

WHY THE EXISTING TESTS DID NOT SEE IT. `apps/menus/tests.py::test_all_admin`
asserted `status == 200` and `len(resp.data) >= 1`; `tests/test_menu_api.py::
test_get_all_menus` asserted only the status. Both counted the *top-level*
menus, which were correct — the empty arrays hang off each of them. They stayed
green before the fix and stay green after, which is the definition of an
assertion that is not doing any work.

So what is asserted below is the nested content, and the sibling endpoint is
asserted alongside it: `/menus/tree/` already passed its context, so any change
that "fixes" `all` by loosening `_caller()` instead — making the serializer
fail open rather than supplying the caller — would break the guarantee `tree`
depends on, and the second test is what would notice.
"""

import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.menus.models import Menu, MenuButton
from apps.tenants.models import Tenant

User = get_user_model()


def _jwt_client(user, tenant):
    client = APIClient()
    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def tenant(db):
    return Tenant.objects.get_or_create(
        code="MENU_TREE_T1", defaults={"display_name": "Menu Tree Tenant"}
    )[0]


@pytest.fixture
def admin(db, tenant):
    return User.objects.create_user(
        username="menu_tree_admin", password="x", role="ADMIN", tenant=tenant
    )


@pytest.fixture
def parent_with_descendants(db):
    """One parent menu carrying one visible child and one visible button."""
    parent = Menu.objects.create(
        name="Governance", path="/governance", roles=["ADMIN"], order=1
    )
    Menu.objects.create(
        name="Statutes", path="/governance/statutes", parent=parent,
        roles=["ADMIN"], order=1,
    )
    # `permission=""` so `button_is_visible_to` turns on the menu's visibility
    # alone. An ADMIN is a menu admin and short-circuits to True anyway, but a
    # button gated on a codename nobody seeded would be invisible for a reason
    # that has nothing to do with what this file is testing.
    MenuButton.objects.create(
        menu=parent, name="Amend", code="governance.amend", permission="", order=1
    )
    return parent


def test_all_returns_children_and_buttons(db, tenant, admin, parent_with_descendants):
    """The ADMIN full-tree endpoint carries the tree."""
    response = _jwt_client(admin, tenant).get("/api/v1/menus/all/")
    assert response.status_code == 200

    row = next(
        (m for m in response.data if m["id"] == parent_with_descendants.id), None
    )
    assert row is not None, "the parent menu itself is missing from /menus/all/"

    assert [c["name"] for c in row["children"]] == ["Statutes"], (
        "children came back empty. The menu has one active child visible to "
        "ADMIN, so an empty list here means the serializer never saw a caller "
        "— which is what happens when it is built without context."
    )
    assert [b["code"] for b in row["buttons"]] == ["governance.amend"], (
        "buttons came back empty on the endpoint whose stated purpose is to "
        "show them."
    )


def test_tree_still_carries_children_and_buttons(
    db, tenant, admin, parent_with_descendants
):
    """The sibling endpoint keeps its guarantee.

    `/menus/tree/` already passed context and was already correct. It is
    asserted here so that "fix" cannot mean loosening `_caller()` to fail open:
    that would make the test above pass while removing the fail-closed
    behaviour both endpoints rely on.
    """
    response = _jwt_client(admin, tenant).get("/api/v1/menus/tree/")
    assert response.status_code == 200

    row = next(
        (m for m in response.data if m["id"] == parent_with_descendants.id), None
    )
    assert row is not None
    assert [c["name"] for c in row["children"]] == ["Statutes"]
    assert [b["code"] for b in row["buttons"]] == ["governance.amend"]
