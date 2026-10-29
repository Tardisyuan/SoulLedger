"""数据范围求解器(B2,`apps/perm/data_scope.py`):五种范围 × 本机构 / 下级 / 平级 / 上级 / 别殿 / 空机构 /
本人创建 / 指派;多角色并集;按业务覆盖优先于默认;兼任算、已删的不算;没有配置 = 全部;ADMIN 跳过;
序列化器外键(`tenant_scoped`)把范围外的行当作不存在;注册表每条路径都能编译成查询;真 PG 上走索引。
"""
from types import SimpleNamespace

import pytest
from django.apps import apps
from django.db import connection
from rest_framework import serializers

from apps.authentication.models import User
from apps.core.tenant import scope_to_tenant
from apps.core.tenant_fields import same_tenant_or_404_message
from apps.judgment.models import CityGod, Judgment
from apps.org.models import Organization
from apps.org.ownership import tenant_root
from apps.perm import data_scope
from apps.perm.filters import DataScopeFilter
from apps.perm.models import Role
from apps.souls.models import Soul
from apps.workflow.models import ApprovalNode, ApprovalWorkflow, ApprovalWorkflowStatus, NodeStatus
from tests.data_scope_support import org, scope
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db

CN_ALL = {"上级", "本机构", "下级", "平级", "空", "本人创建"}


@pytest.fixture
def w(cn_tenant, eu_tenant):
    root = tenant_root(cn_tenant)
    a = org(cn_tenant, "甲司")
    a1 = org(cn_tenant, "甲司一科", parent=a)
    b = org(cn_tenant, "乙司")
    e = org(eu_tenant, "欧司")
    user = User.objects.create_user(username="ds_judge", password="x", role="JUDGE", tenant=cn_tenant, organization=a)

    def soul(name, owner, tenant=cn_tenant, **kw):
        return Soul.objects.create(name=name, tenant=tenant, owner_org=owner, **kw)

    soul("上级", root)
    soul("本机构", a)
    soul("下级", a1)
    soul("平级", b)
    soul("别殿", e, tenant=eu_tenant)
    Soul.all_objects.filter(pk=soul("空", root).pk).update(owner_org=None)
    soul("本人创建", b, create_user=user)
    return SimpleNamespace(root=root, a=a, a1=a1, b=b, e=e, user=user, tenant=cn_tenant)


def _req(user):
    return SimpleNamespace(user=user, tenant=user.tenant, method="GET")


def _names(user, model=Soul, isolate=True, field="name"):
    req = _req(user)
    qs = model._base_manager.all()
    if isolate:
        qs = scope_to_tenant(qs, req)
    return set(DataScopeFilter.filter_queryset(req, qs, model).values_list(field, flat=True))


@pytest.mark.parametrize("value,orgs,expected", [
    ("ALL", [], CN_ALL),
    ("ORG_CHILD", [], {"本机构", "下级", "本人创建"}),
    ("ORG", [], {"本机构", "本人创建"}),
    ("SELF", [], {"本人创建"}),
    ("DEFINE", ["b"], {"平级", "本人创建"}),
    ("DEFINE", ["a"], {"本机构", "下级", "本人创建"}),  # 含所列机构的下级
    ("DEFINE", ["root"], CN_ALL - {"空"}),  # 没有归属机构的行只有 ALL 看得到
    ("DEFINE", ["e"], {"本人创建"}),  # 别殿的机构:殿级隔离先滤掉
])
def test_each_scope_over_superior_own_child_peer_foreign_empty_and_mine(w, value, orgs, expected):
    scope("JUDGE", value, orgs=[getattr(w, o) for o in orgs])
    assert _names(w.user) == expected


def test_the_hall_layer_not_the_scope_is_what_drops_another_halls_define(w):
    scope("JUDGE", "DEFINE", orgs=[w.e])
    assert "别殿" in _names(w.user, isolate=False)
    assert "别殿" not in _names(w.user)


def test_a_user_without_an_organization_sees_only_their_own_under_org_scopes(w):
    w.user.organization = None
    w.user.save(update_fields=["organization"])
    scope("JUDGE", "ORG_CHILD")
    assert _names(w.user) == {"本人创建"}


def test_no_config_row_means_everything_and_the_same_queryset(w):
    qs = Soul.objects.all()
    assert DataScopeFilter.filter_queryset(_req(w.user), qs, Soul) is qs
    assert _names(w.user) == CN_ALL


def test_a_user_with_no_role_is_not_narrowed(w):
    scope("JUDGE", "SELF")
    w.user.role = ""
    assert _names(w.user) == CN_ALL


def test_a_model_outside_the_registry_is_untouched(w):
    from apps.dispatch.models import DispatchRecord

    scope("JUDGE", "SELF")
    qs = DispatchRecord.objects.all()
    assert DataScopeFilter.filter_queryset(_req(w.user), qs, DispatchRecord) is qs


def test_roles_union_and_any_all_is_unlimited(w):
    scope("JUDGE", "ORG")
    scope("VIEWER", "DEFINE", orgs=[w.b])
    w.user.extra_roles = ["VIEWER"]
    assert _names(w.user) == {"本机构", "平级", "本人创建"}
    scope("GUARDIAN", "ALL")
    w.user.extra_roles = ["VIEWER", "GUARDIAN"]
    assert _names(w.user) == CN_ALL


def test_a_held_role_with_no_config_is_unlimited(w):
    scope("JUDGE", "ORG")
    Role.objects.get_or_create(name="VIEWER")
    w.user.extra_roles = ["VIEWER"]
    assert _names(w.user) == CN_ALL


def test_a_deleted_extra_role_does_not_count(w):
    scope("JUDGE", "ORG")
    scope("GHOST", "ALL")
    Role.all_objects.filter(name="GHOST").update(is_deleted=True)
    w.user.extra_roles = ["GHOST"]
    assert _names(w.user) == {"本机构", "本人创建"}


def test_a_per_resource_override_beats_the_default(w):
    scope("JUDGE", "ORG")
    scope("JUDGE", "SELF", resource="soul")
    assert _names(w.user) == {"本人创建"}
    case_soul = Soul.objects.create(name="案魂", tenant=w.tenant, owner_org=w.a)
    Judgment.objects.create(soul=case_soul, civilization=case_soul.civilization, tenant=w.tenant, owner_org=w.a)
    assert _names(w.user, Judgment, field="soul__name") == {"案魂"}  # 审判仍按默认 ORG


def test_admin_skips_the_scope(w):
    admin = User.objects.create_user(username="ds_admin", password="x", role="ADMIN", tenant=w.tenant, organization=w.a)
    scope("ADMIN", "SELF")
    assert _names(admin) == CN_ALL


def test_assigned_judgments_are_visible_under_self_without_duplicates(w):
    scope("JUDGE", "SELF")
    god = CityGod.objects.create(tenant=w.tenant, name="城隍")
    god.officers.add(w.user, User.objects.create_user(username="ds_peer", password="x", role="JUDGE", tenant=w.tenant))

    def case(name, **kw):
        s = Soul.objects.create(name=name, tenant=w.tenant, owner_org=w.b)
        return Judgment.objects.create(soul=s, civilization=s.civilization, tenant=w.tenant, owner_org=w.b, **kw)

    mine = [case("认领", claimed_by=w.user), case("结案", concluded_by=w.user), case("城隍", city_god=god)]
    case("别人的")
    req = _req(w.user)
    seen = list(DataScopeFilter.filter_queryset(req, Judgment.objects.filter(tenant=w.tenant), Judgment)
                .values_list("pk", flat=True))
    assert sorted(seen) == sorted(j.pk for j in mine)


def test_a_workflow_awaiting_my_role_is_visible_outside_my_orgs(w):
    scope("JUDGE", "ORG")

    def flow(name, role, status=NodeStatus.PENDING):
        s = Soul.objects.create(name=name, tenant=w.tenant, owner_org=w.b)
        wf = ApprovalWorkflow.objects.create(soul=s, workflow_name=name, case_type="STANDARD",
                                             status=ApprovalWorkflowStatus.IN_PROGRESS, tenant=w.tenant)
        node = ApprovalNode.objects.create(workflow=wf, node_name="初审", node_order=1, node_type="EVALUATION",
                                           approver_type="ROLE", approver_role=role, status=status)
        wf.current_node = node
        wf.save(update_fields=["current_node"])
        return wf

    flow("待我", "JUDGE")
    flow("待别人", "MODERATOR")
    flow("我已批", "JUDGE", status=NodeStatus.APPROVED)
    assert _names(w.user, ApprovalWorkflow, field="workflow_name") == {"待我"}


def test_a_pending_cosigner_and_an_open_countersign_slot_count_as_awaiting_me(w):
    """用户 2026-10-29:加签人(未签)、会签候选人(还有一格)也算「待我审批」,与 todo 的 `can_approve` 同口径。"""
    from apps.workflow.models import NodeKind

    scope("JUDGE", "ORG")

    def flow(name, **node):
        s = Soul.objects.create(name=name, tenant=w.tenant, owner_org=w.b)
        wf = ApprovalWorkflow.objects.create(soul=s, workflow_name=name, case_type="STANDARD",
                                             status=ApprovalWorkflowStatus.IN_PROGRESS, tenant=w.tenant)
        wf.current_node = ApprovalNode.objects.create(workflow=wf, node_name="初审", node_order=1,
                                                      node_type="EVALUATION", status=NodeStatus.PENDING, **node)
        wf.save(update_fields=["current_node"])

    def cosigner(signed_at):
        return [{"user_id": w.user.pk, "user_name": "甲", "added_by_id": None, "added_at": None, "signed_at": signed_at}]

    flow("加签未签", approver_type="ROLE", approver_role="MODERATOR", cosigners_json=cosigner(None))
    flow("加签已签", approver_type="ROLE", approver_role="MODERATOR", cosigners_json=cosigner("2026-10-29T00:00:00"))
    flow("会签有我", kind=NodeKind.COUNTERSIGN, approver_type="SYSTEM",
         signers_json=[{"approver_type": "ROLE", "approver_role": "JUDGE"}])
    flow("会签已签", kind=NodeKind.COUNTERSIGN, approver_type="SYSTEM",
         signers_json=[{"approver_type": "ROLE", "approver_role": "JUDGE"}],
         signatures_json=[{"signer": 0, "user_id": w.user.pk, "passed": True}])
    flow("会签没我", kind=NodeKind.COUNTERSIGN, approver_type="SYSTEM",
         signers_json=[{"approver_type": "ROLE", "approver_role": "MODERATOR"}])
    assert _names(w.user, ApprovalWorkflow, field="workflow_name") == {"加签未签", "会签有我"}


def test_users_and_orgs_follow_the_org_scope(w):
    scope("JUDGE", "ORG_CHILD")
    User.objects.create_user(username="ds_child", password="x", role="JUDGE", tenant=w.tenant, organization=w.a1)
    User.objects.create_user(username="ds_peer", password="x", role="JUDGE", tenant=w.tenant, organization=w.b)
    assert _names(w.user, User, field="username") == {"ds_judge", "ds_child"}
    assert _names(w.user, Organization, field="pk") == {w.a.pk, w.a1.pk}


def test_a_serializer_foreign_key_outside_the_scope_is_refused_like_another_halls(w):
    ctx = {"request": SimpleNamespace(user=w.user, tenant=w.tenant)}
    inside, outside = Soul.objects.get(name="本机构"), Soul.objects.get(name="平级")
    assert same_tenant_or_404_message(outside, ctx, "soul") is outside  # 没配置:照旧
    scope("JUDGE", "ORG")
    ctx = {"request": SimpleNamespace(user=w.user, tenant=w.tenant)}  # 新请求,新缓存
    assert same_tenant_or_404_message(inside, ctx, "soul") is inside
    with pytest.raises(serializers.ValidationError):
        same_tenant_or_404_message(outside, ctx, "soul")


def test_visible_to_keys_its_cache_by_person(w):
    scope("JUDGE", "ORG")
    other = User.objects.create_user(username="ds_mod", password="x", role="MODERATOR", tenant=w.tenant)
    outside = Soul.objects.get(name="平级")
    cache = {}
    assert data_scope.visible_to(w.user, outside, cache) is False
    assert data_scope.visible_to(other, outside, cache) is True


def test_the_soul_list_and_detail_over_http(w):
    scope("JUDGE", "ORG")
    client = officer_client(w.user)
    names = {row["name"] for row in client.get("/api/v1/souls/").data["results"]}
    assert names == {"本机构", "本人创建"}
    assert client.get(f"/api/v1/souls/{Soul.objects.get(name='平级').pk}/").status_code == 404
    assert client.get(f"/api/v1/souls/{Soul.objects.get(name='本机构').pk}/").status_code == 200


@pytest.mark.parametrize("label", sorted(data_scope.REGISTRY))
def test_every_registry_path_compiles_and_runs(w, label):
    scope("JUDGE", "ORG")
    model = apps.get_model(label)
    q = data_scope.q_for(w.user, model, {})
    assert q is not None
    list(model._base_manager.filter(q).values_list("pk", flat=True)[:1])


@pytest.mark.skipif(connection.vendor == "sqlite", reason="EXPLAIN 计划只在 PostgreSQL 上有意义")
def test_the_scoped_soul_list_uses_the_tenant_owner_index(w):
    orgs = [org(w.tenant, f"分司{i}") for i in range(20)]
    Soul.all_objects.bulk_create(
        Soul(name=f"批{i}", tenant=w.tenant, home_tenant=w.tenant, owner_org=orgs[i % 20]) for i in range(10_000))
    with connection.cursor() as cur:
        cur.execute("ANALYZE souls_soul")
    scope("JUDGE", "ORG")
    w.user.organization = orgs[3]
    req = _req(w.user)
    qs = DataScopeFilter.filter_queryset(req, Soul.all_objects.filter(tenant=w.tenant), Soul)
    plan = qs.explain()
    # 实测(unRAID pg16,1 万行 / 20 机构):OR(本机构 ∪ 本人创建)下规划器用外键自带的单列 owner_org 索引
    # 做 BitmapOr,而不是 (tenant, owner_org) 复合索引 —— 两者都是按机构取行。要断的是「按机构走索引、
    # 不全表扫」,不是哪一个索引名。
    assert "Seq Scan on souls_soul" not in plan, plan
    assert any(name in plan for name in ("souls_soul_tenant_owner_idx", "souls_soul_owner_org_id")), plan
