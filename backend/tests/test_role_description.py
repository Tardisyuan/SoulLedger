"""`Role.description` — the 「说明」 field of the role drawer (E-11b).

Read in the role list, written by ADMIN through the same PUT every other role
edit goes through, and carried by the permission export / import.
"""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.perm.export import export_permissions, import_permissions
from apps.perm.models import Role


def _client(user):
    token = RefreshToken.for_user(user)
    if user.tenant:
        token["tenant_code"] = user.tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


@pytest.fixture
def clerk_role(db):
    return Role.objects.create(name="YIN_CLERK", display_name="殿司")


@pytest.mark.django_db
def test_admin_writes_the_description_and_the_list_reads_it_back(admin_user, clerk_role):
    client = _client(admin_user)
    text = "各殿收发灵魂来信、处理日常事务。"
    response = client.put(f"/api/v1/perm/roles/{clerk_role.pk}/", {"description": text}, format="json")
    assert response.status_code == 200, response.content
    assert response.data["description"] == text
    clerk_role.refresh_from_db()
    assert (clerk_role.description, clerk_role.display_name) == (text, "殿司")
    listed = {r["name"]: r for r in client.get("/api/v1/perm/roles/").data}
    assert listed["YIN_CLERK"]["description"] == text


@pytest.mark.django_db
def test_blank_is_allowed_and_is_the_default(admin_user, clerk_role):
    assert clerk_role.description == ""
    Role.objects.filter(pk=clerk_role.pk).update(description="旧的")
    response = _client(admin_user).put(f"/api/v1/perm/roles/{clerk_role.pk}/", {"description": ""}, format="json")
    assert response.status_code == 200
    clerk_role.refresh_from_db()
    assert clerk_role.description == ""


@pytest.mark.django_db
def test_a_non_admin_cannot_write_it(judge_user, clerk_role):
    response = _client(judge_user).put(f"/api/v1/perm/roles/{clerk_role.pk}/", {"description": "越权"}, format="json")
    assert response.status_code == 403
    clerk_role.refresh_from_db()
    assert clerk_role.description == ""


@pytest.mark.django_db
def test_export_carries_it_and_import_restores_it(clerk_role):
    Role.objects.filter(pk=clerk_role.pk).update(description="收发来信")
    exported = export_permissions()
    row = next(r for r in exported["roles"] if r["name"] == "YIN_CLERK")
    assert row["description"] == "收发来信"

    Role.all_objects.filter(pk=clerk_role.pk).delete()
    import_permissions(exported)
    assert Role.objects.get(name="YIN_CLERK").description == "收发来信"


@pytest.mark.django_db
def test_an_export_from_before_the_field_imports_with_a_blank_description(db):
    import_permissions({"roles": [{"name": "OLD_FILE", "display_name": "旧文件", "scope": "ORG"}]})
    assert Role.objects.get(name="OLD_FILE").description == ""
