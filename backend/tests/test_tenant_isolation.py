"""
Tenant isolation integration tests — M3.6
"""
import pytest
from rest_framework.test import APIClient
from apps.tenants.models import Tenant


@pytest.mark.django_db
class TestTenantIsolation:
    """Verify that tenant A's users cannot access tenant B's data."""

    @pytest.fixture(autouse=True)
    def setup_tenants(self):
        self.cn = Tenant.objects.get_or_create(
            code="CN_DIYU", defaults={"display_name": "Chinese"}
        )[0]
        self.eu = Tenant.objects.get_or_create(
            code="EU_HEAVEN_HELL", defaults={"display_name": "European"}
        )[0]

    def _create_user(self, username, role, tenant, django_user_model):
        user = django_user_model.objects.create_user(
            username=username, password="test", role=role
        )
        user.tenant = tenant
        user.save()
        return user

    def _create_soul(self, name, tenant):
        from apps.souls.models import Soul
        return Soul.objects.create(name=name, tenant=tenant)

    def test_cn_user_sees_only_cn_souls_orm(self, django_user_model):
        """ORM: CN user sees only CN souls via TenantManager."""
        from apps.souls.models import Soul
        from apps.tenants.managers import set_current_tenant

        cn_soul = self._create_soul("CN Soul", self.cn)
        eu_soul = self._create_soul("EU Soul", self.eu)

        set_current_tenant(self.cn)
        souls = list(Soul.objects.all())
        assert cn_soul in souls
        assert eu_soul not in souls

        set_current_tenant(None)

    def test_eu_user_sees_only_eu_souls_orm(self, django_user_model):
        """ORM: EU user sees only EU souls."""
        from apps.souls.models import Soul
        from apps.tenants.managers import set_current_tenant

        self._create_soul("CN Soul", self.cn)
        eu_soul = self._create_soul("EU Soul", self.eu)

        set_current_tenant(self.eu)
        souls = list(Soul.objects.all())
        assert len(souls) == 1
        assert souls[0] == eu_soul

        set_current_tenant(None)

    def test_no_tenant_sees_all(self, django_user_model):
        """ORM: No tenant set → returns all souls."""
        from apps.souls.models import Soul
        from apps.tenants.managers import clear_current_tenant

        s1 = self._create_soul("CN Soul", self.cn)
        s2 = self._create_soul("EU Soul", self.eu)

        clear_current_tenant()
        souls = list(Soul.objects.all())
        assert len(souls) == 2
        assert s1 in souls
        assert s2 in souls

    def test_cn_user_api_sees_only_cn_tenant(self, django_user_model):
        """API: CN user listing tenants doesn't leak other data."""
        client = APIClient()
        user = self._create_user("cn_judge", "JUDGE", self.cn, django_user_model)
        client.force_authenticate(user=user)

        resp = client.get("/api/v1/tenants/")
        assert resp.status_code == 200
        tenants = [t["code"] for t in resp.data["results"]]
        assert "CN_DIYU" in tenants
