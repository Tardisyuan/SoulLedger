"""灵魂朋友圈测试共用的造数据函数(不是测试文件,pytest 不收集)。"""
from apps.social import soul_circle as circle
from apps.social.models import Post, Visibility
from tests.soul_account_support import officer_client, ready_soul, soul_client  # noqa: F401 - 转出给测试用

SOCIAL = "/api/v1/me/social"
MODERATION = "/api/v1/social-moderation"


def soul(tenant, name, *, home_tenant=None):
    """一个改过密、可以直接用 `/me/social/` 的灵魂。返回 (account, client)。

    `home_tenant` 不为空即**暂居**:`Soul.tenant` 是当前所在(朋友圈按它算),
    `home_tenant` 是原属。`Soul.save()` 只在新建且为空时把 home_tenant 置成 tenant,
    所以这里建完再改一次 —— 与 `DispatchService.execute` 的效果相同(它改的是 `tenant`)。
    """
    account, client = ready_soul(tenant, name=name)
    if home_tenant is not None:
        type(account.soul).all_objects.filter(pk=account.soul_id).update(home_tenant=home_tenant)
        account.soul.refresh_from_db()
    return account, client


def post(author_account, content="一条帖子", visibility=Visibility.TENANT, tenant=None):
    """直接建帖,绕过接口 —— 造「别人的帖子」时不需要再登录一次。"""
    return Post.objects.create(
        author=author_account.user,
        content=content,
        visibility=visibility,
        tenant=tenant or circle.civilization_of(author_account.user),
    )


def follow(follower_account, target_account):
    circle.follow(follower_account.user, target_account.user.pk)


def feed_ids(client, **params):
    res = client.get(f"{SOCIAL}/feed/", params)
    assert res.status_code == 200, res.content
    return {row["id"] for row in res.json()["results"]}
