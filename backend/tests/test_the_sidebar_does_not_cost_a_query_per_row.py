"""`GET /menus/` 不能对每个节点各发一条查询。

侧边栏每次加载都调这个端点。2026-08-29 实测:

    GET /menus/       queries=37   (约 16 行菜单)
    GET /menus/tree/  queries=15   (有 children_map 预取)
    GET /posts/       objects=20 queries=4     ← 社交列表没问题

`MenuSerializer.get_children` / `get_buttons` 各对每个节点发一条,而且递归。
`tree` 早就手工建了 `children_map`,`list` 没有 —— **两条出口,一条做了预取一条没有**,
和 M39 那对(一条过滤一条不过滤)是同一个形状。

这条钉的是**查询条数的上界**,不是一个精确数字:精确数字会因为任何无关改动而红,
于是被人调大,于是不再是守卫。上界给的是「不随行数线性增长」这个性质。
"""
import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from apps.authentication.models import User, UserRole
from apps.menus.models import Menu, MenuButton
from apps.tenants.models import Tenant

#: 上界。实测修好后 ADMIN 是个位数;留出余量给分页与鉴权本身的查询。
QUERY_CEILING = 12
MENU_ROWS = 16


@pytest.fixture
def loaded(db):
    tenant, _ = Tenant.objects.get_or_create(
        code="CN_DIYU", defaults={"display_name": "CN_DIYU"}
    )
    user = User.objects.create_user(
        username="sidebar", password="x", role=UserRole.ADMIN, tenant=tenant
    )
    for i in range(MENU_ROWS // 2):
        parent = Menu.objects.create(
            name=f"父{i}", path=f"/p{i}", order=i, is_active=True, roles=[]
        )
        child = Menu.objects.create(
            name=f"子{i}", path=f"/p{i}/c", order=0, parent=parent,
            is_active=True, roles=[],
        )
        MenuButton.objects.create(
            menu=child, name=f"btn{i}", code=f"btn{i}", order=0, is_active=True
        )
    client = APIClient()
    client.force_authenticate(user=user)
    return client


@pytest.mark.django_db
def test_the_menu_list_does_not_scale_its_queries_with_its_rows(loaded):
    with CaptureQueriesContext(connection) as captured:
        response = loaded.get("/api/v1/menus/")
    assert response.status_code == 200
    assert len(captured) <= QUERY_CEILING, (
        f"{len(captured)} 条 SQL —— 上界是 {QUERY_CEILING}。"
        f"每个节点各发一条的老毛病回来了。"
    )


@pytest.mark.django_db
def test_the_rows_are_still_all_there(loaded):
    """**断存在。** 一个返回空列表的实现,查询条数一定合格。"""
    body = loaded.get("/api/v1/menus/").json()
    rows = body["results"] if isinstance(body, dict) else body
    assert len(rows) >= MENU_ROWS // 2, len(rows)
    with_children = [r for r in rows if r.get("children")]
    assert with_children, "children 全空 —— 预取改动把它们丢了"
    assert any(
        child.get("buttons") for r in with_children for child in r["children"]
    ), "buttons 全空"
