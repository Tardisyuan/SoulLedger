"""
Shared fixtures for social app tests.
Uses JWT auth so TenantMiddleware sets request.tenant.
"""
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from apps.social.models import (
    Comment,
    Post,
)

User = get_user_model()


@pytest.fixture
def tenant(db):
    from apps.tenants.models import Tenant
    tenant, _ = Tenant.objects.get_or_create(
        code="SOC_TEST",
        defaults={"display_name": "Social Test Tenant"},
    )
    return tenant


@pytest.fixture
def other_tenant(db):
    from apps.tenants.models import Tenant
    tenant, _ = Tenant.objects.get_or_create(
        code="SOC_OTHER",
        defaults={"display_name": "Other Tenant"},
    )
    return tenant


@pytest.fixture
def user(db, tenant):
    return User.objects.create_user(
        username="socialuser",
        password="testpass123",
        role="ADMIN",
        tenant=tenant,
    )


@pytest.fixture
def other_user(db, tenant):
    return User.objects.create_user(
        username="otheruser",
        password="testpass123",
        role="VIEWER",
        tenant=tenant,
    )


@pytest.fixture
def third_user(db, tenant):
    return User.objects.create_user(
        username="thirduser",
        password="testpass123",
        role="VIEWER",
        tenant=tenant,
    )


@pytest.fixture
def foreign_user(db, other_tenant):
    return User.objects.create_user(
        username="foreignuser",
        password="testpass123",
        role="VIEWER",
        tenant=other_tenant,
    )


@pytest.fixture
def auth_client(user, tenant):
    """APIClient authenticated as `user` with JWT tenant_code."""
    client = APIClient()
    from rest_framework_simplejwt.tokens import RefreshToken
    token = RefreshToken.for_user(user)
    token["tenant_code"] = tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def other_client(other_user, tenant):
    """APIClient authenticated as `other_user` with JWT tenant_code."""
    client = APIClient()
    from rest_framework_simplejwt.tokens import RefreshToken
    token = RefreshToken.for_user(other_user)
    token["tenant_code"] = tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def third_client(third_user, tenant):
    """APIClient authenticated as `third_user` with JWT tenant_code."""
    client = APIClient()
    from rest_framework_simplejwt.tokens import RefreshToken
    token = RefreshToken.for_user(third_user)
    token["tenant_code"] = tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def foreign_client(foreign_user, other_tenant):
    """APIClient authenticated as `foreign_user` from a different tenant."""
    client = APIClient()
    from rest_framework_simplejwt.tokens import RefreshToken
    token = RefreshToken.for_user(foreign_user)
    token["tenant_code"] = other_tenant.code
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def post(user, tenant):
    return Post.objects.create(
        author=user,
        content="Test post content",
        tenant=tenant,
    )


@pytest.fixture
def comment(user, post, tenant):
    return Comment.objects.create(
        author=user,
        post=post,
        content="Test comment content",
        tenant=tenant,
    )
