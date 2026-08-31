"""登录会写 `last_login`。

**这条守的是一个曾经被当成证据用的空列。** 2026-08-31 在共享库上实测:100 个用户里
`last_login` 非空的有 **0 个** —— 包括那个名下有 22 条审计记录的账号。原因是
`SIMPLE_JWT` 没设 `UPDATE_LAST_LOGIN`(默认 False),而 `apps/authentication/` 里
除了迁移没有任何代码碰这个列。

后果不是「少了个功能」,是**这个列读起来像一个答案**。同一轮里有两次调查拿
「从未登录」当过证据 —— 一次是那个孤儿账号 `Pluto`,一次是四个绑着 Norse 的
管理员账号 —— 而那个字段对**所有人**都是空的,它一个都区分不出来。
**一个对每一行都为空的列,没法用来区分任何两行**,而要发现这一点得去读 settings。

所以这里断言的是行为(登录之后那一列变了),不是配置项的值:把
`UPDATE_LAST_LOGIN` 删掉会红,而把它改成别的等价实现不会。
"""
import pytest

from apps.authentication.models import User


@pytest.fixture
def probe(db, cn_tenant):
    return User.objects.create_user(
        username="last_login_probe", password="probe-pass-123", role="VIEWER", tenant=cn_tenant
    )


@pytest.mark.django_db
def test_a_successful_login_stamps_last_login(api_client, probe):
    assert probe.last_login is None, "前置条件:新建的账号还没有登录记录"

    response = api_client.post(
        "/api/v1/auth/login/",
        {"username": probe.username, "password": "probe-pass-123"},
        format="json",
    )
    assert response.status_code == 200, response.data

    probe.refresh_from_db()
    assert probe.last_login is not None, (
        "登录成功但 last_login 仍是空 —— SIMPLE_JWT 的 UPDATE_LAST_LOGIN 默认 False,"
        "而没有别的代码写这一列"
    )


@pytest.mark.django_db
def test_a_failed_login_does_not_stamp_it(api_client, probe):
    """反对照。

    没有它,一个「每次打这个端点都写一下」的实现同样满足上面那条,而那会把
    暴力尝试记成登录成功 —— 那个列就又一次说不出真话了。
    """
    response = api_client.post(
        "/api/v1/auth/login/",
        {"username": probe.username, "password": "wrong"},
        format="json",
    )
    assert response.status_code >= 400

    probe.refresh_from_db()
    assert probe.last_login is None


@pytest.mark.django_db
def test_a_token_refresh_does_not_stamp_it(api_client, probe):
    """第二个反对照:刷新 token 不是一次登录。

    若刷新也写,那么一个开着的浏览器会让这一列永远是「刚刚」,而它本该回答的是
    「这个人上次真的输过密码是什么时候」。
    """
    login = api_client.post(
        "/api/v1/auth/login/",
        {"username": probe.username, "password": "probe-pass-123"},
        format="json",
    )
    assert login.status_code == 200
    probe.refresh_from_db()
    first = probe.last_login
    assert first is not None

    api_client.post(
        "/api/v1/auth/refresh/", {"refresh": login.data["refresh"]}, format="json"
    )
    probe.refresh_from_db()
    assert probe.last_login == first, "刷新 token 被记成了一次登录"
