"""每一个码名族,要么被某个视图声明,要么在下面的名单里写明为什么没有。

**这条守的是一类只存在于注释里的断言。** `apps/perm/models.py` 曾经在
`cross_judgment.*` 上方写着「这一族目前**没有任何视图声明它**」,并据此论证了
一整段迁移方案 —— 而 `apps/dispatch/views.py::CrossTenantJudgmentViewSet` 就写着
`permission_codename = "cross_judgment"`。**前提是错的,而架在它上面的整段论证
因此作废。**

一句写在注释里的「没有任何视图声明它」是一次**未经执行的全仓查询**。它写下的那天
可能是对的,而此后没有任何东西会因为它变错而报红。这个文件把那句查询写成断言。

未被任何视图声明的族**不一定是缺陷**:有些码名是给别的机制用的(`system.settings`
给的是硬编码 ADMIN 的端点)。所以下面是一份**决定的记录**,不是豁免清单 ——
加一条要写一句话。
"""
import ast
import re
from pathlib import Path

import pytest

from apps.perm.models import DEFAULT_PERMISSIONS

BACKEND = Path(__file__).resolve().parents[1]

#: 族 -> 为什么没有视图声明它。
UNCLAIMED_BY_DESIGN = {
    "dashboard": (
        "**两侧都没有消费者。** `dashboard.read` 授给了五个角色,而后端没有任何"
        "视图声明它(首页拼装的是别的族的数据),前端全仓 grep 也零命中 —— "
        "既不是后端闸门,也不是前端可见性开关。它是权限界面上一个不做任何事的"
        "开关。\n"
        "这一行此前写的是「前端首页的可见性开关」—— **那句是错的**,而它读起来"
        "像是已经核过。留着这一族要么给它一个消费者,要么从目录里删掉;"
        "在那之前,现状写在这里。"
    ),
    "system": (
        "**有消费者,只是不经 `permission_codename`。** 2026-10-29 起(用户第 2 条)perm 的函数视图按 "
        "`system.settings` 判(`apps/perm/views.py::HasSystemSettings` / `CanWriteGlobalSettings`),"
        "`user.manage` 由 UserViewSet 声明(族名 `user`,目录里归 `system`);本测试只认 "
        "`permission_codename` 与 `return [...]` 两种写法,看不见前者。"
    ),
    "session": (
        "**有消费者,只是不经 `permission_codename`。** `session.manage` 由三个函数视图"
        "(apps/authentication/admin_session_views.py)的 `CanManageSessions` 判定,"
        "本测试只扫 viewset 的声明,看不见它。前端 /audit/sessions 与审计页签按同一个码显隐。"
    ),

}


def declared_families():
    """目录里声明的族。"""
    return {family for _, _, family in DEFAULT_PERMISSIONS}


_CODENAME = re.compile(r"^([a-z_]+)\.[a-z_]+$")


def families_claimed_in(source):
    """一份视图源码里声明的族 —— 用 `ast` 读,只认真的声明(审计 2026-11-11 G-03)。

    此前按行滤掉 `#` 开头的行,再在全文上跑正则 —— docstring 不是 `#` 行,于是
    `apps/judgment/views.py` 里一句「`permission_codename = "judgment"` rather than a new `statute.*` family」
    被算成了 `judgment` 族的一次声明。真声明全删掉,它照样绿。现在:

    * `permission_codename = "x"` 只认**类体里的赋值语句**(含带注解的),值是字符串常量;
    * `APIView` 没有 queryset,走 `get_required_permissions()` 返回 `['x.read']` —— 只认 `return` 语句的值里
      的列表 / 元组字面量中的字符串常量(`return [...] if … else [...]` 两边都算)。
    """
    out = []
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.ClassDef):
            for stmt in node.body:
                targets = stmt.targets if isinstance(stmt, ast.Assign) else [stmt.target] if isinstance(stmt, ast.AnnAssign) else []
                value = getattr(stmt, "value", None)
                if (any(isinstance(t, ast.Name) and t.id == "permission_codename" for t in targets)
                        and isinstance(value, ast.Constant) and isinstance(value.value, str)):
                    out.append(value.value)
        elif isinstance(node, ast.Return) and node.value is not None:
            for sub_node in ast.walk(node.value):
                if isinstance(sub_node, (ast.List, ast.Tuple)):
                    for elt in sub_node.elts:
                        if isinstance(elt, ast.Constant) and isinstance(elt.value, str):
                            m = _CODENAME.match(elt.value)
                            if m:
                                out.append(m.group(1))
    return out


def claimed_families():
    """被某个视图声明的族,以及声明它的文件。"""
    out = {}
    # `*views*.py`,不是 `views.py`。**主体清单又一次不全**:这个仓库的视图并不都
    # 叫 views.py —— `apps/soul_accounts/me_views.py`、`apps/social/soul_views.py`、
    # `apps/social/moderation_views.py`、`apps/core/recycle_bin_views.py` 都是路由上
    # 真实存在的视图,而按 `views.py` 扫描一个都看不见。2026-09-18 实测:
    # `social.moderate` 由 `apps/social/moderation_views.py` 声明,这条断言却报
    # 「social 族没有任何视图声明」—— 与模块 docstring 里记的 `ledger` 是同一个形状,
    # 只是这次错在文件名而不是声明写法。
    #
    # 两种声明方式,不是一种(见 `families_claimed_in`):第一版只认 `permission_codename`,
    # 于是把 `ledger` 报成「没有任何视图声明」—— 而 apps/ledger/views.py 里**六个 APIView**
    # 每一个都用 `get_required_permissions()` 声明了它。
    for path in (BACKEND / "apps").rglob("*views*.py"):
        for family in families_claimed_in(path.read_text(encoding="utf-8")):
            out.setdefault(family, []).append(str(path.relative_to(BACKEND)))
    return out


def test_a_docstring_or_comment_is_not_a_declaration():
    """守卫的守卫(G-03):文档里提到的声明不算,类属性与 `return [...]` 才算。"""
    prose = (
        'class V:\n'
        '    """Uses `permission_codename = "judgment"` rather than a new family."""\n'
        '    # permission_codename = "audit"\n'
        '    note = \'return ["ledger.read"]\'\n'
        '    def f(self):\n'
        '        permission_codename = "local"\n'
        '        return permission_codename\n'
    )
    assert families_claimed_in(prose) == []
    real = (
        'class V:\n'
        '    permission_codename = "soul"\n'
        '    def get_required_permissions(self):\n'
        '        return ["ledger.read"] if self.x else ("dispatch.manage",)\n'
    )
    assert sorted(families_claimed_in(real)) == ["dispatch", "ledger", "soul"]


def test_the_scan_found_a_non_trivial_number_of_viewsets():
    """守卫的守卫。扫不到东西时,下面那条会以「没有未声明的族」通过 ——
    而那正是本仓库记了六次的形状。"""
    claimed = claimed_families()
    assert len(claimed) > 8, f"只扫到 {len(claimed)} 个族:{sorted(claimed)}"


def test_every_declared_family_is_claimed_or_listed():
    unclaimed = sorted(declared_families() - set(claimed_families()) - set(UNCLAIMED_BY_DESIGN))
    assert unclaimed == [], (
        f"这些码名族没有任何视图声明,也不在 UNCLAIMED_BY_DESIGN 里:{unclaimed}。"
        f"要么给它挂上视图,要么写明为什么它不需要 —— 一个没人声明的族,"
        f"授出去也不会有任何效果,而权限界面照样把它列出来。"
    )


def test_the_exemption_list_names_only_real_families():
    """名单会因为族改名而悄悄失效 —— 一条指着不存在族的豁免,读起来和一条生效的
    豁免完全一样,而它豁免的那个族此刻可能真的没人声明。"""
    stale = sorted(set(UNCLAIMED_BY_DESIGN) - declared_families())
    assert stale == [], f"豁免名单里这些族已不在目录里:{stale}"


def test_the_exemption_list_does_not_cover_a_claimed_family():
    """反方向:一个已经被声明的族留在豁免名单里,会掩盖它后来被摘掉这件事。"""
    claimed = claimed_families()
    redundant = sorted(set(UNCLAIMED_BY_DESIGN) & set(claimed))
    assert redundant == [], (
        "这些族已经被视图声明了,不该再留在豁免名单里:"
        + "; ".join(f"{f} ({', '.join(claimed[f])})" for f in redundant)
    )


@pytest.mark.parametrize("family", ["cross_judgment", "dispatch"])
def test_the_two_families_the_stale_comment_was_about(family):
    """M7 那条注释的两个主角,单独钉住。

    注释说 `cross_judgment.*` 没人声明、而 `CrossTenantJudgmentViewSet` 声明的是
    `dispatch.*`。两句都可以由这里回答。
    """
    claimed = claimed_families()
    assert family in claimed, f"{family} 现在没有任何视图声明 —— 注释可能又对了"
