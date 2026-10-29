"""数据范围 B1(local-gates/rbac-2026-10-29/datascope-design.md):根机构、用户机构、owner_org 取值、调拨还原、机构删除。

迁移的回填在 `test_datascope_b1_migrations.py`。本批没有任何读取侧改动:没配 RoleDataScope 时行为不变。
"""
import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError, transaction

from apps.authentication.models import User
from apps.dispatch.models import DispatchRecord, DispatchStatus
from apps.dispatch.services import DispatchService
from apps.judgment.models import Judgment
from apps.org.models import Organization
from apps.org.ownership import default_owner_org, tenant_root
from apps.perm.models import Role, RoleDataScope
from apps.souls.models import Soul
from apps.tenants.models import Tenant
from tests.conftest import sign_in

pytestmark = pytest.mark.django_db


def _tenant(code, **kw):
    return Tenant.objects.get_or_create(code=code, defaults={"display_name": f"{code} 名", **kw})[0]


@pytest.fixture
def cn():
    return _tenant("CN_DIYU", hall_name="中国地府")


@pytest.fixture
def eg():
    return _tenant("EG_DUAT")


def _unit(tenant, code, name=None, parent=None):
    return Organization.objects.create(
        name=name or code, code=code, category="CHINESE", tenant=tenant, parent=parent or tenant_root(tenant),
    )


# ── 根机构 ──────────────────────────────────────────────────────────────


def test_tenant_root_is_created_once_named_after_the_hall(cn):
    root = tenant_root(cn)
    assert (root.code, root.name, root.parent_id, root.level, root.category) == ("ROOT_CN_DIYU", "中国地府", None, 0, "CHINESE")
    assert tenant_root(cn).pk == root.pk
    assert Organization.objects.filter(tenant=cn, parent__isnull=True).count() == 1


def test_a_second_live_root_in_one_hall_is_refused_by_the_database(cn, eg):
    tenant_root(cn)
    with pytest.raises(IntegrityError), transaction.atomic():
        Organization.objects.create(name="另一棵树", code="X_TOP", category="CHINESE", tenant=cn)
    # 别殿、无殿、已删的根都不受影响。
    tenant_root(eg)
    Organization.objects.create(name="无殿一", code="NOHALL_1", category="CHINESE")
    Organization.objects.create(name="无殿二", code="NOHALL_2", category="CHINESE")
    # 删掉的根(只有空机构删得掉)下次要用时还原,不撞 code 的唯一约束。
    old = tenant_root(cn)
    old.soft_delete()
    revived = tenant_root(cn)
    assert (revived.pk, revived.is_deleted) == (old.pk, False)


# ── default_owner_org ───────────────────────────────────────────────────


def test_court_prefix_wins_over_the_creator_and_the_root(cn):
    first = _unit(cn, "D1", "第一殿-秦广王")
    clerk_unit = _unit(cn, "CLERK", "文书房")
    clerk = User.objects.create_user(username="b1_clerk", password="x", role="JUDGE", tenant=cn, organization=clerk_unit)
    assert default_owner_org(cn, clerk, court="第一殿") == first
    assert default_owner_org(cn, clerk, court="不存在的殿") == clerk_unit
    assert default_owner_org(cn, clerk) == clerk_unit


def test_creator_in_another_hall_or_without_a_unit_falls_to_the_root(cn, eg):
    away = _unit(eg, "EG_UNIT")
    stranger = User.objects.create_user(username="b1_stranger", password="x", role="JUDGE", tenant=eg, organization=away)
    loner = User.objects.create_user(username="b1_loner", password="x", role="JUDGE", tenant=cn)
    root = tenant_root(cn)
    assert default_owner_org(cn, stranger) == root
    assert default_owner_org(cn, loner) == root
    assert default_owner_org(cn, None) == root
    assert default_owner_org(None, loner) is None


def test_new_soul_and_judgment_are_stamped_and_an_explicit_owner_is_kept(cn):
    unit = _unit(cn, "D2", "第二殿-楚江王")
    officer = User.objects.create_user(username="b1_officer", password="x", role="JUDGE", tenant=cn, organization=unit)
    soul = Soul.objects.create(name="甲", tenant=cn, create_user=officer)
    assert soul.owner_org_id == unit.pk
    other = _unit(cn, "D3", "第三殿-宋帝王")
    judgment = Judgment.objects.create(soul=soul, tenant=cn, court="第三殿", case_number="B1-1")
    assert judgment.owner_org_id == other.pk
    plain = Judgment.objects.create(soul=soul, tenant=cn, case_number="B1-2")
    assert plain.owner_org_id == tenant_root(cn).pk
    kept = Soul.objects.create(name="乙", tenant=cn, create_user=officer, owner_org=other)
    assert kept.owner_org_id == other.pk
    # 建后不自动变:创建人换机构,灵魂不跟走。
    officer.organization = other
    officer.save(update_fields=["organization"])
    soul.name = "甲改"
    soul.save()
    soul.refresh_from_db()
    assert soul.owner_org_id == unit.pk


# ── 调拨:目标殿根,结束暂居还原 ─────────────────────────────────────────


def test_dispatch_moves_ownership_to_the_target_root_and_back(cn, eg):
    unit = _unit(cn, "D4")
    soul = Soul.objects.create(name="客魂", tenant=cn, owner_org=unit)
    record = DispatchRecord.objects.create(
        source_tenant=cn, target_tenant=eg, soul=soul, status=DispatchStatus.APPROVED, reason="受罚", tenant=cn,
    )
    DispatchService.execute(record, "executor")
    soul.refresh_from_db()
    record.refresh_from_db()
    assert soul.owner_org_id == tenant_root(eg).pk
    assert record.source_owner_org_id == unit.pk
    DispatchService.end_residence(soul, actor="system", trigger=DispatchService.RETURN_MANUAL)
    soul.refresh_from_db()
    assert (soul.tenant_id, soul.owner_org_id) == (cn.pk, unit.pk)


def test_residence_ends_at_the_home_root_when_the_source_unit_is_gone(cn, eg):
    unit = _unit(cn, "D5")
    soul = Soul.objects.create(name="客魂二", tenant=cn, owner_org=unit)
    record = DispatchRecord.objects.create(
        source_tenant=cn, target_tenant=eg, soul=soul, status=DispatchStatus.APPROVED, reason="受罚", tenant=cn,
    )
    DispatchService.execute(record, "executor")
    unit.soft_delete()
    soul.refresh_from_db()
    DispatchService.end_residence(soul, actor="system", trigger=DispatchService.RETURN_MANUAL)
    soul.refresh_from_db()
    assert soul.owner_org_id == tenant_root(cn).pk
    assert soul.owner_org_id != unit.pk


# ── 机构接口 ────────────────────────────────────────────────────────────


@pytest.fixture
def admin(api_client, cn_admin_user):
    return sign_in(api_client, cn_admin_user)


def test_the_api_does_not_create_a_root_or_turn_a_unit_into_one(admin, cn_admin_user):
    hall = cn_admin_user.tenant
    root = tenant_root(hall)
    res = admin.post("/api/v1/organizations/", {"name": "新", "code": "B1_NEW", "category": "CHINESE"}, format="json")
    assert res.status_code == 400, res.data
    assert "parent" in res.data
    assert not Organization.objects.filter(code="B1_NEW").exists()
    res = admin.post(
        "/api/v1/organizations/", {"name": "新", "code": "B1_NEW", "category": "CHINESE", "parent": root.pk}, format="json",
    )
    assert res.status_code == 201, res.data
    res = admin.patch(f"/api/v1/organizations/{res.data['id']}/", {"parent": None}, format="json")
    assert res.status_code == 400, res.data
    assert Organization.objects.get(code="B1_NEW").parent_id == root.pk
    # 根自己改名不受限(parent 仍为空)。
    res = admin.patch(f"/api/v1/organizations/{root.pk}/", {"name": "地府"}, format="json")
    assert res.status_code == 200, res.data
    assert Organization.objects.get(pk=root.pk).name == "地府"


def test_delete_is_refused_while_the_unit_owns_souls_or_judgments(admin, cn_admin_user):
    hall = cn_admin_user.tenant
    unit = _unit(hall, "B1_OWNS")
    soul = Soul.objects.create(name="名下", tenant=hall, owner_org=unit)
    Judgment.objects.create(soul=soul, tenant=hall, case_number="B1-3", owner_org=unit)
    res = admin.delete(f"/api/v1/organizations/{unit.pk}/")
    assert res.status_code == 409, res.data
    assert res.data["code"] == "not_empty"
    assert (res.data["units"], res.data["people"], res.data["souls"], res.data["judgments"]) == (0, 0, 1, 1)
    assert not Organization.all_objects.get(pk=unit.pk).is_deleted
    # 已删的灵魂 / 审判不算。
    empty = _unit(hall, "B1_EMPTY")
    gone = Soul.objects.create(name="已删", tenant=hall, owner_org=empty)
    gone.soft_delete()
    assert admin.delete(f"/api/v1/organizations/{empty.pk}/").status_code == 204


# ── 用户机构:有殿非管理员必填且同殿,缺省殿根 ─────────────────────────


def test_creating_an_officer_without_a_unit_puts_them_at_the_hall_root(admin, cn_admin_user, eg):
    hall = cn_admin_user.tenant
    body = {"username": "b1_new_judge", "password": "Str0ng-Passw0rd!", "role": "JUDGE"}
    assert admin.post("/api/v1/users/", body, format="json").status_code == 201
    assert User.objects.get(username="b1_new_judge").organization_id == tenant_root(hall).pk
    away = _unit(eg, "B1_AWAY")
    res = admin.post("/api/v1/users/", {**body, "username": "b1_cross", "organization": away.pk}, format="json")
    assert res.status_code == 400, res.data
    assert "organization" in res.data
    assert not User.objects.filter(username="b1_cross").exists()


def test_clearing_an_officers_unit_falls_back_to_the_root(admin, cn_admin_user):
    hall = cn_admin_user.tenant
    unit = _unit(hall, "B1_UNIT")
    judge = User.objects.create_user(username="b1_judge", password="x", role="JUDGE", tenant=hall, organization=unit)
    res = admin.patch(f"/api/v1/users/{judge.pk}/", {"organization": None}, format="json")
    assert res.status_code == 200, res.data
    judge.refresh_from_db()
    assert judge.organization_id == tenant_root(hall).pk


def test_csv_import_and_invite_put_officers_at_the_root(admin, cn_admin_user):
    from apps.authentication import officer_invite

    hall = cn_admin_user.tenant
    body = "username,password,role\nb1_csv,Str0ng-Passw0rd!,VIEWER\n"
    upload = SimpleUploadedFile("users.csv", body.encode("utf-8"), content_type="text/csv")
    res = admin.post("/api/v1/users/import_csv/", {"file": upload}, format="multipart")
    assert res.status_code in (200, 201), res.data
    root = tenant_root(hall)
    assert User.objects.get(username="b1_csv").organization_id == root.pk
    invitee = officer_invite.create_invitee("b1@example.com", "VIEWER", hall, username="b1_inv")
    assert invitee.organization_id == root.pk


def test_admins_and_souls_are_not_given_a_unit(admin, cn_admin_user):
    from apps.authentication.serializers import default_officer_organization

    hall = cn_admin_user.tenant
    assert default_officer_organization(hall, "ADMIN", None) is None
    assert default_officer_organization(hall, "SOUL", None) is None
    assert default_officer_organization(None, "JUDGE", None) is None
    assert default_officer_organization(hall, "JUDGE", None) == tenant_root(hall)


# ── RoleDataScope:只新增 ───────────────────────────────────────────────


def test_role_data_scope_table_is_empty_and_unique_per_live_role_resource(cn):
    assert RoleDataScope.objects.count() == 0
    role = Role.objects.create(name="B1_ROLE", display_name="b1")
    row = RoleDataScope.objects.create(role=role, resource="", scope="DEFINE")
    row.orgs.add(tenant_root(cn))
    with pytest.raises(IntegrityError), transaction.atomic():
        RoleDataScope.objects.create(role=role, resource="", scope="ALL")
    row.soft_delete()
    RoleDataScope.objects.create(role=role, resource="", scope="ALL")
    RoleDataScope.objects.create(role=role, resource="soul", scope="SELF")
