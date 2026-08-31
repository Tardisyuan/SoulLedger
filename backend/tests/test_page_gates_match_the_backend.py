"""每一个前端页面路由,要么有一道门,要么在名单上写明为什么没有。

这条守的是**两个方向相反的缺陷**,而它们都出现在同一份审计账本里:

  M47 说 `/audit`、`/actors`、`/realms` 三页**没有任何权限门**,VIEWER 直接输 URL
      就能打开功能完整的页面 —— 因为侧边栏的菜单过滤**只藏链接、不挡路由**
  M65 说 `/audit` **有**门,而且门开错了:它问 `role === "ADMIN"`,而后端把
      `audit.read` 授予 ADMIN **与 MODERATOR** —— 一个持有该权限的人被界面挡在外面

两条互相矛盾,而 M65 是对的(`app/audit/page.tsx` 当时的 `enabled: isAdmin` 与
`if (!isAdmin)` 都在)。**「有洞」和「哪一层有洞」不是一回事**,而按名字 grep
`RequirePermission` 只能看见其中一种写法。

所以这个文件不 grep 某一个标识符,而是:枚举 `app/` 下**每一条页面路由**,要求它
要么出现权限判断(`RequirePermission` / `RequireAdmin` / `hasPermission` / `isAdmin`
任一),要么在下面的名单里写明理由。名单是**决定的记录**,不是豁免清单 ——
加一条要写一句话。

住在后端,与 `test_frontend_permission_strings_are_real.py` 同理:码名目录是
Django 的。
"""
import re
from pathlib import Path

import pytest

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"
APP = FRONTEND / "app"

#: 路由 -> 为什么它不需要页级权限门。
PUBLIC_OR_SELF_SERVICE = {
    "/": "登录前的落地页。",
    "/welcome": "登录前的欢迎页。",
    "/login": "登录页本身。",
    "/dashboard": "登录后的首页,每个角色都进得来;页内各区块自己带门。",
    "/profile": "本人资料,任何登录用户都该能看自己的。",
    "/notifications": "本人通知,同上。",
    "/social": "社交时间线对所有登录用户开放;可见性在后端按关注关系裁。",
    "/social/[id]": "同上。",
    "/social/follows": "同上。",
    "/social/profile/[id]": "同上。",
    "/souls/[id]": "灵魂详情页内每个操作各自带门(见 SoulActionsCard / SoulHeaderActions)。",
    "/judgment/[id]": "页内 judgment.execute 门。",
    "/dispatch/[id]": "页内 dispatch.approve / reject / execute 三道门。",
    "/workflow/[id]": "页内 workflow.approve / advance 门。",
    "/cross-judgments": "参与方由后端按租户裁;页面本身不构成额外授权。",
    "/cross-judgments/[id]": "同上。",
    "/corpus": "语料是公开的考据材料,不含任何租户数据。",
    "/death-sync": "只读视图,后端 DeathRegistrationReadViewSet 是 ADMIN-only。",
}

#: 一道门在**使用处**长什么样。不是 `("RequirePermission", ...)` 这样的裸名字:
#: 第一版是那样,而把 `/ledger` 的门整个拆掉、只留下那行没用到的
#: `import { RequirePermission }`,守卫**一条不红** —— 它把一个未使用的 import
#: 当成了一道门。这个仓库栽在「扫描器看的不是它以为在看的东西」上,这是第五次。
GATE_MARKERS = ("<RequirePermission", "<RequireAdmin", "hasPermission(", "isAdmin")


def routes():
    """`app/` 下每个 `page.tsx` 对应的路由。路由组 `(auth)` 不出现在 URL 里。"""
    out = []
    for page in APP.rglob("page.tsx"):
        parts = [p for p in page.relative_to(APP).parent.parts if not p.startswith("(")]
        out.append("/" + "/".join(parts) if parts else "/")
    return sorted(set(out))


ROUTES = routes()


def test_the_walk_found_a_non_trivial_number_of_routes():
    """守卫的守卫。`rglob` 返回空时,下面那条会以「没有违规者」通过 ——
    一个扫不到任何东西的扫描器,和一个什么都没扫出来的扫描器,输出一模一样。"""
    assert len(ROUTES) > 25, ROUTES


@pytest.mark.parametrize("route", [r for r in ROUTES if r not in PUBLIC_OR_SELF_SERVICE])
def test_every_other_route_has_a_gate(route):
    parts = [p for p in route.strip("/").split("/") if p]
    page = APP.joinpath(*parts, "page.tsx") if parts else APP / "page.tsx"
    if not page.exists():
        # 路由组:回退到全量搜索
        page = next(
            p for p in APP.rglob("page.tsx")
            if "/" + "/".join(x for x in p.relative_to(APP).parent.parts if not x.startswith("(")) == route
        )
    source = page.read_text(encoding="utf-8")
    # 只看代码,不看注释 —— 这个仓库已经四次栽在「扫描器读到了自己的文档」上。
    code = "\n".join(
        line for line in source.split("\n")
        if not line.lstrip().startswith("//")
        and not line.lstrip().startswith("*")
        # import 行不算 —— 见 GATE_MARKERS 上面那段。
        and not line.lstrip().startswith("import ")
    )
    assert any(m in code for m in GATE_MARKERS), (
        f"{route} 没有任何权限判断。侧边栏的菜单过滤只藏链接、不挡路由,所以"
        f"直接输 URL 就能打开它。若这是有意的,把它加进 PUBLIC_OR_SELF_SERVICE "
        f"并写明理由。"
    )


def test_the_exemption_list_names_only_real_routes():
    """名单会因为路由改名而悄悄失效 —— 一条指着不存在路由的豁免,读起来和一条
    生效的豁免完全一样,而它豁免的那个页面此刻没有门也没人知道。"""
    stale = sorted(set(PUBLIC_OR_SELF_SERVICE) - set(ROUTES))
    assert stale == [], f"豁免名单里这些路由已不存在:{stale}"


def test_the_audit_page_gates_on_the_codename_not_the_role():
    """M65 那一条,单独钉住。

    后端把 `audit.read` 授予 ADMIN **与 MODERATOR**。这一页曾问 `role === "ADMIN"`,
    于是 MODERATOR 看到「访问被拒绝 / 仅管理员可查看审计日志」并且一个请求都没发。
    上面那条通用规则抓不到它 —— `isAdmin` 也是一个合法的门标记。
    """
    source = (APP / "audit" / "page.tsx").read_text(encoding="utf-8")
    code = "\n".join(
        line for line in source.split("\n")
        if not line.lstrip().startswith("//") and not line.lstrip().startswith("*")
    )
    assert 'hasPermission("audit.read")' in code, (
        "审计页不再按 audit.read 判断 —— 若换回 isAdmin,持有该权限的 MODERATOR "
        "会被界面挡在外面,而后端会放行"
    )
    assert not re.search(r"^\s*(const \{ isAdmin \}|.*!isAdmin)", code, re.M), (
        "isAdmin 回到了审计页"
    )
