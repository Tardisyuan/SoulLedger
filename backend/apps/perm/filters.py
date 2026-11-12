"""
Data scope filter: rows narrowed by the role data scope (`apps/perm/data_scope.py`, 数据范围 B2).

A model that is not in `data_scope.REGISTRY` comes back unchanged — the same queryset object, which
`officer_app/todo.py::_judgments_in_scope` relies on (`seen is every`).
"""
from django.db.models import Q
from rest_framework.request import Request

from apps.perm import data_scope


class DataScopeFilter:
    """
    Usage:
        qs = DataScopeFilter.filter_queryset(request, Soul.objects.all(), Soul)
    """

    def __init__(self, user, model_class):
        self.user = user
        self.model_class = model_class

    def apply(self, queryset, cache=None):
        q = data_scope.q_for(self.user, self.model_class, cache)
        return queryset if q is None else queryset.filter(q)

    @classmethod
    def filter_queryset(cls, request: Request, queryset, model_class):
        user = request.user
        if not user.is_authenticated:
            return queryset.none()
        return cls(user, model_class).apply(queryset, data_scope.request_cache(request))

    @classmethod
    def through_soul(cls, request, queryset, soul_path="soul"):
        """挂在灵魂上、自己不在注册表里的行(受刑计划、转生申请、缩短冷却、灵魂账号、待交付凭据、殿司收件箱)
        跟灵魂的数据范围走(审计 P-10,用户 2026-11-11):看不到那个灵魂,就看不到这一行。
        用的是灵魂那条注册项,路径前面加上 `soul_path__`;不限 → 原样返回同一个 queryset。

        只对**原属本殿**的灵魂套范围(2026-11-12):数据范围是殿内的机构划分,原属别殿的灵魂(执行地判官看到的
        受刑计划、收件殿司看到的暂居灵魂来信)在本殿没有机构归属,照旧按殿可见 —— 殿级隔离在调用方已经做过。
        原属殿为空的旧行仍套范围。调用者自己没有殿(非 ADMIN 的无殿账号)时全部套范围。"""
        user = request.user
        if not user.is_authenticated:
            return queryset.none()
        entry = data_scope.REGISTRY["souls.Soul"]
        q = data_scope.visible_q(user, entry.resource, f"{soul_path}__{entry.org_path}",
                                 tuple(f"{soul_path}__{p}" for p in entry.user_paths),
                                 cache=data_scope.request_cache(request))
        if q is None:
            return queryset
        tenant_id = getattr(user, "tenant_id", None)
        if tenant_id is not None:
            home = f"{soul_path}__home_tenant"
            q |= Q(**{f"{home}__isnull": False}) & ~Q(**{home: tenant_id})
        return queryset.filter(q)
