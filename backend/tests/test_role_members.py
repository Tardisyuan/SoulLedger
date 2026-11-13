"""角色抽屉的「成员」页签(`apps/perm/members.py`,2026-10-29 第 6 条)。

正反两面都问:本殿的人能列、能授、能移除;别殿的人看不见也动不了;规则与 `assign_roles` 是同一套
(绑殿 ADMIN 不能任命 ADMIN、角色要存在);任一人被拒整批不动;改动写通用 UPDATE 审计行。
"""
import pytest
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.authentication.models import User
from apps.perm.models import Role
from apps.tenants.models import Tenant
from tests.conftest import sign_in

pytestmark = pytest.mark.django_db


@pytest.fixture
def world(db):
    cn = Tenant.objects.get_or_create(code="CN_DIYU", defaults={"display_name": "中国地府"})[0]
    eg = Tenant.objects.get_or_create(code="EG_DUAT", defaults={"display_name": "埃及杜阿特"})[0]
    scribe = Role.objects.get_or_create(name="SCRIBE", defaults={"display_name": "Scribe"})[0]
    judge = Role.objects.get_or_create(name="JUDGE", defaults={"display_name": "Judge"})[0]
    admin = Role.objects.get_or_create(name="ADMIN", defaults={"display_name": "Admin"})[0]
    bound = User.objects.create_user(username="cn_admin", password="x", role="ADMIN", tenant=cn)
    glob = User.objects.create_user(username="g_admin", password="x", role="ADMIN", tenant=None)
    cn_judge = User.objects.create_user(username="cn_judge", password="x", role="JUDGE", tenant=cn)
    cn_viewer = User.objects.create_user(username="cn_viewer", password="x", role="VIEWER", tenant=cn,
                                         extra_roles=["JUDGE"])
    eg_judge = User.objects.create_user(username="eg_judge", password="x", role="JUDGE", tenant=eg)
    return {"cn": cn, "scribe": scribe, "judge": judge, "admin": admin, "bound": bound, "glob": glob,
            "cn_judge": cn_judge, "cn_viewer": cn_viewer, "eg_judge": eg_judge,
            "b": sign_in(APIClient(), bound), "g": sign_in(APIClient(), glob)}


def _url(role):
    return f"/api/v1/perm/roles/{role.pk}/members/"


def _names(res):
    assert res.status_code == 200, res.content
    return [row["username"] for row in res.json()["results"]]


def test_members_list_main_holders_first_then_extras_and_only_this_hall(world):
    names = _names(world["b"].get(_url(world["judge"])))
    assert names == ["cn_judge", "cn_viewer"]
    assert "eg_judge" not in names
    # 全局 ADMIN 看全部殿
    assert {"cn_judge", "cn_viewer", "eg_judge"} <= set(_names(world["g"].get(_url(world["judge"]))))
    # 搜索;不持有的人不出现
    assert _names(world["b"].get(_url(world["judge"]), {"search": "view"})) == ["cn_viewer"]
    assert _names(world["b"].get(_url(world["scribe"]))) == []


def test_members_are_admin_only(world):
    res = sign_in(APIClient(), world["cn_judge"]).get(_url(world["judge"]))
    assert res.status_code == 403
    assert world["b"].get("/api/v1/perm/roles/999999/members/").status_code == 404


def test_batch_add_as_extra_and_as_primary_then_remove_writes_audit(world, django_capture_on_commit_callbacks):
    b, j, v = world["b"], world["cn_judge"], world["cn_viewer"]
    with django_capture_on_commit_callbacks(execute=True):  # the audit row is written on commit
        res = b.post(_url(world["scribe"]), {"action": "add", "kind": "extra", "user_ids": [j.pk, v.pk]},
                     format="json")
    assert res.status_code == 200, res.content
    assert res.json() == {"changed": 2, "unchanged": 0}
    j.refresh_from_db()
    v.refresh_from_db()
    assert j.role == "JUDGE" and j.extra_roles == ["SCRIBE"]
    assert v.extra_roles == ["JUDGE", "SCRIBE"]
    row = AuditLog.objects.get(action="UPDATE", resource_id=str(j.pk))
    assert row.user == world["bound"]
    assert "extra_roles" in row.changes and "role" not in row.changes

    res = b.post(_url(world["scribe"]), {"action": "add", "kind": "primary", "user_ids": [j.pk]}, format="json")
    assert res.status_code == 200, res.content
    j.refresh_from_db()
    assert j.role == "SCRIBE" and j.extra_roles == []  # the extra it now holds as main goes

    res = b.post(_url(world["scribe"]), {"action": "remove", "kind": "extra", "user_ids": [v.pk]}, format="json")
    assert res.status_code == 200
    v.refresh_from_db()
    assert v.extra_roles == ["JUDGE"]
    # 再移一次:没有变化
    n = AuditLog.objects.filter(resource_id=str(v.pk)).count()
    with django_capture_on_commit_callbacks(execute=True):
        res = b.post(_url(world["scribe"]), {"action": "remove", "kind": "extra", "user_ids": [v.pk]}, format="json")
    assert res.json() == {"changed": 0, "unchanged": 1}
    assert AuditLog.objects.filter(resource_id=str(v.pk)).count() == n  # a no-op writes no row


def test_main_role_cannot_be_removed_directly(world):
    j = world["cn_judge"]
    res = world["b"].post(_url(world["judge"]), {"action": "remove", "kind": "primary", "user_ids": [j.pk]},
                          format="json")
    assert res.status_code == 400
    assert res.json()["refusals"][0]["code"] == "primary_needs_replacement"
    j.refresh_from_db()
    assert j.role == "JUDGE"


def test_bound_admin_cannot_touch_another_halls_user_and_nothing_in_the_batch_moves(world):
    j, e = world["cn_judge"], world["eg_judge"]
    res = world["b"].post(_url(world["scribe"]), {"action": "add", "kind": "extra", "user_ids": [j.pk, e.pk]},
                          format="json")
    assert res.status_code == 400
    assert [(r["user_id"], r["code"]) for r in res.json()["refusals"]] == [(e.pk, "not_found")]
    j.refresh_from_db()
    e.refresh_from_db()
    assert j.extra_roles == [] and e.extra_roles == []
    # 全局 ADMIN 可以
    res = world["g"].post(_url(world["scribe"]), {"action": "add", "kind": "extra", "user_ids": [e.pk]},
                          format="json")
    assert res.status_code == 200
    e.refresh_from_db()
    assert e.extra_roles == ["SCRIBE"]


def test_same_rules_as_assign_roles(world):
    """绑殿 ADMIN 不能任命 ADMIN;ADMIN 不能兼任 —— 与 assign_roles 同一个函数。"""
    j = world["cn_judge"]
    res = world["b"].post(_url(world["admin"]), {"action": "add", "kind": "primary", "user_ids": [j.pk]},
                          format="json")
    assert res.status_code == 403
    assert res.json()["refusals"][0]["code"] == "forbidden"
    res = world["g"].post(_url(world["admin"]), {"action": "add", "kind": "extra", "user_ids": [j.pk]},
                          format="json")
    assert res.status_code == 400
    assert res.json()["refusals"][0]["code"] == "invalid"
    j.refresh_from_db()
    assert j.role == "JUDGE" and j.extra_roles == []
    # 全局 ADMIN 任命主角色 ADMIN:放行
    res = world["g"].post(_url(world["admin"]), {"action": "add", "kind": "primary", "user_ids": [j.pk]},
                          format="json")
    assert res.status_code == 200
    j.refresh_from_db()
    assert j.role == "ADMIN"


def test_assign_roles_still_refuses_and_accepts_after_the_extraction(world):
    j = world["cn_judge"]
    b = world["b"]
    assert b.post(f"/api/v1/users/{j.pk}/assign_roles/", {"extra_roles": ["NOPE"]}, format="json").status_code == 400
    ok = b.post(f"/api/v1/users/{j.pk}/assign_roles/", {"extra_roles": ["SCRIBE", "SCRIBE", "JUDGE"]}, format="json")
    assert ok.status_code == 200
    j.refresh_from_db()
    assert j.extra_roles == ["SCRIBE"]


def test_granting_and_revoking_through_the_drawer_pushes_a_permission_refresh(world, monkeypatch,
                                                                              django_capture_on_commit_callbacks):
    """Decision 10: every user whose roles changed gets `push_permission_refresh`; an unchanged one
    (already holding the role) gets nothing."""
    from apps.perm import members

    pushed = []
    monkeypatch.setattr(members, "push_permission_refresh", lambda uid=None: pushed.append(uid))
    j, v = world["cn_judge"], world["cn_viewer"]
    with django_capture_on_commit_callbacks(execute=True):
        res = world["b"].post(_url(world["scribe"]), {"action": "add", "kind": "extra", "user_ids": [j.pk, v.pk]},
                              format="json")
    assert res.status_code == 200, res.content
    assert sorted(pushed) == sorted([j.pk, v.pk])

    pushed.clear()
    res = world["b"].post(_url(world["judge"]), {"action": "add", "kind": "extra", "user_ids": [v.pk]}, format="json")
    assert res.status_code == 200 and res.json()["unchanged"] == 1
    assert pushed == []  # already held: nothing changed, nothing pushed

    res = world["b"].post(_url(world["scribe"]), {"action": "remove", "kind": "extra", "user_ids": [v.pk]},
                          format="json")
    assert res.status_code == 200 and pushed == [v.pk]


def test_batch_touching_another_admin_follows_the_admin_target_rule(world):
    """审计 2026-11-11 P-01:抽屉的「授为主角色」曾不过 `_admin_target_refusal`,绑殿 ADMIN 可把同殿另一位 ADMIN
    降成 VIEWER,随后重置其密码。现在与 `assign_roles` 同一条:只许无殿 ADMIN 且带自己的两步验证码,整批不动。"""
    from tests.test_admin_account_actions_hardened import _code, _enable_mfa

    peer = User.objects.create_user(username="cn_admin2", password="x", role="ADMIN", tenant=world["cn"])
    viewer = Role.objects.get_or_create(name="VIEWER", defaults={"display_name": "Viewer"})[0]
    body = {"action": "add", "kind": "primary", "user_ids": [world["cn_judge"].pk, peer.pk]}

    res = world["b"].post(_url(viewer), body, format="json")
    assert res.status_code == 403, res.content
    assert res.json()["code"] == "admin_target_global_only"
    # 全局 ADMIN 没开两步验证也不行
    res = world["g"].post(_url(viewer), body, format="json")
    assert res.status_code == 403 and res.json()["code"] == "second_factor_unavailable"
    peer.refresh_from_db()
    world["cn_judge"].refresh_from_db()
    assert peer.role == "ADMIN" and world["cn_judge"].role == "JUDGE"  # 整批不动

    row, _ = _enable_mfa(world["glob"])
    res = world["g"].post(_url(viewer), {**body, "mfa_code": _code(row)}, format="json")
    assert res.status_code == 200, res.content
    peer.refresh_from_db()
    assert peer.role == "VIEWER"
