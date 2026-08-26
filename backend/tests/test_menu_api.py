"""
Tests for Menu and MenuButton API endpoints.
"""
import pytest

from apps.menus.models import Menu, MenuButton


@pytest.mark.django_db
class TestMenuAPI:
    """Test /api/v1/menus/ endpoints."""

    def test_list_menus_authenticated(self, api_client, admin_user, cn_tenant):
        """GET /api/v1/menus/ returns menus."""
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(admin_user)
        if admin_user.tenant:
            token["tenant_code"] = admin_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
        response = api_client.get("/api/v1/menus/")
        assert response.status_code == 200

    def test_list_menus_unauthenticated(self, api_client):
        """GET /api/v1/menus/ without auth returns 401."""
        response = api_client.get("/api/v1/menus/")
        assert response.status_code == 401

    def test_create_menu(self, api_client, admin_user, cn_tenant):
        """POST /api/v1/menus/ creates a menu."""
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(admin_user)
        if admin_user.tenant:
            token["tenant_code"] = admin_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
        response = api_client.post("/api/v1/menus/", {
            "name": "Test Menu",
            "path": "/test",
            "icon": "TestIcon",
            "order": 1,
            "is_active": True,
        }, format="json")
        assert response.status_code == 201
        assert Menu.objects.filter(name="Test Menu").exists()

    def test_get_menu_tree(self, api_client, admin_user, cn_tenant):
        """GET /api/v1/menus/tree/ returns menu tree."""
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(admin_user)
        if admin_user.tenant:
            token["tenant_code"] = admin_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
        response = api_client.get("/api/v1/menus/tree/")
        assert response.status_code == 200

    def test_get_all_menus(self, api_client, admin_user, cn_tenant):
        """GET /api/v1/menus/all/ returns all menus."""
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(admin_user)
        if admin_user.tenant:
            token["tenant_code"] = admin_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
        response = api_client.get("/api/v1/menus/all/")
        assert response.status_code == 200


@pytest.mark.django_db
class TestMenuButtonAPI:
    """Test /api/v1/menus/buttons/ endpoints."""

    def test_list_menu_buttons(self, api_client, admin_user, cn_tenant):
        """GET /api/v1/menus/buttons/ returns buttons."""
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(admin_user)
        if admin_user.tenant:
            token["tenant_code"] = admin_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
        response = api_client.get("/api/v1/menus/buttons/")
        assert response.status_code == 200

    def test_create_menu_button(self, api_client, admin_user, cn_tenant):
        """POST /api/v1/menus/buttons/ creates a button."""
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(admin_user)
        if admin_user.tenant:
            token["tenant_code"] = admin_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
        menu = Menu.objects.create(name="Test", path="/test")
        response = api_client.post("/api/v1/menus/buttons/", {
            "name": "Create",
            "code": "create",
            "permission": "test.create",
            "order": 1,
            "is_active": True,
            "menu": menu.id,
        }, format="json")
        assert response.status_code == 201
        assert MenuButton.objects.filter(code="create").exists()

    def test_non_admin_cannot_create_menu(self, api_client, judge_user, cn_tenant):
        """Non-admin cannot create menus."""
        from rest_framework_simplejwt.tokens import RefreshToken
        token = RefreshToken.for_user(judge_user)
        if judge_user.tenant:
            token["tenant_code"] = judge_user.tenant.code
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
        response = api_client.post("/api/v1/menus/", {
            "name": "Test",
            "path": "/test",
        }, format="json")
        assert response.status_code == 403


# ---------------------------------------------------------------------------
# `roles` is consulted on the path the sidebar actually uses
# ---------------------------------------------------------------------------


@pytest.mark.django_db
class TestMenuRoleVisibility:
    """`MenuViewSet.get_queryset` honours `roles`, and honours empty as public.

    WHAT WAS WRONG. `roles` was written on every row and read on one path.
    `tree` filtered by it; `get_queryset` — which is what `useSidebarMenus`
    calls, via `menusApi.list()` — returned every active row. Measured before
    fixing: a VIEWER holding `menu.read` got 200 and 15 rows, `/tenants` and
    `/organizations` among them, both `roles=["ADMIN"]`.

    WHY BOTH DIRECTIONS ARE ASSERTED. The obvious filter — "keep rows whose
    `roles` contains mine" — deletes the three seeded rows that carry
    `roles=[]` (`/social`, `/social/follows`, and a DIRECTORY that parents
    others) from every sidebar including ADMIN's, and orphans that directory's
    children. Empty means *public*, which is what `tree` has always meant by
    it. A test that only checked the ADMIN-only row disappearing would pass
    against that regression.
    """

    @staticmethod
    def _headers(user):
        from rest_framework_simplejwt.tokens import RefreshToken

        from apps.perm.models import Permission, Role, RolePermission

        role, _ = Role.objects.get_or_create(
            name=user.role, defaults={"display_name": user.role}
        )
        perm, _ = Permission.objects.get_or_create(
            codename="menu.read", defaults={"name": "menu.read", "category": "menu"}
        )
        RolePermission.objects.get_or_create(role=role, permission=perm)
        token = RefreshToken.for_user(user)
        if getattr(user, "tenant", None):
            token["tenant_code"] = user.tenant.code
        return {"HTTP_AUTHORIZATION": f"Bearer {token.access_token}"}

    @pytest.fixture
    def rows(self, db):
        from apps.menus.models import Menu

        return {
            "admin_only": Menu.objects.create(
                name="ADMIN ONLY", path="/probe-admin", menu_type="MENU",
                roles=["ADMIN"], is_active=True, order=901,
            ),
            "public": Menu.objects.create(
                name="NO ROLES", path="/probe-public", menu_type="MENU",
                roles=[], is_active=True, order=902,
            ),
            "viewer_ok": Menu.objects.create(
                name="VIEWER OK", path="/probe-viewer", menu_type="MENU",
                roles=["VIEWER"], is_active=True, order=903,
            ),
        }

    @staticmethod
    def _paths(response):
        data = response.data
        if isinstance(data, dict) and "results" in data:
            data = data["results"]
        return {m["path"] for m in data}

    def test_a_viewer_is_not_shown_an_admin_only_entry(
        self, api_client, viewer_user, rows
    ):
        response = api_client.get("/api/v1/menus/", **self._headers(viewer_user))
        assert response.status_code == 200
        assert "/probe-admin" not in self._paths(response)

    def test_a_row_with_no_roles_stays_visible_to_everyone(
        self, api_client, viewer_user, rows
    ):
        """Empty is public, not private.

        Three seeded rows depend on this. Reading empty as "nobody" would drop
        them from every sidebar in the product and orphan a directory's
        children, and the ADMIN-only assertion above would stay green while it
        happened.
        """
        response = api_client.get("/api/v1/menus/", **self._headers(viewer_user))
        assert "/probe-public" in self._paths(response)

    def test_a_row_naming_the_role_is_visible_to_it(
        self, api_client, viewer_user, rows
    ):
        response = api_client.get("/api/v1/menus/", **self._headers(viewer_user))
        assert "/probe-viewer" in self._paths(response)

    def test_admin_still_sees_everything(self, api_client, admin_user, rows):
        response = api_client.get("/api/v1/menus/", **self._headers(admin_user))
        paths = self._paths(response)
        assert {"/probe-admin", "/probe-public", "/probe-viewer"} <= paths

    def test_an_unauthenticated_caller_gets_nothing(self, api_client, rows):
        """Fails closed, matching apps/core/tenant.py's stance."""
        from apps.menus.access import visible_menus
        from apps.menus.models import Menu

        class Anon:
            is_authenticated = False

        assert visible_menus(Menu.objects.all(), Anon()).count() == 0

    def test_tree_does_not_hand_an_admin_child_to_a_lesser_role(
        self, api_client, viewer_user, db
    ):
        """The top-level filter was never the whole rule.

        `tree` filtered its roots and then attached `children_map` unfiltered,
        so an ADMIN-only child under a parent the caller could see arrived
        anyway.
        """
        from apps.menus.models import Menu

        parent = Menu.objects.create(
            name="SHARED", path="", menu_type="DIRECTORY",
            roles=[], is_active=True, order=904,
        )
        Menu.objects.create(
            name="ADMIN CHILD", path="/probe-admin-child", menu_type="MENU",
            roles=["ADMIN"], is_active=True, order=905, parent=parent,
        )
        response = api_client.get("/api/v1/menus/tree/", **self._headers(viewer_user))
        assert response.status_code == 200
        assert "/probe-admin-child" not in str(response.data)
