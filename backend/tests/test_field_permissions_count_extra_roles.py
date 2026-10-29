"""字段权限认兼任角色(用户决定第 27 条;数据范围 B7 一起做)。

`FieldPermissionMixin` 此前只读 `user.role`:兼任了一个看得见某字段的角色,照样被主角色藏掉。
现在主角色加存活的兼任角色一起算,与授予同一个方向 —— 最开放的那个赢:
都藏才藏、都锁才锁、有一个角色对这个模型没有规则就全部照旧。每条既断言出现也断言缺席。
"""
from types import SimpleNamespace

import pytest
from rest_framework import serializers

from apps.core.field_permissions import FieldPermissionMixin
from apps.perm.models import FieldPermission, Role


class _SoulLike(FieldPermissionMixin, serializers.Serializer):
    name = serializers.CharField()
    merit_score = serializers.IntegerField()
    description = serializers.CharField()

    class Meta:
        field_permission_model = "Soul"


def _rule(role_name, field, **flags):
    role = Role.objects.get_or_create(name=role_name, defaults={"display_name": role_name})[0]
    FieldPermission.objects.create(role=role, model_name="Soul", field_name=field, **flags)
    return role


def _fields(role, extra=()):
    user = SimpleNamespace(is_authenticated=True, role=role, extra_roles=list(extra))
    s = _SoulLike(context={"request": SimpleNamespace(user=user)})
    return {name: f.read_only for name, f in s.fields.items()}


@pytest.mark.django_db
def test_an_extra_role_that_shows_the_field_shows_it():
    _rule("FP_JUDGE", "merit_score", visible=False)
    _rule("FP_CLERK", "description", visible=False)
    assert "merit_score" not in _fields("FP_JUDGE")
    seen = _fields("FP_JUDGE", ["FP_CLERK"])
    assert "merit_score" in seen and "description" in seen
    assert "description" not in _fields("FP_CLERK")


@pytest.mark.django_db
def test_a_field_every_role_hides_stays_hidden():
    _rule("FP_JUDGE", "merit_score", visible=False)
    _rule("FP_CLERK", "merit_score", visible=False)
    seen = _fields("FP_JUDGE", ["FP_CLERK"])
    assert "merit_score" not in seen
    assert "name" in seen


@pytest.mark.django_db
def test_read_only_only_when_every_role_locks_it():
    _rule("FP_JUDGE", "name", read_only=True)
    _rule("FP_CLERK", "name", editable=False)
    _rule("FP_SCRIBE", "description", read_only=True)
    assert _fields("FP_JUDGE", ["FP_CLERK"])["name"] is True
    both = _fields("FP_JUDGE", ["FP_SCRIBE"])
    assert both["name"] is False and both["description"] is False
    assert _fields("FP_JUDGE")["name"] is True


@pytest.mark.django_db
def test_an_extra_role_with_no_rules_for_the_model_lifts_them_all():
    _rule("FP_JUDGE", "*", visible=False)
    Role.objects.get_or_create(name="FP_OPEN", defaults={"display_name": "open"})
    assert _fields("FP_JUDGE") == {}
    assert _fields("FP_JUDGE", ["FP_OPEN"]) == {"name": False, "merit_score": False, "description": False}


@pytest.mark.django_db
def test_a_binned_extra_role_does_not_count():
    _rule("FP_JUDGE", "merit_score", visible=False)
    clerk = _rule("FP_GONE", "description", visible=False)
    clerk.soft_delete()
    assert "merit_score" not in _fields("FP_JUDGE", ["FP_GONE"])
