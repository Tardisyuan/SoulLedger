"""
Pytest configuration + fixtures for SoulLedger API tests.
"""
import os
import pytest
from rest_framework.test import APIClient


# Ensure DJANGO_SETTINGS_MODULE is set
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")




@pytest.fixture
def api_client():
    """DRF APIClient for making test requests."""
    return APIClient()


@pytest.fixture
def cn_tenant(db):
    """Chinese Diyu tenant."""
    from apps.tenants.models import Tenant
    tenant, _ = Tenant.objects.get_or_create(
        code="CN_DIYU",
        defaults={"display_name": "Chinese Diyu"}
    )
    return tenant


@pytest.fixture
def eu_tenant(db):
    """European Heaven/Hell tenant."""
    from apps.tenants.models import Tenant
    tenant, _ = Tenant.objects.get_or_create(
        code="EU_HEAVEN_HELL",
        defaults={"display_name": "European Heaven/Hell"}
    )
    return tenant


@pytest.fixture
def admin_user(db, django_user_model, cn_tenant):
    """Admin user with CN_DIYU tenant."""
    user, _ = django_user_model.objects.get_or_create(
        username="admin",
        defaults={"role": "ADMIN", "tenant": cn_tenant},
    )
    if not user.check_password("admin123"):
        user.set_password("admin123")
        user.save()
    return user


@pytest.fixture
def judge_user(db, django_user_model, cn_tenant):
    """Judge user with CN_DIYU tenant."""
    user, _ = django_user_model.objects.get_or_create(
        username="judge",
        defaults={"role": "JUDGE", "tenant": cn_tenant},
    )
    if not user.check_password("judge123"):
        user.set_password("judge123")
        user.save()
    return user


@pytest.fixture
def eu_admin_user(db, django_user_model, eu_tenant):
    """Admin user with EU_HEAVEN_HELL tenant."""
    user, _ = django_user_model.objects.get_or_create(
        username="eu_admin",
        defaults={
            "role": "ADMIN",
            "tenant": eu_tenant,
        },
    )
    if not user.check_password("admin123"):
        user.set_password("admin123")
        user.save()
    return user


@pytest.fixture
def guardian_user(db, django_user_model, cn_tenant):
    """Guardian user with CN_DIYU tenant."""
    user, _ = django_user_model.objects.get_or_create(
        username="guardian",
        defaults={"role": "GUARDIAN", "tenant": cn_tenant},
    )
    if not user.check_password("guardian123"):
        user.set_password("guardian123")
        user.save()
    return user


@pytest.fixture
def viewer_user(db, django_user_model, cn_tenant):
    """Viewer user with CN_DIYU tenant."""
    user, _ = django_user_model.objects.get_or_create(
        username="viewer",
        defaults={"role": "VIEWER", "tenant": cn_tenant},
    )
    if not user.check_password("viewer123"):
        user.set_password("viewer123")
        user.save()
    return user


@pytest.fixture
def soul_data():
    """Sample soul creation data."""
    return {
        "name": "测试灵魂",
        "birth_date": "1990-01-15",
        "origin_location": "北京",
        "birth_name": "出生名",
        "description": "测试描述",
    }


@pytest.fixture
def auth_headers(api_client, admin_user):
    """Authenticated headers dict with admin user."""
    from rest_framework_simplejwt.tokens import RefreshToken
    token = RefreshToken.for_user(admin_user)
    # Add tenant_code claim
    if admin_user.tenant:
        token["tenant_code"] = admin_user.tenant.code
    return {"HTTP_AUTHORIZATION": f"Bearer {token.access_token}"}


@pytest.fixture
def eu_auth_headers(api_client, eu_admin_user):
    """Authenticated headers dict with EU admin user."""
    from rest_framework_simplejwt.tokens import RefreshToken
    token = RefreshToken.for_user(eu_admin_user)
    if eu_admin_user.tenant:
        token["tenant_code"] = eu_admin_user.tenant.code
    return {"HTTP_AUTHORIZATION": f"Bearer {token.access_token}"}
