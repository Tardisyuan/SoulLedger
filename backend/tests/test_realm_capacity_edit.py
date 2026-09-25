"""`PATCH /api/v1/realms/{id}/` —— 只改容量。

容量是运营数(一个界域同时收多少魂),不是神话:`seed_mythology` 不播种它。界域上
别的每一列都来自语料,所以这个端点**只收 `capacity`**,别的字段一律 400(逐字段测),
而不是被 DRF 静默丢掉后回一个 200。

- 码名 `realms.manage`,默认只 ADMIN;perm 迁移 0026 播种。
- 按租户:别的租户的界域 404,与读同一条 `get_object`。
- 审计:Realm 是 AuditUserFields 模型,写入落 AuditLog,带操作人。
- 降到在押人数以下是允许的:谁都不挪,之后的发落拿 409 `realm_full`;响应里说出来。
"""
import pytest

from apps.audit.models import AuditLog
from apps.realms.models import SoulPathEntry
from apps.realms.serializers import RealmSerializer
from tests.soul_account_support import officer_client
from tests.test_conclude_destination import HELL_5, _case, _conclude, _judge_client, _occupy, _realm

pytestmark = pytest.mark.django_db


def _url(realm):
    return f"/api/v1/realms/{realm.pk}/"


def _grant(role_name, *codenames):
    from apps.perm.models import Permission, Role, RolePermission

    role, _ = Role.objects.get_or_create(name=role_name, defaults={"display_name": role_name})
    for codename in codenames:
        permission, _ = Permission.objects.get_or_create(
            codename=codename, defaults={"name": codename, "category": "realms"})
        RolePermission.objects.get_or_create(role=role, permission=permission)


@pytest.fixture
def admin(admin_user):
    return officer_client(admin_user)


@pytest.fixture
def hall(cn_tenant):
    return _realm("CAP_HALL", cn_tenant, capacity=10)


def test_admin_sets_capacity_and_the_write_is_audited(
    admin, admin_user, hall, django_capture_on_commit_callbacks
):
    with django_capture_on_commit_callbacks(execute=True):
        response = admin.patch(_url(hall), {"capacity": 3}, format="json")
    assert response.status_code == 200, response.data
    assert response.data["capacity"] == 3
    assert (response.data["held"], response.data["is_full"]) == (0, False)
    hall.refresh_from_db()
    assert hall.capacity == 3
    log = AuditLog.objects.filter(resource_id=str(hall.pk), action="UPDATE").latest("timestamp")
    assert log.user_id == admin_user.pk
    assert "capacity" in (log.changes or {})


def test_null_means_not_recorded_and_zero_is_a_number(admin, hall):
    assert admin.patch(_url(hall), {"capacity": None}, format="json").status_code == 200
    hall.refresh_from_db()
    assert hall.capacity is None
    assert admin.patch(_url(hall), {"capacity": 0}, format="json").status_code == 200
    hall.refresh_from_db()
    assert hall.capacity == 0


@pytest.mark.parametrize("bad", [-1, "many", 1.5, True])
def test_capacity_must_be_a_non_negative_integer(admin, hall, bad):
    response = admin.patch(_url(hall), {"capacity": bad}, format="json")
    assert response.status_code == 400
    hall.refresh_from_db()
    assert hall.capacity == 10


OTHER_FIELDS = [f for f in RealmSerializer.Meta.fields if f != "capacity"]


@pytest.mark.parametrize("field", OTHER_FIELDS)
def test_every_other_field_is_refused(admin, hall, field):
    before = RealmSerializer(hall).data
    response = admin.patch(_url(hall), {field: before[field] if before[field] is not None else "x"}, format="json")
    assert response.status_code == 400
    assert field in response.data
    hall.refresh_from_db()
    assert RealmSerializer(hall).data == before


def test_refused_even_when_sent_alongside_capacity(admin, hall):
    response = admin.patch(_url(hall), {"capacity": 2, "name_zh": "改名"}, format="json")
    assert response.status_code == 400
    hall.refresh_from_db()
    assert (hall.capacity, hall.name_zh) == (10, "CAP_HALL")


def test_put_is_not_offered(admin, hall):
    assert admin.put(_url(hall), {"capacity": 2}, format="json").status_code == 405


def test_needs_realms_manage(django_user_model, cn_tenant, hall):
    _grant("JUDGE", "realms.read")
    judge = django_user_model.objects.create_user(username="cap_judge", password="x", role="JUDGE", tenant=cn_tenant)
    assert officer_client(judge).patch(_url(hall), {"capacity": 2}, format="json").status_code == 403


def test_holder_of_realms_manage_cannot_reach_another_tenants_realm(django_user_model, cn_tenant, eu_tenant):
    _grant("MODERATOR", "realms.read", "realms.manage")
    mod = django_user_model.objects.create_user(username="cap_mod", password="x", role="MODERATOR", tenant=cn_tenant)
    own = _realm("CAP_OWN", cn_tenant, capacity=5)
    foreign = _realm("CAP_FOREIGN", eu_tenant, civilization="EUROPEAN", capacity=5)
    client = officer_client(mod)
    assert client.patch(_url(own), {"capacity": 4}, format="json").status_code == 200
    assert client.patch(_url(foreign), {"capacity": 4}, format="json").status_code == 404
    foreign.refresh_from_db()
    assert foreign.capacity == 5


def test_lowering_below_occupancy_moves_nobody_and_future_placements_are_refused(
    admin, django_user_model, cn_tenant
):
    hell5 = _realm(HELL_5, cn_tenant, capacity=5)
    _occupy(hell5, cn_tenant, n=2)

    # Exactly at occupancy is already full: placement refuses at `held >= capacity`.
    at_edge = admin.patch(_url(hell5), {"capacity": 2}, format="json")
    assert (at_edge.data["held"], at_edge.data["is_full"]) == (2, True)
    assert admin.patch(_url(hell5), {"capacity": 3}, format="json").data["is_full"] is False

    response = admin.patch(_url(hell5), {"capacity": 1}, format="json")
    assert response.status_code == 200
    assert (response.data["capacity"], response.data["held"], response.data["is_full"]) == (1, 2, True)
    # Nobody moved.
    assert SoulPathEntry.all_objects.filter(realm=hell5, left_at__isnull=True).count() == 2

    judge = _judge_client(django_user_model, cn_tenant, "cap_desk_judge")
    refused = _conclude(judge, _case(cn_tenant), destination_realm_id=str(hell5.pk))
    assert (refused.status_code, refused.data["code"]) == (409, "realm_full")
