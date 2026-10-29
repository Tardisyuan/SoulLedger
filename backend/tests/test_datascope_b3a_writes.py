"""数据范围 B3a:灵魂 / 审判 / 机构的写入侧(local-gates/rbac-2026-10-29/datascope-design.md「取值」「执行点 · 对象级」)。

殿主(MODERATOR)坐在机构 A,配「仅本机构」(ORG);B 是 A 的平级。每条反例都同时断言范围内的那一行照常 ——
只断言「范围外被拒」的测试,在一个什么都拒的实现上也是绿的。
"""
import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.audit.models import AuditLog
from apps.authentication.models import User
from apps.judgment.models import Judgment
from apps.org.models import Organization
from apps.perm.models import RoleDataScope
from apps.souls.models import Soul, SoulState
from tests.data_scope_support import org, scope

pytestmark = pytest.mark.django_db


def _grant(prefixes=("soul.", "judgment.", "org."), extra=(("MODERATOR", "soul.delete"),)):
    """按 ROLE_PERMISSIONS 把这几族码写进库(库里有 Permission 行时 checker 以库为准);殿主另给 soul.delete,
    好走到回收 / 归档 / 批量回收的范围判定(否则先被码名 403 挡住)。"""
    from apps.perm.cache import invalidate_all_permissions
    from apps.perm.models import DEFAULT_PERMISSIONS, ROLE_PERMISSIONS, Permission, Role, RolePermission

    perms = {}
    for codename, name, category in DEFAULT_PERMISSIONS:
        if codename.startswith(prefixes):
            perms[codename] = Permission.objects.get_or_create(
                codename=codename, defaults={"name": name, "category": category})[0]
    grants = {r: list(c) for r, c in ROLE_PERMISSIONS.items()}
    for role_name, codename in extra:
        grants.setdefault(role_name, []).append(codename)
    for role_name, codes in grants.items():
        role = Role.objects.get_or_create(name=role_name, defaults={"display_name": role_name.title()})[0]
        for codename in codes:
            if codename in perms:
                RolePermission.objects.get_or_create(role=role, permission=perms[codename])
    invalidate_all_permissions()


def _client(user):
    token = RefreshToken.for_user(user)
    if user.tenant is not None:
        token["tenant_code"] = user.tenant.code
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return client


class World:
    pass


@pytest.fixture
def w(cn_tenant, eu_tenant):
    _grant()
    x = World()
    x.cn = cn_tenant
    x.A, x.B = org(cn_tenant, "甲司"), org(cn_tenant, "乙司")
    x.A1 = org(cn_tenant, "甲司下", parent=x.A)
    x.eu_unit = org(eu_tenant, "别殿司")
    x.mod = User.objects.create_user(username="b3a_mod", password="x", role="MODERATOR", tenant=cn_tenant,
                                     organization=x.A)
    x.judge_b = User.objects.create_user(username="b3a_judge_b", password="x", role="JUDGE", tenant=cn_tenant,
                                         organization=x.B)
    x.judge_a = User.objects.create_user(username="b3a_judge_a", password="x", role="JUDGE", tenant=cn_tenant,
                                         organization=x.A)
    scope("MODERATOR", "ORG")
    scope("JUDGE", "ORG")
    x.sA = Soul.objects.create(name="甲魂", birth_date="1900-01-01", current_state=SoulState.JUDGING,
                               tenant=cn_tenant, owner_org=x.A)
    x.sB = Soul.objects.create(name="乙魂", birth_date="1900-01-01", current_state=SoulState.JUDGING,
                               tenant=cn_tenant, owner_org=x.B)
    x.jA = Judgment.objects.create(soul=x.sA, civilization=x.sA.civilization, court="第一殿", tenant=cn_tenant,
                                   owner_org=x.A)
    x.jB = Judgment.objects.create(soul=x.sB, civilization=x.sB.civilization, court="第一殿", tenant=cn_tenant,
                                   owner_org=x.B)
    x.c = _client(x.mod)
    return x


# ── 建时显式给 owner_org ────────────────────────────────────────────────


def test_a_new_soul_takes_an_owner_in_scope_and_refuses_one_outside(w):
    url = "/api/v1/souls/"
    body = {"name": "新魂", "birth_date": "1900-01-01", "origin_location": "x"}
    assert w.c.post(url, {**body, "owner_org": w.B.pk}, format="json").status_code == 400
    assert w.c.post(url, {**body, "owner_org": w.eu_unit.pk}, format="json").status_code == 400
    assert not Soul.objects.filter(name="新魂").exists()
    res = w.c.post(url, {**body, "owner_org": w.A.pk}, format="json")
    assert res.status_code == 201, res.data
    assert Soul.objects.get(pk=res.data["id"]).owner_org_id == w.A.pk
    assert res.data["owner_org_name"] == "甲司"
    # 不给 = 默认(建人的机构)。
    res = w.c.post(url, {**body, "name": "默认魂"}, format="json")
    assert res.status_code == 201, res.data
    assert Soul.objects.get(pk=res.data["id"]).owner_org_id == w.A.pk


def test_opening_a_case_with_an_owner_outside_the_scope_is_400(w):
    Judgment.objects.filter(pk=w.jA.pk).update(is_deleted=True)  # 让甲魂没有未结案件
    res = w.c.post("/api/v1/judgment/", {"soul": str(w.sA.pk), "court": "第一殿", "owner_org": w.B.pk}, format="json")
    assert res.status_code == 400, res.data
    assert "owner_org" in res.data
    # 开案的灵魂在范围外:同样 400(序列化器外键经 tenant_scoped 叠加范围)。
    Judgment.objects.filter(pk=w.jB.pk).update(is_deleted=True)
    res = w.c.post("/api/v1/judgment/", {"soul": str(w.sB.pk), "court": "第一殿"}, format="json")
    assert res.status_code == 400, res.data
    assert "soul" in res.data


# ── 建后改 owner_org ────────────────────────────────────────────────────


def test_changing_a_souls_owner_stays_in_scope_and_is_audited(w, django_capture_on_commit_callbacks):
    scope("MODERATOR", "ORG_CHILD", resource="soul")
    url = f"/api/v1/souls/{w.sA.pk}/"
    assert w.c.patch(url, {"owner_org": w.B.pk}, format="json").status_code == 400
    assert w.c.patch(url, {"owner_org": w.eu_unit.pk}, format="json").status_code == 400
    assert Soul.objects.get(pk=w.sA.pk).owner_org_id == w.A.pk
    with django_capture_on_commit_callbacks(execute=True):
        res = w.c.patch(url, {"owner_org": w.A1.pk}, format="json")
    assert res.status_code == 200, res.data
    assert Soul.objects.get(pk=w.sA.pk).owner_org_id == w.A1.pk
    assert any("owner_org" in (row.changes or {})
               for row in AuditLog.objects.filter(resource_id=str(w.sA.pk), action="UPDATE"))


def test_changing_a_judgments_owner_needs_judgment_assign(w):
    scope("JUDGE", "ORG_CHILD", resource="judgment")
    scope("MODERATOR", "ORG_CHILD", resource="judgment")
    url = f"/api/v1/judgment/{w.jA.pk}/"
    res = _client(w.judge_a).patch(url, {"owner_org": w.A1.pk}, format="json")
    assert res.status_code == 403, res.data
    assert Judgment.objects.get(pk=w.jA.pk).owner_org_id == w.A.pk
    # 不改 owner_org 的 PATCH 对判官照旧。
    assert _client(w.judge_a).patch(url, {"summary": "案由"}, format="json").status_code == 200
    assert w.c.patch(url, {"owner_org": w.B.pk}, format="json").status_code == 400
    res = w.c.patch(url, {"owner_org": w.A1.pk}, format="json")
    assert res.status_code == 200, res.data
    assert Judgment.objects.get(pk=w.jA.pk).owner_org_id == w.A1.pk


# ── 对象级:范围外 404 ──────────────────────────────────────────────────


def test_out_of_scope_rows_are_404_on_detail_update_delete_and_actions(w):
    for verb, url in (("get", f"/api/v1/souls/{w.sB.pk}/"), ("patch", f"/api/v1/souls/{w.sB.pk}/"),
                      ("delete", f"/api/v1/souls/{w.sB.pk}/"), ("post", f"/api/v1/souls/{w.sB.pk}/archive/"),
                      ("get", f"/api/v1/judgment/{w.jB.pk}/"), ("patch", f"/api/v1/judgment/{w.jB.pk}/"),
                      ("post", f"/api/v1/judgment/{w.jB.pk}/claim/")):
        assert getattr(w.c, verb)(url, {}, format="json").status_code == 404, (verb, url)
    assert Soul.objects.filter(pk=w.sB.pk).exists() and Judgment.objects.get(pk=w.jB.pk).claimed_by_id is None
    assert w.c.get(f"/api/v1/souls/{w.sA.pk}/").status_code == 200
    assert w.c.get(f"/api/v1/judgment/{w.jA.pk}/").status_code == 200


# ── 批量与导出 ──────────────────────────────────────────────────────────


def test_batch_actions_answer_out_of_scope_ids_as_not_found(w):
    res = w.c.post("/api/v1/souls/batch-recycle/", {"ids": [str(w.sA.pk), str(w.sB.pk)]}, format="json")
    assert res.status_code == 404, res.data
    assert [str(i) for i in res.data["ids"]] == [str(w.sB.pk)]
    assert not Soul.all_objects.get(pk=w.sA.pk).is_deleted  # 整批不动
    res = w.c.post("/api/v1/judgment/batch/", {"operation": "claim", "ids": [str(w.jA.pk), str(w.jB.pk)]},
                   format="json")
    assert res.status_code == 404, res.data
    assert res.data["missing"] == [str(w.jB.pk)]
    assert Judgment.objects.get(pk=w.jA.pk).claimed_by_id is None
    res = w.c.post("/api/v1/judgment/batch/", {"operation": "claim", "ids": [str(w.jA.pk)]}, format="json")
    assert res.status_code == 200, res.data


def test_exports_leave_out_of_scope_rows_out(w):
    for url, inside, outside in (
        ("/api/v1/souls/export/", w.sA, w.sB),
        (f"/api/v1/souls/export/?ids={w.sA.pk},{w.sB.pk}", w.sA, w.sB),
        ("/api/v1/judgment/export/", w.jA, w.jB),
    ):
        res = w.c.get(url)
        assert res.status_code == 200, url
        text = b"".join(res.streaming_content).decode() if res.streaming else res.content.decode()
        assert str(inside.pk) in text and str(outside.pk) not in text, url


# ── 改派与交接:对方的范围要看得到 ─────────────────────────────────────


def test_reassigning_to_an_officer_who_cannot_see_the_case_is_400(w):
    url = f"/api/v1/judgment/{w.jA.pk}/reassign/"
    res = w.c.post(url, {"to": w.judge_b.pk}, format="json")
    assert res.status_code == 400, res.data
    assert res.data["code"] == "assignee_out_of_scope"
    assert Judgment.objects.get(pk=w.jA.pk).claimed_by_id is None
    officers = w.c.get(f"/api/v1/judgment/assignable-officers/?judgment={w.jA.pk}").data
    ids = {o["id"] for o in officers}
    assert w.judge_b.pk not in ids and w.judge_a.pk in ids
    res = w.c.post("/api/v1/judgment/batch/", {"operation": "reassign", "ids": [str(w.jA.pk)], "to": w.judge_b.pk},
                   format="json")
    assert res.status_code == 400 and res.data["code"] == "assignee_out_of_scope", res.data
    res = w.c.post(url, {"to": w.judge_a.pk}, format="json")
    assert res.status_code == 200, res.data
    assert Judgment.objects.get(pk=w.jA.pk).claimed_by_id == w.judge_a.pk


def test_handing_over_to_an_officer_who_cannot_see_the_cases_is_blocked(w):
    Judgment.objects.filter(pk=w.jA.pk).update(claimed_by=w.judge_a)
    other_a = User.objects.create_user(username="b3a_judge_a2", password="x", role="JUDGE", tenant=w.cn,
                                       organization=w.A)
    res = w.c.post("/api/v1/judgment/handover/preview/", {"from": w.judge_a.pk, "to": w.judge_b.pk}, format="json")
    assert res.status_code == 200, res.data
    assert "target_out_of_scope" in res.data["problems"]
    res = w.c.post("/api/v1/judgment/handover/", {"from": w.judge_a.pk, "to": w.judge_b.pk}, format="json")
    assert res.status_code == 409 and "target_out_of_scope" in res.data["problems"], res.data
    assert Judgment.objects.get(pk=w.jA.pk).claimed_by_id == w.judge_a.pk
    res = w.c.post("/api/v1/judgment/handover/preview/", {"from": w.judge_a.pk, "to": other_a.pk}, format="json")
    assert "target_out_of_scope" not in res.data["problems"], res.data
    assert w.c.post("/api/v1/judgment/handover/", {"from": w.judge_a.pk, "to": other_a.pk},
                    format="json").status_code == 200
    assert Judgment.objects.get(pk=w.jA.pk).claimed_by_id == other_a.pk


# ── 机构删除 ?move_to= ─────────────────────────────────────────────────


def test_deleting_a_unit_moves_its_souls_and_judgments_first(w):
    RoleDataScope.objects.filter(role__name="MODERATOR").delete()  # 全部:B 看得见、可删
    gone = org(w.cn, "将删")
    Soul.objects.filter(pk=w.sB.pk).update(owner_org=gone)
    Judgment.objects.filter(pk=w.jB.pk).update(owner_org=gone)
    url = f"/api/v1/organizations/{gone.pk}/"
    res = w.c.delete(url)
    assert res.status_code == 409 and res.data["souls"] == 1 and res.data["judgments"] == 1, res.data
    for bad in (gone.pk, w.eu_unit.pk, "x"):
        assert w.c.delete(f"{url}?move_to={bad}").status_code == 400, bad
    assert Organization.objects.filter(pk=gone.pk).exists()
    assert w.c.delete(f"{url}?move_to={w.B.pk}").status_code == 204
    assert not Organization.objects.filter(pk=gone.pk).exists()
    assert Soul.objects.get(pk=w.sB.pk).owner_org_id == w.B.pk
    assert Judgment.objects.get(pk=w.jB.pk).owner_org_id == w.B.pk
    assert Soul.objects.get(pk=w.sA.pk).owner_org_id == w.A.pk  # 别的机构名下不动
    assert AuditLog.objects.filter(resource="organization", resource_id=str(gone.pk), action="BATCH_UPDATE").exists()


def test_move_to_outside_the_callers_scope_is_400_and_nothing_moves(w):
    # 机构接口按范围收窄(B4):机构这项放开成全部,好让 B 在机构列表里看得见 —— 拒的是灵魂 / 审判的范围,不是机构的。
    scope("MODERATOR", "ALL", resource="org")
    gone = org(w.cn, "将删", parent=w.A)
    Soul.objects.filter(pk=w.sA.pk).update(owner_org=gone)
    res = w.c.delete(f"/api/v1/organizations/{gone.pk}/?move_to={w.B.pk}")
    assert res.status_code == 400, res.data
    assert Soul.objects.get(pk=w.sA.pk).owner_org_id == gone.pk
    assert Organization.objects.filter(pk=gone.pk).exists()


def test_move_to_does_not_carry_sub_units_or_people(w):
    RoleDataScope.objects.filter(role__name="MODERATOR").delete()
    res = w.c.delete(f"/api/v1/organizations/{w.A.pk}/?move_to={w.B.pk}")  # A 有下级与人员
    assert res.status_code == 409, res.data
    assert Soul.objects.get(pk=w.sA.pk).owner_org_id == w.A.pk
