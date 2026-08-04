"""
Authentication and User model tests for M7 - User & Organization Refactoring
"""
from django.db import IntegrityError
from django.test import TestCase

from apps.authentication.models import User
from apps.org.models import Organization


class UserModelTest(TestCase):
    """用户模型测试"""

    @classmethod
    def setUpTestData(cls):
        """设置测试数据"""
        # 创建组织
        cls.diyu = Organization.objects.create(
            name="中国地府",
            code="DIYU",
            category="CHINESE",
            level=0,
        )
        cls.diyu_01 = Organization.objects.create(
            name="第一殿-秦广王",
            code="DIYU_01",
            category="CHINESE",
            parent=cls.diyu,
            level=1,
        )

    def test_user_creation_with_organization(self):
        """测试用户创建并关联组织"""
        user = User.objects.create_user(
            username="qinguang",
            password="soul123456",
            email="qinguang@diyu.com",
            organization=self.diyu_01,
            position="秦广王",
        )
        self.assertEqual(user.username, "qinguang")
        self.assertEqual(user.organization, self.diyu_01)
        self.assertEqual(user.position, "秦广王")

    def test_user_unique_username(self):
        """测试用户名唯一性"""
        User.objects.create_user(
            username="testuser",
            password="soul123456",
        )
        with self.assertRaises(IntegrityError):
            User.objects.create_user(
                username="testuser",
                password="soul123456",
            )

    def test_user_organization_cascade_protection(self):
        """软删除组织不触发级联，用户organization FK保留"""
        user = User.objects.create_user(
            username="testuser2",
            password="soul123456",
            organization=self.diyu,
        )
        # 软删除组织：is_deleted=True，但数据库行保留，SET_NULL不触发
        self.diyu.delete()
        user.refresh_from_db()
        self.assertIsNotNone(user.organization)
        self.assertTrue(self.diyu.is_deleted)

    def test_user_str_representation(self):
        """测试用户的字符串表示"""
        user = User.objects.create_user(
            username="qinguang",
            password="soul123456",
        )
        # __str__ 返回 "username (role)"
        self.assertEqual(str(user), "qinguang (VIEWER)")

    def test_user_has_module_perms(self):
        """测试用户权限检查方法"""
        user = User.objects.create_user(
            username="testuser3",
            password="soul123456",
        )
        # 普通用户没有 auth 模块权限
        self.assertFalse(user.has_module_perms("auth"))
        # 超级用户有所有权限
        admin = User.objects.create_superuser(
            username="admin2",
            password="admin123",
        )
        self.assertTrue(admin.has_module_perms("auth"))
        self.assertTrue(admin.has_module_perms("org"))

    def test_user_default_is_active(self):
        """测试用户默认启用状态"""
        user = User.objects.create_user(
            username="inactive",
            password="soul123456",
        )
        self.assertTrue(user.is_active)

    def test_user_role_assignment_via_actor_migration(self):
        """测试通过Actor迁移后的用户角色分配"""
        # 模拟迁移后的用户
        user = User.objects.create_user(
            username="yanluowang",
            password="soul123456",
            organization=self.diyu_01,
            position="阎罗王",
        )
        # 验证用户可以登录
        self.assertTrue(user.check_password("soul123456"))


# ---------------------------------------------------------------------------
# Security regression: UserViewSet tenant isolation & role escalation.
#
# UserViewSet has no TenantQuerySetMixin/DataScopeViewSetMixin, and until
# this fix its create/update serializers let the caller specify any `tenant`
# and any `role` with no constraint. That's currently masked in production
# because `permission_classes = [TenantPermission, IsAdminPermission]` keeps
# every non-ADMIN caller off the endpoint entirely — but apps/perm/models.py
# documents that MODERATOR is deliberately withheld `user.manage` *because*
# of this gap, pending exactly this fix. So these tests exercise
# get_queryset() and the serializers directly (bypassing dispatch()'s
# permission_classes, which is the point — it proves the data layer is safe
# on its own, independent of that HTTP-layer gate) using a MODERATOR caller
# as the stand-in non-ADMIN role.
# ---------------------------------------------------------------------------
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.authentication.serializers import UserCreateSerializer, UserUpdateSerializer
from apps.authentication.views import UserViewSet
from apps.tenants.models import Tenant

BASE = "/api/v1/users"


def _jwt_client(user, tenant):
    """APIClient authenticated via JWT with tenant_code claim (matches TenantMiddleware)."""
    client = APIClient()
    token = RefreshToken.for_user(user)
    if tenant:
        token["tenant_code"] = tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


class _FakeRequest:
    """Minimal request double exposing just .user/.tenant/.query_params —
    enough for UserViewSet.get_queryset() and the serializers' validate().
    Deliberately does NOT go through DRF's Request/dispatch(), so it bypasses
    permission_classes on purpose (see module docstring above)."""

    def __init__(self, user, tenant):
        self.user = user
        self.tenant = tenant
        self.query_params = {}


@pytest.mark.django_db
class TestUserViewSetTenantIsolation:
    """get_queryset() must scope non-ADMIN callers to their own tenant."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.eu_tenant = Tenant.objects.get_or_create(
            code="UM_EU", defaults={"display_name": "EU Test Tenant"}
        )[0]
        self.eg_tenant = Tenant.objects.get_or_create(
            code="UM_EG", defaults={"display_name": "EG Test Tenant"}
        )[0]
        self.eu_moderator = User.objects.create_user(
            username="um_eu_mod", password="test12345", role="MODERATOR", tenant=self.eu_tenant
        )
        self.eu_other_user = User.objects.create_user(
            username="um_eu_other", password="test12345", role="VIEWER", tenant=self.eu_tenant
        )
        self.eg_user = User.objects.create_user(
            username="um_eg_user", password="test12345", role="VIEWER", tenant=self.eg_tenant
        )
        self.admin = User.objects.create_user(
            username="um_admin", password="test12345", role="ADMIN", tenant=self.eu_tenant
        )

    def _queryset_for(self, user, tenant):
        view = UserViewSet()
        view.request = _FakeRequest(user, tenant)
        view.action = "list"
        return view.get_queryset()

    def test_non_admin_sees_only_own_tenant(self):
        qs = self._queryset_for(self.eu_moderator, self.eu_tenant)
        ids = set(qs.values_list("id", flat=True))
        assert self.eu_moderator.id in ids
        assert self.eu_other_user.id in ids
        assert self.eg_user.id not in ids

    def test_non_admin_without_tenant_sees_nothing(self):
        qs = self._queryset_for(self.eu_moderator, None)
        assert qs.count() == 0

    def test_admin_sees_all_tenants(self):
        """ADMIN bypass, consistent with TenantQuerySetMixin/DataScopeViewSetMixin
        everywhere else — this also fixes the old "create anywhere, see only
        own tenant" asymmetry: an ADMIN-created cross-tenant user is now
        actually visible/manageable through this same API."""
        qs = self._queryset_for(self.admin, self.eu_tenant)
        ids = set(qs.values_list("id", flat=True))
        assert self.eu_other_user.id in ids
        assert self.eg_user.id in ids


@pytest.mark.django_db
class TestUserCreateSerializerRoleAndTenantGuard:
    """UserCreateSerializer must not let a non-ADMIN caller escalate role or
    plant a user in a tenant other than their own."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.eu_tenant = Tenant.objects.get_or_create(
            code="UMC_EU", defaults={"display_name": "EU Create Tenant"}
        )[0]
        self.eg_tenant = Tenant.objects.get_or_create(
            code="UMC_EG", defaults={"display_name": "EG Create Tenant"}
        )[0]
        self.eu_moderator = User.objects.create_user(
            username="umc_eu_mod", password="test12345", role="MODERATOR", tenant=self.eu_tenant
        )
        self.admin = User.objects.create_user(
            username="umc_admin", password="test12345", role="ADMIN", tenant=self.eu_tenant
        )

    def test_non_admin_cannot_create_admin(self):
        request = _FakeRequest(self.eu_moderator, self.eu_tenant)
        serializer = UserCreateSerializer(
            data={"username": "umc_escalated", "password": "test12345", "role": "ADMIN"},
            context={"request": request},
        )
        assert not serializer.is_valid()
        assert "role" in serializer.errors

    def test_non_admin_cannot_create_in_other_tenant(self):
        request = _FakeRequest(self.eu_moderator, self.eu_tenant)
        serializer = UserCreateSerializer(
            data={
                "username": "umc_sneaky",
                "password": "test12345",
                "role": "VIEWER",
                "tenant": self.eg_tenant.id,
            },
            context={"request": request},
        )
        assert not serializer.is_valid()
        assert "tenant" in serializer.errors

    def test_non_admin_create_defaults_to_own_tenant(self):
        request = _FakeRequest(self.eu_moderator, self.eu_tenant)
        serializer = UserCreateSerializer(
            data={"username": "umc_scoped", "password": "test12345", "role": "VIEWER"},
            context={"request": request},
        )
        assert serializer.is_valid(), serializer.errors
        user = serializer.save()
        assert user.tenant_id == self.eu_tenant.id

    def test_admin_can_create_admin_in_any_tenant(self):
        """ADMIN's existing capability — any role, any tenant — is unchanged."""
        request = _FakeRequest(self.admin, self.eu_tenant)
        serializer = UserCreateSerializer(
            data={
                "username": "umc_cross_tenant_admin",
                "password": "test12345",
                "role": "ADMIN",
                "tenant": self.eg_tenant.id,
            },
            context={"request": request},
        )
        assert serializer.is_valid(), serializer.errors
        user = serializer.save()
        assert user.role == "ADMIN"
        assert user.tenant_id == self.eg_tenant.id


@pytest.mark.django_db
class TestUserUpdateSerializerRoleGuard:
    """UserUpdateSerializer must not let a non-ADMIN caller promote anyone
    (including themselves) to a role more privileged than their own."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.eu_tenant = Tenant.objects.get_or_create(
            code="UMU_EU", defaults={"display_name": "EU Update Tenant"}
        )[0]
        self.eu_moderator = User.objects.create_user(
            username="umu_eu_mod", password="test12345", role="MODERATOR", tenant=self.eu_tenant
        )
        self.target = User.objects.create_user(
            username="umu_target", password="test12345", role="VIEWER", tenant=self.eu_tenant
        )

    def test_non_admin_cannot_promote_target_to_admin(self):
        request = _FakeRequest(self.eu_moderator, self.eu_tenant)
        serializer = UserUpdateSerializer(
            self.target, data={"role": "ADMIN"}, partial=True, context={"request": request}
        )
        assert not serializer.is_valid()
        assert "role" in serializer.errors

    def test_non_admin_cannot_self_promote_to_admin(self):
        request = _FakeRequest(self.eu_moderator, self.eu_tenant)
        serializer = UserUpdateSerializer(
            self.eu_moderator, data={"role": "ADMIN"}, partial=True, context={"request": request}
        )
        assert not serializer.is_valid()
        assert "role" in serializer.errors


@pytest.mark.django_db
class TestUserViewSetHTTPAdminCapabilityPreserved:
    """Exercises the real /api/v1/users/ endpoint (full dispatch, including
    permission_classes) to confirm ADMIN's existing capabilities survive the
    fix, and that non-ADMIN remains blocked at the HTTP layer — unchanged,
    since IsAdminPermission was intentionally left alone (see report)."""

    @pytest.fixture(autouse=True)
    def setup(self, db):
        self.eu_tenant = Tenant.objects.get_or_create(
            code="UMH_EU", defaults={"display_name": "EU HTTP Tenant"}
        )[0]
        self.eg_tenant = Tenant.objects.get_or_create(
            code="UMH_EG", defaults={"display_name": "EG HTTP Tenant"}
        )[0]
        self.admin = User.objects.create_user(
            username="umh_admin", password="test12345", role="ADMIN", tenant=self.eu_tenant
        )
        self.eg_viewer = User.objects.create_user(
            username="umh_eg_viewer", password="test12345", role="VIEWER", tenant=self.eg_tenant
        )
        self.moderator = User.objects.create_user(
            username="umh_moderator", password="test12345", role="MODERATOR", tenant=self.eu_tenant
        )
        self.admin_client = _jwt_client(self.admin, self.eu_tenant)
        self.moderator_client = _jwt_client(self.moderator, self.eu_tenant)

    def test_admin_lists_users_across_tenants(self):
        resp = self.admin_client.get(f"{BASE}/")
        assert resp.status_code == 200
        ids = {row["id"] for row in resp.data["results"]}
        assert self.eg_viewer.id in ids

    def test_admin_can_create_user_in_other_tenant(self):
        resp = self.admin_client.post(f"{BASE}/", {
            "username": "umh_new_eg_user",
            "password": "test12345678",
            "role": "VIEWER",
            "tenant": self.eg_tenant.id,
        }, format="json")
        assert resp.status_code == 201, resp.data

    def test_non_admin_blocked_by_http_layer(self):
        """Documents the current (unchanged) gate: MODERATOR still can't
        reach this endpoint at all, regardless of the queryset/serializer
        fix above — access-granting is a separate decision left to
        whoever eventually gives MODERATOR `user.manage`."""
        resp = self.moderator_client.get(f"{BASE}/")
        assert resp.status_code == 403
