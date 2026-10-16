"""第三十四批 W-4 / W-5 的后端部分:机构删除拒绝(带数量)、移动带走子树层级、不能挂到自己下面;
用户 CSV 导入的 dry_run 预览(逐行、不写库、不带密码)。"""
import pytest
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile

from apps.org.models import Organization

User = get_user_model()


@pytest.fixture
def admin_client(api_client, admin_user):
    from rest_framework_simplejwt.tokens import RefreshToken

    token = RefreshToken.for_user(admin_user)
    if admin_user.tenant:
        token["tenant_code"] = admin_user.tenant.code
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return api_client


@pytest.fixture
def tree(admin_user):
    t = admin_user.tenant
    root = Organization.objects.create(name="Root", code="B34_ROOT", category="CHINESE", tenant=t)
    child = Organization.objects.create(name="Child", code="B34_CHILD", category="CHINESE", parent=root, tenant=t)
    leaf = Organization.objects.create(name="Leaf", code="B34_LEAF", category="CHINESE", parent=child, tenant=t)
    other = Organization.objects.create(name="Other", code="B34_OTHER", category="CHINESE", tenant=t)
    return root, child, leaf, other


@pytest.mark.django_db
class TestOrganizationWrites:
    def test_delete_with_subunits_is_refused_with_counts(self, admin_client, tree):
        root, child, _leaf, _other = tree
        res = admin_client.delete(f"/api/v1/organizations/{root.id}/")
        assert res.status_code == 409
        assert res.data["code"] == "not_empty"
        assert (res.data["units"], res.data["people"]) == (1, 0)
        assert Organization.objects.filter(pk=root.pk).exists()
        assert Organization.objects.get(pk=child.pk).parent_id == root.id

    def test_delete_with_people_is_refused_with_counts(self, admin_client, admin_user, tree):
        _root, _child, leaf, _other = tree
        User.objects.create_user(username="b34_member", password="x", role="VIEWER", tenant=admin_user.tenant, organization=leaf)
        res = admin_client.delete(f"/api/v1/organizations/{leaf.id}/")
        assert res.status_code == 409
        assert (res.data["units"], res.data["people"]) == (0, 1)

    def test_delete_empty_unit(self, admin_client, tree):
        *_, other = tree
        assert admin_client.delete(f"/api/v1/organizations/{other.id}/").status_code == 204

    def test_move_carries_the_subtree_levels(self, admin_client, tree):
        root, child, leaf, other = tree
        res = admin_client.patch(f"/api/v1/organizations/{root.id}/", {"parent": other.id}, format="json")
        assert res.status_code == 200, res.data
        assert [Organization.objects.get(pk=o.pk).level for o in (root, child, leaf)] == [1, 2, 3]

    def test_cannot_move_under_own_descendant(self, admin_client, tree):
        root, _child, leaf, _other = tree
        res = admin_client.patch(f"/api/v1/organizations/{root.id}/", {"parent": leaf.id}, format="json")
        assert res.status_code == 400
        assert "parent" in res.data

    def test_users_list_filters_by_organization(self, admin_client, admin_user, tree):
        _root, _child, leaf, other = tree
        User.objects.create_user(username="b34_in", password="x", role="VIEWER", tenant=admin_user.tenant, organization=leaf)
        User.objects.create_user(username="b34_out", password="x", role="VIEWER", tenant=admin_user.tenant, organization=other)
        res = admin_client.get(f"/api/v1/users/?organization={leaf.id}")
        names = [u["username"] for u in res.data.get("results", res.data)]
        assert names == ["b34_in"]


def _upload(body: str):
    return SimpleUploadedFile("users.csv", body.encode("utf-8"), content_type="text/csv")


@pytest.mark.django_db
class TestUserImportPreview:
    def test_dry_run_reports_each_row_and_writes_nothing(self, admin_client):
        body = (
            "username,password,role,email,display_name\n"
            "ok_user,GoodPass12345,VIEWER,ok@example.com,Okay\n"
            ",GoodPass12345,VIEWER,,NoName\n"
            "no_pw,,VIEWER,,\n"
            "bad_role,GoodPass12345,NOPE,,\n"
            "ok_user,GoodPass12345,VIEWER,,Twin\n"
        )
        res = admin_client.post("/api/v1/users/import_csv/", {"file": _upload(body), "dry_run": "1"}, format="multipart")
        assert res.status_code == 200, res.data
        assert (res.data["total"], res.data["ok_count"], res.data["error_count"]) == (5, 1, 4)
        codes = {r["row"]: [e["code"] for e in r["errors"]] for r in res.data["rows"]}
        assert codes == {
            2: [], 3: ["username_required"], 4: ["password_required"], 5: ["role_invalid"], 6: ["username_taken"],
        }
        assert "password" not in str(res.data["rows"][0]["values"])
        assert not User.objects.filter(username="ok_user").exists()

    def test_commit_reads_display_name_and_bom(self, admin_client):
        body = "﻿username,password,display_name\nbom_user,GoodPass12345,带名字\n"
        res = admin_client.post("/api/v1/users/import_csv/", {"file": _upload(body)}, format="multipart")
        assert res.status_code == 200, res.data
        assert res.data["created"] == 1
        user = User.objects.get(username="bom_user")
        assert user.display_name == "带名字" and user.must_change_password

    def test_file_level_errors_are_coded(self, admin_client):
        bad = SimpleUploadedFile("users.csv", "用户".encode("gbk"), content_type="text/csv")
        res = admin_client.post("/api/v1/users/import_csv/", {"file": bad}, format="multipart")
        assert (res.status_code, res.data["code"]) == (400, "bad_encoding")
        res = admin_client.post("/api/v1/users/import_csv/", {"file": _upload("email\nx@y.z\n")}, format="multipart")
        assert (res.status_code, res.data["code"]) == (400, "missing_columns")


@pytest.mark.django_db
class TestArchiveRoundTrip:
    """软删被拒(409 archivable)→ 归档 → 详情仍取得到并带横条字段 → 取消归档回到列表。"""

    def test_soul_archive_then_unarchive(self, admin_client, admin_user):
        from apps.judgment.models import Judgment
        from apps.souls.models import Civilization, Soul

        soul = Soul.objects.create(name="B34 Soul", civilization=Civilization.CHINESE, tenant=admin_user.tenant)
        Judgment.objects.create(soul=soul, civilization=Civilization.CHINESE, verdict="HEAVEN")
        refused = admin_client.delete(f"/api/v1/souls/{soul.pk}/")
        assert (refused.status_code, refused.data["archivable"]) == (409, True)

        done = admin_client.post(f"/api/v1/souls/{soul.pk}/archive/", {"reason": "why"}, format="json")
        assert done.status_code == 200
        listed = admin_client.get("/api/v1/souls/")
        assert str(soul.pk) not in [str(r["id"]) for r in listed.data.get("results", listed.data)]
        detail = admin_client.get(f"/api/v1/souls/{soul.pk}/")
        assert detail.status_code == 200
        assert detail.data["is_archived"] is True and detail.data["archive_reason"] == "why"
        assert detail.data["archived_by_name"]

        back = admin_client.post(f"/api/v1/souls/{soul.pk}/unarchive/")
        assert back.status_code == 200 and back.data["is_archived"] is False
        listed = admin_client.get("/api/v1/souls/")
        assert str(soul.pk) in [str(r["id"]) for r in listed.data.get("results", listed.data)]
