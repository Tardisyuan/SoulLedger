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
import re
from pathlib import Path

import pytest

from apps.perm.models import DEFAULT_PERMISSIONS

BACKEND = Path(__file__).resolve().parents[1]

#: 族 -> 为什么没有视图声明它。
UNCLAIMED_BY_DESIGN = {
    "dashboard": (
        "前端首页的可见性开关,没有对应的后端端点 —— 首页拼装的是别的族的数据。"
    ),
    "system": (
        "`system.settings` 对应的 perm 端点执行的是 `IsAdminPermission`,"
        "不是这个码名。改成按码名判断是一次策略变更(会让持有它的非 ADMIN 进来),"
        "留待决定;在那之前这里记录现状。"
    ),

}


def declared_families():
    """目录里声明的族。"""
    return {family for _, _, family in DEFAULT_PERMISSIONS}


def claimed_families():
    """被某个视图以 `permission_codename` 声明的族,以及声明它的文件。"""
    out = {}
    for path in (BACKEND / "apps").rglob("views.py"):
        source = path.read_text(encoding="utf-8")
        # 只看代码行:这个仓库已经五次栽在「扫描器读到了自己的注释」上。
        code = "\n".join(
            line for line in source.split("\n") if not line.lstrip().startswith("#")
        )
        # 两种声明方式,不是一种。
        #
        # `permission_codename = "x"` 是 viewset 的写法;`APIView` 没有 queryset,
        # 走的是 `get_required_permissions()` 返回 `['x.read']`。第一版只认前者,
        # 于是把 `ledger` 报成「没有任何视图声明」—— 而 apps/ledger/views.py 里
        # **六个 APIView** 每一个都声明了它。主体清单不全,是这个仓库反复出现的
        # 那个形状:检查在跑、会报红、而它看的不是全部。
        for m in re.finditer(r'permission_codename\s*=\s*"([^"]+)"', code):
            out.setdefault(m.group(1), []).append(str(path.relative_to(BACKEND)))
        for m in re.finditer(r"return \[([^\]]*)\]", code):
            for codename in re.findall(r"['\"]([a-z_]+)\.[a-z_]+['\"]", m.group(1)):
                out.setdefault(codename, []).append(str(path.relative_to(BACKEND)))
    return out


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
