"""`rate_limit_per_minute` 真的会拦下第 N+1 个请求。

`ApiKeyRateThrottle` 从这个 app 落地起就写在那里,**接在任何东西上**:
`DEFAULT_THROTTLE_CLASSES` 只有 `AnonRateThrottle`,全仓 grep `throttle_classes`
零命中。实测(接线之前):一个 `rate_limit_per_minute=1` 的 key 连发五次 →
`[200, 200, 200, 200, 200]`。

模型有这个列、序列化器暴露它、admin 表单能改它、健康检查还把它报出去 ——
**四个地方都在说这个限制生效了**,而没有一行代码执行它。

接线之后当场暴露两个只有在被调用时才会现形的缺陷,两条都在下面钉住:

  `self.wait = period` 遮住了 `BaseThrottle.wait`,而 DRF 是当**方法**调它的。
    第一个真正被限流的请求会抛 `TypeError: 'int' object is not callable`,
    而不是返回 429。
  非 Redis 回落路径比较的是**自增之前**的计数,于是它放行 `limit + 1` 个。
    两条路径两个限额,而当时没有任何测试能看见其中任何一个。

这就是「写了没接线」和「写了能用」的区别 —— 前者读起来完全一样。
"""
import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from apps.death_sync.models import ExternalApiKey
from apps.death_sync.throttling import ApiKeyRateThrottle

# `register/` 是 API-key 认证的那个;`registrations/` 是同一批行的 JWT 只读视图。
REGISTER = "/api/v1/death-sync/register/"
HEALTH = "/api/v1/death-sync/health/"


@pytest.fixture(autouse=True)
def clean_counter():
    cache.clear()
    yield
    cache.clear()


@pytest.fixture
def key(db, cn_tenant):
    raw, key_hash, key_prefix = ExternalApiKey.generate_key()
    return ExternalApiKey.objects.create(
        name="rate probe",
        system_type="HOSPITAL",
        key_hash=key_hash,
        key_prefix=key_prefix,
        tenant=cn_tenant,
        is_active=True,
        rate_limit_per_minute=3,
        rate_limit_per_hour=1000,
        can_query_status=True,
    ), raw


def client_for(raw):
    c = APIClient()
    c.credentials(HTTP_AUTHORIZATION=f"ApiKey {raw}")
    return c


@pytest.mark.django_db
def test_the_fourth_request_of_a_three_per_minute_key_is_refused(key):
    _, raw = key
    client = client_for(raw)

    codes = [client.get(REGISTER).status_code for _ in range(4)]

    # 断言的是**整个序列**,不是「最后一个是 429」。只看最后一个的话,一个
    # 「永远拒绝」的限流器也能通过,而它会把这个接口整个关掉。
    assert codes[:3] == [200, 200, 200], f"限额之内的请求被拦了:{codes}"
    assert codes[3] == 429, f"第 4 个请求没被拦:{codes}"


@pytest.mark.django_db
def test_a_refused_request_returns_429_and_not_a_type_error(key):
    """接线时暴露的第一个缺陷,单独钉住。

    `self.wait = period` 遮住 `BaseThrottle.wait` 时,DRF 调 `throttle.wait()`
    会抛 `TypeError`,DRF 把它变成 500 —— 而不是 429。两者都「不是 200」,
    只断言「被拒了」看不出区别。
    """
    _, raw = key
    client = client_for(raw)
    for _ in range(3):
        client.get(REGISTER)

    response = client.get(REGISTER)
    assert response.status_code == 429, response.status_code
    # DRF 从 `wait()` 的返回值建这个头。它在,就说明那个方法真的被调用并返回了数。
    assert response.headers.get("Retry-After") is not None


@pytest.mark.django_db
def test_the_two_counting_paths_agree_on_the_limit(key):
    """接线时暴露的第二个缺陷。

    回落路径此前比较自增**之前**的计数,放行 `limit + 1` 个。直接驱动那条路径
    (把 Redis 那一支弄失败),数它到第几个开始拒绝。
    """
    api_key, _ = key

    class _Req:
        pass

    request = _Req()
    request.api_key = api_key

    throttle = ApiKeyRateThrottle()
    # 这个环境里根本没装 `django_redis` —— 那条 `from django_redis import ...`
    # 每次都抛 ImportError,于是**回落路径就是这里唯一跑得到的路径**。
    # 这一点本身值得说:那个 `except Exception` 把「Redis 挂了」和「这个依赖压根
    # 不存在」吞成同一件事,而两者在生产上的含义完全不同。
    import importlib.util

    assert importlib.util.find_spec("django_redis") is None, (
        "装上 django_redis 之后这条测试就不再驱动回落路径了 —— "
        "改成显式打桩,别让它悄悄变成在测另一条路径"
    )
    allowed = [throttle.allow_request(request, None) for _ in range(4)]

    assert allowed == [True, True, True, False], (
        f"回落路径放行了 {sum(allowed)} 个,而限额是 3 —— 两条计数路径不一致"
    )


@pytest.mark.django_db
def test_health_stays_reachable_while_the_data_endpoint_is_throttled(key):
    """健康检查有意不限流:它是操作者用来查「我为什么被拒」的地方。

    这条同时也是上面那批的反对照 —— 限流是挂在具体视图上的,不是全局把所有
    带 API key 的请求都拦了。
    """
    _, raw = key
    client = client_for(raw)
    for _ in range(4):
        client.get(REGISTER)
    assert client.get(REGISTER).status_code == 429

    assert client.get(HEALTH).status_code == 200


@pytest.mark.django_db
def test_health_reports_the_remaining_count_under_that_name(key):
    """`rate_limit_remaining` 此前报的是**配置上限**,永远不是剩余数 ——
    而且在什么都没计数的时候,它连一个坏答案都算不上。"""
    _, raw = key
    client = client_for(raw)
    client.get(REGISTER)
    client.get(REGISTER)

    body = client.get(HEALTH).json()["api_key"]
    assert body["rate_limit"]["per_minute"] == 3, "上限换了个诚实的名字"
    assert body["rate_limit_remaining"]["per_minute"] == 1, (
        f"用掉 2 个之后剩余应当是 1,报的是 {body['rate_limit_remaining']['per_minute']}"
    )
