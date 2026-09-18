"""两道分界:令牌走错门,以及搜索结果的字段白名单。

第一道已经由 `apps/soul_accounts/authentication.py` 立在项目层面
(`tests/test_soul_auth_boundary.py` 钉住它)。这里加的是**这一批新路由**上的
同一个问题:一条新路由只要挂错了基类,那道分界在它身上就不存在,而项目层面的
断言不会因此变红 —— 它走的是它自己的清单。

第二道是这一轮独有的:朋友圈里灵魂互相看得见的字段是一份白名单,
`test_a_soul_card_carries_nothing_but_the_whitelist` 断言**不在场**的那些。
"""
import pytest

from tests.soul_social_support import MODERATION, SOCIAL, officer_client, post, soul

pytestmark = pytest.mark.django_db

#: 灵魂名片允许出现的字段。多一个就要在这里加一行 —— 加不加得出来,是一次决定。
CARD_FIELDS = {"user_id", "display_name", "avatar", "is_active", "is_following"}

#: 绝不能出现在朋友圈任何响应里的东西。左边是字段名,右边是它为什么危险。
FORBIDDEN = {
    "soul_code": "登录名",
    "username": "内含登录名",
    "contact_email": "联系方式",
    "contact_phone": "联系方式",
    "contact_email_masked": "联系方式",
    "contact_phone_masked": "联系方式",
    "merit_score": "功过",
    "demerit_score": "功过",
    "karmic_balance": "功过",
    "current_state": "审判进展",
    "judgments": "审判细节",
    "dispositions": "处置细节",
    "tenant": "租户",
    "email": "联系方式",
}


def test_a_soul_token_cannot_open_the_moderation_backend(cn_tenant):
    _, client = soul(cn_tenant, "灵魂甲")
    for path in ["reports/", "posts/", "comments/", "sensitive-words/", "mutes/"]:
        res = client.get(f"{MODERATION}/{path}")
        assert res.status_code == 403, f"{path} 让灵魂令牌进来了:{res.status_code}"


def test_an_officer_token_cannot_open_the_soul_circle(cn_tenant, admin_user):
    client = officer_client(admin_user)
    for path in ["status/", "feed/", "search/?q=x", "following/", "followers/", "reports/"]:
        res = client.get(f"{SOCIAL}/{path}")
        assert res.status_code == 403, f"{path} 让官员令牌进来了:{res.status_code}"


def test_every_me_social_route_is_a_soul_api_view():
    """遍历真实 URLconf —— 不是遍历本模块记得的清单。

    `tests/test_soul_auth_boundary.py` 有同名的一条,走的是 `/api/v1/me/` 全部路由,
    所以这条是冗余的吗?不是:那条在这批路由**挂上去之前**就是绿的,而它变红的
    唯一条件是有人把一条 /me/ 路由挂成别的基类 —— 正是这里要防的。留一条本地的,
    是因为这批路由有一个自己的基类(`SoulSocialView`),它若哪天不再继承
    `SoulAPIView`,项目层面那条仍然绿(它只看 `SoulAPIView` 的 MRO 是否在链上)。
    """
    from django.urls import get_resolver

    from apps.soul_accounts.me_views import SoulAPIView

    found = []

    def walk(resolver, prefix):
        for pattern in resolver.url_patterns:
            path = prefix + str(pattern.pattern)
            if hasattr(pattern, "url_patterns"):
                walk(pattern, path)
            elif path.startswith("api/v1/me/social/"):
                view = getattr(pattern.callback, "view_class", None) or getattr(pattern.callback, "cls", None)
                found.append((path, view))

    walk(get_resolver(), "")
    # 路由数写死:少了一条(改名、挪走)这条断言会红,而「没扫到」本身是这个仓库
    # 记了六次的失败形状 —— 它的输出与全绿一模一样。
    assert len(found) == 12, f"/me/social/ 路由数不是 12:{[p for p, _ in found]}"
    wrong = [path for path, v in found if v is None or not issubclass(v, SoulAPIView)]
    assert wrong == [], f"这些 /me/social/ 视图不是 SoulAPIView,那道认证分界在它们身上不存在:{wrong}"


def test_a_soul_card_carries_nothing_but_the_whitelist(cn_tenant):
    _, client = soul(cn_tenant, "搜索者")
    target, _ = soul(cn_tenant, "被搜的人")

    rows = client.get(f"{SOCIAL}/search/", {"q": "被搜"}).json()
    assert [r["user_id"] for r in rows] == [target.user_id]
    assert set(rows[0]) == CARD_FIELDS, f"搜索结果的字段集变了:{sorted(rows[0])}"
    for field, why in FORBIDDEN.items():
        assert field not in rows[0], f"搜索结果里出现了 {field}({why})"


def test_a_soul_can_be_found_by_its_code_but_the_code_is_not_returned(cn_tenant):
    """编号是登录名。按它精确搜得到人(知道编号的人本来就知道),但结果里不回显它 ——
    否则搜一个常见名字就能把本文明的登录名表一批批换出来。"""
    _, client = soul(cn_tenant, "搜索者")
    target, _ = soul(cn_tenant, "被搜的人")
    code = target.soul.soul_code

    rows = client.get(f"{SOCIAL}/search/", {"q": code}).json()
    assert [r["user_id"] for r in rows] == [target.user_id]
    assert code not in str(rows), "灵魂编号被回显了"
    # 前缀搜不到:模糊匹配编号等于把编号表按前缀交出去。
    assert client.get(f"{SOCIAL}/search/", {"q": code[:4]}).json() == []


def test_a_post_and_a_profile_carry_nothing_forbidden(cn_tenant):
    author, _ = soul(cn_tenant, "作者")
    _, client = soul(cn_tenant, "读者")
    row = post(author, "一条帖子")

    seen = client.get(f"{SOCIAL}/posts/{row.pk}/").json()
    profile = client.get(f"{SOCIAL}/users/{author.user_id}/").json()
    blob = f"{seen}{profile}"
    for field, why in FORBIDDEN.items():
        assert f"'{field}'" not in blob, f"帖子或主页里出现了 {field}({why})"
    assert author.soul.soul_code not in blob
