"""A menu in the recycle bin is not listed as a child, to anyone.

`Menu._default_manager` is the unfiltered `all_objects`, so the reverse
`children` manager and the prefetch built on it yield soft-deleted rows.
Measured 2026-09-17 on main: `/menus/` (what the sidebar calls) and
`/menus/list-public/` listed a binned child to ADMIN and VIEWER; `/menus/tree/`
builds its own map from the filtered manager and was already clean.
"""
import pytest
from rest_framework_simplejwt.tokens import RefreshToken

from apps.menus.models import Menu

MENU_EXITS = ("/api/v1/menus/", "/api/v1/menus/tree/", "/api/v1/menus/list-public/")


def _names(payload):
    rows = payload.get("results", payload) if isinstance(payload, dict) else payload
    out = set()

    def walk(items):
        for item in items:
            out.add(item["name"])
            walk(item.get("children") or [])

    walk(rows)
    return out


@pytest.mark.django_db
@pytest.mark.parametrize("who", ["admin_user", "viewer_user"])
@pytest.mark.parametrize("exit_url", MENU_EXITS)
def test_a_binned_child_is_not_listed(api_client, request, who, exit_url):
    user = request.getfixturevalue(who)
    directory = Menu.objects.create(name="probe-dir", menu_type="DIRECTORY", roles=[], order=1)
    Menu.objects.create(name="probe-live", path="/probe-live", parent=directory, roles=[], order=1)
    Menu.objects.create(name="probe-gone", path="/probe-gone", parent=directory, roles=[], order=2).soft_delete()

    token = RefreshToken.for_user(user)
    if user.tenant:
        token["tenant_code"] = user.tenant.code
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    names = _names(api_client.get(exit_url).json())

    assert "probe-live" in names  # the walk is not vacuous
    assert "probe-gone" not in names, f"{who} {exit_url} listed a soft-deleted child"
