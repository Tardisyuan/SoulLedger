"""ADMIN-only 的菜单与按钮,不会从任何一个出口漏给别的角色。

`apps/menus/access.py` 的模块 docstring 说「收口而不是再加一份拷贝,正是本模块的
意义」。实际上这条规则当时有**四个**实现,其中两个不过滤:

    MenuViewSet.tree            走 menu_is_visible_to      —— 干净
    MenuViewSet.list_public     行内手抄第三份            —— 顶层对、children 漏
    MenuSerializer.get_children `filter(is_active=True)`  —— 完全不过滤
    MenuButtonViewSet           只按 menu_id 过滤          —— 完全不过滤

实跑(JUDGE 身份,修改前):

    GET /menus/          顶层不含 secret,而 children 里含 ADMIN-only:
                         [('zzparent','zzADMINCHILD',['ADMIN']),
                          ('概览','业力统计',['ADMIN'])]
    GET /menus/tree/     ADMIN-only 节点对 JUDGE 可见: []
    GET /menus/buttons/  200, n=1, 看得见 ['tenant.delete']

`概览 → 业力统计` 是仓库里真实的 seed 行,不是测试造的。**侧边栏走的正是 `/menus/`**。

这个文件对**每一个出口**都断言两件事:该藏的藏住了,该看见的还看得见。只断言前者
的话,一个「什么都不返回」的实现全绿,而导航栏会整个空掉。
"""
import pytest
from rest_framework_simplejwt.tokens import RefreshToken

from apps.authentication.models import User
from apps.menus.models import Menu, MenuButton


def client_for(api_client, user):
    token = RefreshToken.for_user(user)
    if user.tenant:
        token["tenant_code"] = user.tenant.code
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
    return api_client


@pytest.fixture
def tree(db, cn_tenant):
    """一个共享的父节点,底下一个公开子项和一个 ADMIN-only 子项。

    这正是 115 上 `概览 → 业力统计` 的形状:父节点谁都看得见,子节点不是。
    """
    parent = Menu.objects.create(name="概览", path="/overview", order=1)
    open_child = Menu.objects.create(
        name="灵魂列表", path="/souls", parent=parent, order=1
    )
    secret_child = Menu.objects.create(
        name="业力统计", path="/admin/stats", parent=parent, roles=["ADMIN"], order=2
    )
    secret_button = MenuButton.objects.create(
        menu=secret_child, name="删除租户", code="del", permission="tenant.delete", order=1
    )
    # 第二个 ADMIN-only 按钮,但它的 codename **是 JUDGE 持有的**。
    # 这一条区分两道检查:没有它,`button_is_visible_to` 里那句菜单可见性判断
    # 可以整个删掉而守卫全绿 —— 因为 `tenant.delete` 本来就不在 JUDGE 手里,
    # 光靠 codename 那半就挡住了。变异实测过:删掉菜单检查,6 条一条不红。
    secret_button_judge_can_do = MenuButton.objects.create(
        menu=secret_child, name="查看", code="peek", permission="soul.read", order=2
    )
    open_button = MenuButton.objects.create(
        menu=open_child, name="查看", code="read", permission="soul.read", order=1
    )
    return (parent, open_child, secret_child, secret_button,
            secret_button_judge_can_do, open_button)


@pytest.fixture
def judge(db, cn_tenant):
    return User.objects.create_user(
        username="menu_judge", password="x", role="JUDGE", tenant=cn_tenant
    )


def names_under(payload):
    """摊平返回体里出现过的所有菜单名 —— 顶层与任意深度的 children。"""
    out = []

    def walk(rows):
        for row in rows:
            out.append(row.get("name"))
            walk(row.get("children") or [])

    walk(payload if isinstance(payload, list) else payload.get("results", []))
    return out


@pytest.mark.django_db
@pytest.mark.parametrize("path", ["/api/v1/menus/", "/api/v1/menus/list-public/"])
def test_an_admin_only_child_is_not_listed_to_a_judge(api_client, judge, tree, path):
    _, open_child, secret_child, _, _, _ = tree
    client = client_for(api_client, judge)

    response = client.get(path)
    assert response.status_code == 200, response.data
    seen = names_under(response.data)

    assert secret_child.name not in seen, f"{path} 漏了 ADMIN-only 子菜单:{seen}"
    # 正对照。没有它,一个返回空列表的实现同样满足上一句,而侧边栏会整个空掉。
    assert open_child.name in seen, f"{path} 把该看见的也藏了:{seen}"


@pytest.mark.django_db
@pytest.mark.parametrize("path", ["/api/v1/menus/", "/api/v1/menus/list-public/"])
def test_an_admin_sees_the_admin_only_child(api_client, cn_tenant, tree, path):
    """第二个正对照:藏起来是**因为角色**,不是因为那一行坏了。"""
    _, _, secret_child, _, _, _ = tree
    admin = User.objects.create_user(
        username="menu_admin", password="x", role="ADMIN", tenant=cn_tenant
    )
    response = client_for(api_client, admin).get(path)
    assert response.status_code == 200
    assert secret_child.name in names_under(response.data)


@pytest.mark.django_db
def test_the_button_list_does_not_hand_out_admin_only_codenames(api_client, judge, tree):
    _, _, _, secret_button, secret_but_permitted, open_button = tree
    response = client_for(api_client, judge).get("/api/v1/menus/buttons/")
    assert response.status_code == 200, response.data
    rows = response.data.get("results", response.data)
    ids = [b["id"] for b in rows]
    codes = [b.get("permission") for b in rows]

    assert secret_button.pk not in ids, f"JUDGE 拿到了 ADMIN-only 菜单下的按钮:{codes}"
    assert "tenant.delete" not in codes
    # 这一条只有「菜单不可见」能挡住 —— JUDGE 持有 soul.read。
    assert secret_but_permitted.pk not in ids, (
        "一个 codename 恰好持有的按钮,从一个看不见的菜单下漏了出来"
    )
    assert open_button.pk in ids, "该看得见的按钮也没了"


@pytest.mark.django_db
def test_the_tree_endpoint_stays_clean(api_client, judge, tree):
    """`tree` 修改前就是干净的。钉住它,免得这次收口反而把它弄坏 ——
    三个出口现在共用同一段代码,一处改错会一起错。"""
    _, open_child, secret_child, _, _, _ = tree
    response = client_for(api_client, judge).get("/api/v1/menus/tree/")
    assert response.status_code == 200
    seen = names_under(response.data)
    assert secret_child.name not in seen
    assert open_child.name in seen


@pytest.mark.django_db
def test_an_anonymous_caller_gets_nothing_from_list_public(api_client, tree):
    """`list-public` 这个名字容易被读成「公开的」。它仍然要按角色答复。

    `visible_menus` 的 docstring 写着「Fails closed ... no resolvable identity
    means nothing, never everything」。这条把那句话变成断言 —— 变异实测:把它
    改成未认证返回全集,上面六条**一条不红**,因为它们全都带着认证。
    """
    api_client.credentials()  # 清掉任何凭据
    response = api_client.get("/api/v1/menus/list-public/")
    if response.status_code == 200:
        _, _, secret_child, _, _, _ = tree
        assert secret_child.name not in names_under(response.data), (
            "未认证的调用者拿到了 ADMIN-only 菜单"
        )
    else:
        assert response.status_code in (401, 403), response.status_code
