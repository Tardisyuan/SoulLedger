"""A menu that names a permission codename is visible to whoever holds it.

`Menu.permission` had been written on rows since menus/0013 and read by nothing
on the visibility path — the sidebar was decided by `roles` alone, so granting
`scheduler.read` to VIEWER in the permission matrix put the API in reach and
left the sidebar entry hidden. `apps/menus/access.py::menu_is_visible_to` now
has three doors (roles / held codename / directory-with-a-visible-child) and
this file drives every menu exit through them with a real JWT.

Absence is asserted as hard as presence: the directory opens for the one page
and stays shut for its siblings; revoking the grant closes it again; nothing
changes for ADMIN or for the seeded rows whose `permission` is empty.
"""
import pytest
from rest_framework_simplejwt.tokens import RefreshToken

from apps.menus.models import Menu
from apps.perm.models import Permission, Role, RolePermission

MENU_EXITS = ("/api/v1/menus/", "/api/v1/menus/tree/", "/api/v1/menus/list-public/")


def _client(api_client, user):
    token = RefreshToken.for_user(user)
    if user.tenant:
        token["tenant_code"] = user.tenant.code
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return api_client


def _names(payload):
    """Every menu name reachable in a response body, at any depth."""
    rows = payload.get("results", payload) if isinstance(payload, dict) else payload
    out = set()

    def walk(items):
        for item in items:
            out.add(item["name"])
            walk(item.get("children") or [])

    walk(rows)
    return out


@pytest.fixture
def system_settings(db):
    """The seeded shape: an ADMIN-only directory with ADMIN-only pages, one of
    which also names a codename (`/scheduler`, menus/0015)."""
    directory = Menu.objects.create(name="系统设置", menu_type="DIRECTORY", roles=["ADMIN"], order=60)
    users = Menu.objects.create(name="用户管理", path="/users", parent=directory, roles=["ADMIN"], order=10)
    scheduler = Menu.objects.create(
        name="定时任务", path="/scheduler", parent=directory, roles=["ADMIN"],
        permission="scheduler.read", order=45,
    )
    everyone = Menu.objects.create(name="动态", path="/social", roles=[], order=50)
    return directory, users, scheduler, everyone


@pytest.fixture
def grant_viewer_scheduler_read(db):
    def grant():
        return RolePermission.objects.create(
            role=Role.objects.get(name="VIEWER"),
            permission=Permission.objects.get(codename="scheduler.read"),
        )

    return grant


@pytest.mark.django_db
@pytest.mark.parametrize("exit_url", MENU_EXITS)
def test_a_viewer_sees_the_page_and_its_directory_only_while_holding_the_codename(
    api_client, viewer_user, system_settings, grant_viewer_scheduler_read, exit_url
):
    client = _client(api_client, viewer_user)

    before = _names(client.get(exit_url).json())
    assert "定时任务" not in before and "系统设置" not in before
    assert "动态" in before  # the walk is not vacuous

    grant = grant_viewer_scheduler_read()
    during = _names(client.get(exit_url).json())
    assert {"定时任务", "系统设置"} <= during
    assert "用户管理" not in during, "opening the directory for one page must not open its siblings"

    grant.delete()
    after = _names(client.get(exit_url).json())
    assert "定时任务" not in after and "系统设置" not in after


@pytest.mark.django_db
def test_admin_sees_everything_regardless(api_client, admin_user, system_settings):
    client = _client(api_client, admin_user)
    for exit_url in MENU_EXITS:
        names = _names(client.get(exit_url).json())
        assert {"系统设置", "用户管理", "定时任务", "动态"} <= names, exit_url


@pytest.mark.django_db
def test_a_codename_free_admin_row_is_not_opened_by_an_unrelated_grant(
    api_client, viewer_user, system_settings, grant_viewer_scheduler_read
):
    """`/users` has `permission=""`. Holding scheduler.read says nothing about
    it, and an empty codename must not read as "no gate"."""
    grant_viewer_scheduler_read()
    client = _client(api_client, viewer_user)
    for exit_url in MENU_EXITS:
        assert "用户管理" not in _names(client.get(exit_url).json()), exit_url


@pytest.mark.django_db
def test_the_seeded_rows_are_unchanged_by_the_new_doors(viewer_user, judge_user):
    """On the real seeded data the codename door admits nobody `roles` did not
    already admit: every seeded `permission` is empty or held exactly by the
    roles listed. Otherwise this change would have silently widened a menu."""
    from apps.core.permissions import user_has_permission
    from apps.menus.access import menu_is_visible_to

    for menu in Menu.objects.exclude(permission="").exclude(menu_type="DIRECTORY"):
        for user in (viewer_user, judge_user):
            by_roles = not menu.roles or user.role in menu.roles
            by_codename = user_has_permission(user, menu.permission)
            assert by_codename == by_roles or by_roles, (menu.path, user.role)
            assert menu_is_visible_to(menu, user) == (by_roles or by_codename)
