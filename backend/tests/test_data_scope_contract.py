"""约定(数据范围 B2):路由上的视图,只要服务的模型在 `apps/perm/data_scope.py::REGISTRY` 里,
它的 `get_queryset()` 就必须经过 `DataScopeFilter`,且是对这个模型。

行为检查,不是读源码:把 `DataScopeFilter.filter_queryset` 换成记账的包装,真的调一次 `get_queryset()`
(非管理员、本殿、`list`),看它有没有被问到这个模型。读源码的版本在 `test_tenant_scoping_contract.py`
文件头记着栽过一次(注释里的名字让契约保持绿)。

`NOT_YET` 是还没接上的视图,各写原因;接上了这里就红(名单只能变短)。
"""
from unittest import mock

import pytest
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.perm import data_scope
from apps.perm.filters import DataScopeFilter
from tests.test_tenant_scoping_contract import _model_for, _registered_viewsets

pytestmark = pytest.mark.django_db

NOT_YET: dict[str, str] = {
}


def _scoped_views():
    return sorted(
        ((cls, pattern) for cls, pattern in _registered_viewsets().items()
         if (m := _model_for(cls)) is not None and data_scope.entry_for(m) is not None),
        key=lambda pair: pair[0].__name__,
    )


def _asks_for(view_cls, user, model):
    seen = []
    real = DataScopeFilter.filter_queryset.__func__

    def spy(cls, request, queryset, model_class, scope_type="READ"):
        seen.append(model_class)
        return real(cls, request, queryset, model_class, scope_type)

    raw = APIRequestFactory().get("/")
    raw.tenant = user.tenant
    force_authenticate(raw, user=user)
    view = view_cls()
    view.action_map, view.args, view.kwargs, view.format_kwarg = {"get": "list"}, (), {}, None
    view.request = view.initialize_request(raw)
    view.action = "list"
    with mock.patch.object(DataScopeFilter, "filter_queryset", classmethod(spy)):
        view.get_queryset()
    return model in seen


@pytest.mark.parametrize("view_cls,pattern", [pytest.param(c, p, id=c.__name__) for c, p in _scoped_views()])
def test_a_view_over_a_registered_model_goes_through_the_data_scope(view_cls, pattern, judge_user):
    model = _model_for(view_cls)
    asked = _asks_for(view_cls, judge_user, model)
    if view_cls.__name__ in NOT_YET:
        assert not asked, f"{view_cls.__name__} 已经过 DataScopeFilter,从 NOT_YET 删掉它"
        return
    assert asked, (
        f"{view_cls.__name__}({pattern})服务 {model._meta.label},在数据范围注册表里,"
        f"但 get_queryset() 没有对它调 DataScopeFilter.filter_queryset。"
    )


def test_the_contract_covers_the_core_models():
    labels = {_model_for(c)._meta.label for c, _ in _scoped_views()}
    assert {"souls.Soul", "judgment.Judgment", "workflow.ApprovalWorkflow"} <= labels


def test_not_yet_entries_are_still_routed():
    routed = {c.__name__ for c, _ in _scoped_views()}
    assert set(NOT_YET) <= routed, set(NOT_YET) - routed
