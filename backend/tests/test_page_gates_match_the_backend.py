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

import pytest

from tests.web_routes import APP, pages, public_paths, routes

#: 登录后才进得来、却不需要页级权限门的页面 -> 为什么。
#:
#: **公开页不在这里**:它们的理由写在 `frontend/proxy.ts` 的 `PUBLIC_PATHS` 里(那是「无需登录」
#: 的唯一决定),这里读它(`tests/web_routes.py`)。2026-11-10 之前这里另抄了一份,加 `/goodbye`
#: 要两边都改。没有会话的页面谈不上权限门,所以公开即豁免;新增公开页只改 proxy.ts。
SELF_SERVICE = {
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
}

PUBLIC = public_paths()

#: 路由 -> 为什么它不需要页级权限门:公开页(理由在 proxy.ts)加上面的自助页。
PUBLIC_OR_SELF_SERVICE = {**PUBLIC, **SELF_SERVICE}

#: 一道门在**使用处**长什么样。不是 `("RequirePermission", ...)` 这样的裸名字:
#: 第一版是那样,而把 `/ledger` 的门整个拆掉、只留下那行没用到的
#: `import { RequirePermission }`,守卫**一条不红** —— 它把一个未使用的 import
#: 当成了一道门。这个仓库栽在「扫描器看的不是它以为在看的东西」上,这是第五次。
GATE_MARKERS = ("<RequirePermission", "<RequireAdmin", "hasPermission(", "isAdmin")


#: 门的位置(rbac-web L-1,2026-10-29)。上面那组标记只问「源码里**有没有**一道门」,而按钮上的
#: `hasPermission(` 也算 —— `/souls`、`/users`、`/workflow`、`/disposition`、`/dispatch/propose`、
#: `/menus/buttons` 都因为某个按钮的门而被判「有门」,直接输 URL 照样进得了页壳。所以现在要求门在
#: **默认导出的最外层**:它 `return` 的第一个元素就是 `<RequirePermission` / `<RequireAdmin`,
#: 或者它在函数体顶层先 `if (!<码判断>) return …`(审计各页的早返回写法)。
OUTERMOST_GATE = re.compile(r"^\s*<(RequirePermission|RequireAdmin)\b")
EARLY_RETURN_GATE = re.compile(r"^  if \(\s*!\s*(hasPermission\(|hasAnyPermission\(|isAdmin\b|can[A-Z]\w*\s*\))", re.M)


def _default_export_body(source):
    m = re.search(r"^export default function \w+\([^)]*\)[^{]*\{\n", source, re.M)
    if m is None:
        return None
    end = re.search(r"^\}", source[m.end():], re.M)
    body = source[m.end(): m.end() + end.start()]
    body = re.sub(r"\{/\*.*?\*/\}", "", body, flags=re.S)
    body = re.sub(r"/\*.*?\*/", "", body, flags=re.S)
    return "\n".join(line for line in body.split("\n") if not line.lstrip().startswith("//"))


def gate_is_outermost(source):
    body = _default_export_body(source)
    if body is None:
        return False
    if EARLY_RETURN_GATE.search(body):
        return True
    first_return = re.search(r"^  return\b", body, re.M)
    if first_return is None:
        return False
    return bool(OUTERMOST_GATE.match(body[first_return.end():].lstrip().lstrip("(")))


#: `app/` 下每个 `page.tsx` 对应的路由(`tests/web_routes.py`)。路由组 `(auth)` 不出现在 URL 里。
ROUTES = routes()


def test_the_walk_found_a_non_trivial_number_of_routes():
    """守卫的守卫。`rglob` 返回空时,下面那条会以「没有违规者」通过 ——
    一个扫不到任何东西的扫描器,和一个什么都没扫出来的扫描器,输出一模一样。"""
    assert len(ROUTES) > 25, ROUTES


@pytest.mark.parametrize("route", [r for r in ROUTES if r not in PUBLIC_OR_SELF_SERVICE])
def test_every_other_route_has_a_gate(route):
    source = _page_source(route)
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
        f"直接输 URL 就能打开它。若这是有意的:登录后的自助页加进 SELF_SERVICE 并写明理由;"
        f"无需登录的页加进 frontend/proxy.ts 的 PUBLIC_PATHS。"
    )
    assert gate_is_outermost(source), (
        f"{route} 的门不在页面最外层:默认导出 return 的第一个元素应是 <RequirePermission> / "
        f"<RequireAdmin>(放在 Suspense 外面),或者在函数体顶层先 `if (!<码判断>) return`。"
        f"按钮上的 hasPermission 不挡路由,直接输 URL 会进到页壳里一片 403。"
    )


def test_the_outermost_rule_tells_a_page_gate_from_a_button_gate():
    """守卫的守卫:规则本身要分得清两种写法,否则上面那条会对着任何页面都绿。"""
    page_gate = (
        'export default function P() {\n  return (\n    <RequirePermission permissions="soul.read">\n'
        '      <Suspense fallback={null}><X /></Suspense>\n    </RequirePermission>\n  );\n}\n'
    )
    early = (
        'export default function P() {\n  const { hasPermission } = usePermissions();\n'
        '  if (!hasPermission("audit.read")) {\n    return <D />;\n  }\n  return <X />;\n}\n'
    )
    button_gate = (
        'export default function P() {\n  return (\n    <Suspense fallback={null}>\n      <X />\n    </Suspense>\n  );\n}\n'
        'function X() {\n  return <RequirePermission permissions="soul.create"><B /></RequirePermission>;\n}\n'
    )
    nested = (
        'export default function P() {\n  return (\n    <PageShell>\n      <RequireAdmin><X /></RequireAdmin>\n'
        '    </PageShell>\n  );\n}\n'
    )
    assert gate_is_outermost(page_gate) and gate_is_outermost(early)
    assert not gate_is_outermost(button_gate) and not gate_is_outermost(nested)


def _page_source(route):
    page = next(p for p, r in pages().items() if r == route)
    return page.read_text(encoding="utf-8")


def test_the_exemption_list_names_only_real_routes():
    """名单会因为路由改名而悄悄失效 —— 一条指着不存在路由的豁免,读起来和一条
    生效的豁免完全一样,而它豁免的那个页面此刻没有门也没人知道。"""
    stale = sorted(set(PUBLIC_OR_SELF_SERVICE) - set(ROUTES))
    assert stale == [], f"豁免名单里这些路由已不存在:{stale}"


def test_public_routes_are_read_from_the_proxy_with_their_reasons():
    """守卫的守卫:公开页从 proxy.ts 解析而来。解析坏了(比如对象换了写法)会得到空表或丢条目,
    那时公开页会在上面那条里显示成「没有门」—— 方向是红的,但原因读起来不对,所以这里直说。
    `/login` 是登录闸门本身,它不公开就没有人能登录,拿它当探针。"""
    assert "/login" in PUBLIC, PUBLIC
    assert all(reason.strip() for reason in PUBLIC.values()), PUBLIC
    assert not set(PUBLIC) & set(SELF_SERVICE), "同一页不会既无需登录又需要登录"


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
        "审计页不再按 audit.read 判断 —— 若换回 isAdmin,持有该权限的非 ADMIN 角色 "
        "会被界面挡在外面,而后端会放行"
    )
    assert not re.search(r"^\s*(const \{ isAdmin \}|.*!isAdmin)", code, re.M), (
        "isAdmin 回到了审计页"
    )
