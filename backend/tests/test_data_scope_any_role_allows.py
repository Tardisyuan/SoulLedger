"""Data scope with several roles: a row is visible if ANY held role's scope allows it (user 2026-10-27).

Before, `DataScopeFilter` read only the primary role and ignored `extra_roles`.
"""
import pytest

from apps.authentication.models import User
from apps.perm.filters import DataScopeFilter
from apps.perm.models import Role, RowLevelDataScope
from apps.souls.models import Soul, SoulState

pytestmark = pytest.mark.django_db


def _scope(role, state):
    RowLevelDataScope.objects.create(
        role=Role.objects.get_or_create(name=role)[0], model_name="soul", scope_type="READ",
        filter_conditions={"current_state": state}, is_active=True,
    )


def _visible(user):
    return set(DataScopeFilter(user, Soul).apply(Soul.objects.all()).values_list("name", flat=True))


def test_rows_are_the_union_of_each_roles_scope(cn_tenant):
    Soul.objects.create(name="judging", tenant=cn_tenant, current_state=SoulState.JUDGING)
    Soul.objects.create(name="alive", tenant=cn_tenant, current_state=SoulState.ALIVE)
    Soul.objects.create(name="dead", tenant=cn_tenant, current_state=SoulState.DISPOSED)
    _scope("JUDGE", SoulState.JUDGING)
    _scope("VIEWER", SoulState.ALIVE)
    user = User.objects.create_user(username="two_hats", password="x", role="JUDGE", tenant=cn_tenant,
                                    extra_roles=["VIEWER"])
    assert _visible(user) == {"judging", "alive"}

    user.extra_roles = []
    assert _visible(user) == {"judging"}  # one role: its own scope only


def test_a_held_role_without_a_scope_sees_everything(cn_tenant):
    Soul.objects.create(name="judging", tenant=cn_tenant, current_state=SoulState.JUDGING)
    Soul.objects.create(name="alive", tenant=cn_tenant, current_state=SoulState.ALIVE)
    _scope("JUDGE", SoulState.JUDGING)
    Role.objects.get_or_create(name="VIEWER")
    user = User.objects.create_user(username="two_hats", password="x", role="JUDGE", tenant=cn_tenant,
                                    extra_roles=["VIEWER"])
    assert _visible(user) == {"judging", "alive"}
