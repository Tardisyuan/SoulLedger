"""代看 / 进殿查看时 GET 不写库(2026-10-29 决定 15;审查 rev-security 16)。

不是挑几条接口:遍历 URLconf 里**每一个**官员端 GET 路由(灵魂端 `/api/v1/me/` 不收代看令牌,跳过),
无参数的直接请求,单个主键参数的用该视图模型的第一行填上;请求前后对全部表的全部行取指纹,必须一字不差。
例外只有代看自己的两张表:`Impersonation`(累计看过的页面)与 `AuditLog`(开始 / 结束各一行)。

新加的 GET 若顺手建行、标已读、记「最近一次」,这里会点名是哪条路由改了哪张表 —— 修法是在那里看
`apps.authentication.impersonation.impersonating(request)`,代看时跳过写入(见 `social/views.py::me`)。
"""
import hashlib
import re

import pytest
from django.apps import apps
from django.urls import URLPattern, URLResolver, get_resolver
from rest_framework.test import APIClient

from apps.audit.models import AuditLog
from apps.authentication.impersonation_models import Impersonation
from apps.notifications.models import UserNotification
from tests import sentence_plan_support as sp
from tests.soul_account_support import officer_client

pytestmark = pytest.mark.django_db

SKIPPED_PREFIXES = ("api/v1/me/", "api/v1/soul-auth/")
IGNORED_TABLES = {Impersonation, AuditLog}
_PARAM = re.compile(r"\(\?P<(\w+)>[^)]*\)|<(?:\w+:)?(\w+)>")


def _routes(resolvers=None, prefix=""):
    for entry in resolvers if resolvers is not None else get_resolver().url_patterns:
        text = str(entry.pattern).lstrip("^").replace("\\.", ".")
        if isinstance(entry, URLResolver):
            yield from _routes(entry.url_patterns, prefix + text)
        elif isinstance(entry, URLPattern):
            yield prefix + text.rstrip("$"), entry.callback


def _handles_get(callback):
    actions = getattr(callback, "actions", None)
    if actions is not None:
        return "get" in actions
    cls = getattr(callback, "view_class", None) or getattr(callback, "cls", None)
    return cls is not None and hasattr(cls, "get")


def _model_of(callback):
    cls = getattr(callback, "cls", None) or getattr(callback, "view_class", None)
    queryset = getattr(cls, "queryset", None)
    if queryset is not None:
        return cls, queryset.model
    meta = getattr(getattr(cls, "serializer_class", None), "Meta", None)
    return cls, getattr(meta, "model", None)


def _urls():
    """(路径, 说明) —— 每个 GET 路由一条;填不上参数的跳过(只剩多参数的嵌套路由)。"""
    seen = set()
    for raw, callback in _routes():
        if not raw.startswith("api/v1/") or raw.startswith(SKIPPED_PREFIXES) or not _handles_get(callback):
            continue
        if "format" in raw and "(?P<format>" in raw:
            continue  # DRF 的 `.json` 后缀副本
        params = [a or b for a, b in _PARAM.findall(raw)]
        path = raw
        if params:
            if len(params) != 1:
                continue
            cls, model = _model_of(callback)
            row = model._base_manager.order_by("pk").first() if model is not None else None
            if row is None:
                continue
            field = getattr(cls, "lookup_field", "pk") or "pk"
            value = getattr(row, "pk" if field == "pk" else field, None)
            if value is None:
                continue
            path = _PARAM.sub(str(value), raw)
        path = "/" + path.rstrip("?").replace("/?", "/")
        if path not in seen:
            seen.add(path)
            yield path


def _fingerprint():
    out = {}
    for model in apps.get_models():
        if model in IGNORED_TABLES or model._meta.proxy or not model._meta.managed:
            continue
        rows = model._base_manager.order_by("pk").values_list()
        digest = hashlib.sha256(repr(list(rows)).encode()).hexdigest()
        out[model._meta.label] = digest
    return out


@pytest.fixture
def world(django_user_model, cn_tenant, admin_user):
    target = django_user_model.objects.create_user(
        username="mengpo_view", password="x", role="JUDGE", tenant=cn_tenant, display_name="孟婆")
    soul, case = sp.open_case(cn_tenant)
    case.conclude("FAILED", "")  # 生成审批流程,好让流程 / 节点的详情路由有行可填
    UserNotification.objects.create(user=target, title="t", message="m", notification_type="SYSTEM")
    return target


def _viewing_as(admin_user, target):
    response = officer_client(admin_user).post(
        "/api/v1/auth/impersonate/", {"user_id": target.pk, "reason": "核对只读"}, format="json")
    assert response.status_code == 201, response.content
    return response.data["access"]


def _viewing_hall(admin_user, tenant):
    response = officer_client(admin_user).post(f"/api/v1/tenants/{tenant.code}/view/")
    assert response.status_code == 201, response.content
    return response.data["access"]


@pytest.mark.parametrize("mode", ["person", "hall"])
def test_no_get_writes_a_row_while_viewing(world, admin_user, cn_tenant, mode):
    access = _viewing_as(admin_user, world) if mode == "person" else _viewing_hall(admin_user, cn_tenant)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
    urls = list(_urls())
    # 遍历本身没坏:几百条路由都在,且确实带上了填参数的详情路由。
    assert len(urls) > 150, len(urls)
    assert any("/souls/" in u and u.count("/") > 4 for u in urls)

    changed = []
    before = _fingerprint()
    for url in urls:
        client.get(url, HTTP_X_IMP_PAGE="/guard")
        after = _fingerprint()
        diff = sorted(k for k in after if after[k] != before.get(k))
        if diff:
            changed.append((url, diff))
            before = after
    assert changed == [], changed


def test_the_fingerprint_sees_an_update_not_only_a_new_row(world):
    """守卫自身:只改一个字段(行数不变)也必须看得出来。"""
    before = _fingerprint()
    UserNotification.all_objects.filter(user=world).update(is_read=True)
    after = _fingerprint()
    assert [k for k in after if after[k] != before[k]] == ["notifications.UserNotification"]
