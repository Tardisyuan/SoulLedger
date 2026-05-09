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
    user = django_user_model.objects.create_user(
        username="admin",
        password="admin123",
        role="ADMIN",
        tenant=cn_tenant,
    )
    return user


@pytest.fixture
def judge_user(db, django_user_model, cn_tenant):
    """Judge user with CN_DIYU tenant."""
    user = django_user_model.objects.create_user(
        username="judge",
        password="judge123",
        role="JUDGE",
        tenant=cn_tenant,
    )
    return user


@pytest.fixture
def eu_admin_user(db, django_user_model, eu_tenant):
    """Admin user with EU_HEAVEN_HELL tenant."""
    user = django_user_model.objects.create_user(
        username="eu_admin",
        password="admin123",
        role="ADMIN",
        tenant=eu_tenant,
    )
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
    api_client.force_authenticate(user=admin_user)
    response = api_client.post("/api/v1/auth/login/", {
        "username": "admin",
        "password": "admin123",
    })
    token = response.data.get("access")
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}


@pytest.fixture
def eu_auth_headers(api_client, eu_admin_user):
    """Authenticated headers dict with EU admin user."""
    api_client.force_authenticate(user=eu_admin_user)
    response = api_client.post("/api/v1/auth/login/", {
        "username": "eu_admin",
        "password": "admin123",
    })
    token = response.data.get("access")
    return {"HTTP_AUTHORIZATION": f"Bearer {token}"}
