"""perm/0031(数据范围 B7):删旧的行级规则表 / 数据范围定义表与 Role、RolePermission 上的死列。

- 行级规则表里有行就中止,表与行原样留着;清空后同一迁移照常过。
- 往返:角色与授予活过前进和回退;回退把列与表加回来,内容为空(scope 回到 ORG、conditions 回到 {})。
"""
import uuid

import pytest

from tests.migration_roundtrip import migrate_to, migrate_to_latest

BEFORE = ("perm", "0030_split_business_codenames")
AFTER = ("perm", "0031_drop_dead_scope_fields")


def _gone(state, model):
    with pytest.raises(LookupError):
        state.get_model("perm", model)


def _role(state, name, **extra):
    return state.get_model("perm", "Role")._base_manager.create(name=name, display_name=name, **extra)


@pytest.mark.django_db(transaction=True)
@pytest.mark.migration
def test_a_row_level_scope_stops_the_migration_and_survives_it():
    try:
        state = migrate_to([BEFORE])
        scopes = state.get_model("perm", "RowLevelDataScope")
        scopes._base_manager.create(
            id=uuid.uuid4(), role=_role(state, "B7_KEEP"), model_name="Soul",
            filter_conditions={"current_state": "ALIVE"}, scope_type="READ",
        )

        with pytest.raises(RuntimeError, match="perm/export"):
            migrate_to([AFTER])

        state = migrate_to([BEFORE])  # still here: nothing was dropped
        scopes = state.get_model("perm", "RowLevelDataScope")
        assert list(scopes._base_manager.values_list("role__name", "model_name")) == [("B7_KEEP", "Soul")]

        scopes._base_manager.all().delete()
        state = migrate_to([AFTER])
        _gone(state, "RowLevelDataScope")
    finally:
        state = migrate_to([BEFORE])
        state.get_model("perm", "RowLevelDataScope")._base_manager.all().delete()
        migrate_to_latest()


@pytest.mark.django_db(transaction=True)
@pytest.mark.migration
def test_round_trip_keeps_roles_and_grants_and_brings_the_columns_back_empty():
    try:
        state = migrate_to([BEFORE])
        base = _role(state, "B7_BASE", scope="GLOBAL")
        child = _role(state, "B7_CHILD", scope="GLOBAL", parent=base)
        perm = state.get_model("perm", "Permission")._base_manager.create(codename="b7.probe", name="b7", category="b7")
        state.get_model("perm", "RolePermission")._base_manager.create(
            role=child, permission=perm, conditions={"current_state": ["PENDING"]},
        )
        state.get_model("perm", "DataScope")._base_manager.create(name="b7", code="B7_DS")

        state = migrate_to([AFTER])
        role_fields = {f.name for f in state.get_model("perm", "Role")._meta.get_fields()}
        assert not role_fields & {"scope", "organization", "parent"}
        grant = state.get_model("perm", "RolePermission")
        assert not {f.name for f in grant._meta.get_fields()} & {"conditions", "data_scope"}
        _gone(state, "DataScope")
        _gone(state, "RowLevelDataScope")
        assert list(grant._base_manager.filter(permission__codename="b7.probe").values_list("role__name", flat=True)) == ["B7_CHILD"]

        state = migrate_to([BEFORE])
        roles = state.get_model("perm", "Role")._base_manager.filter(name__startswith="B7_").order_by("name")
        assert [(r.name, r.scope, r.organization_id, r.parent_id) for r in roles] == [
            ("B7_BASE", "ORG", None, None), ("B7_CHILD", "ORG", None, None),
        ]
        grant = state.get_model("perm", "RolePermission")._base_manager.get(permission__codename="b7.probe")
        assert (grant.role.name, grant.conditions, grant.data_scope_id) == ("B7_CHILD", {}, None)
        assert not state.get_model("perm", "DataScope")._base_manager.exists()
        assert not state.get_model("perm", "RowLevelDataScope")._base_manager.exists()

        migrate_to([AFTER])  # forward again
    finally:
        migrate_to_latest()
