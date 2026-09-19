"""按灵魂编号找人:跨文明私聊的发起入口(`POST /api/v1/me/chat/lookup/`)。

朋友圈搜索只到当前所在文明(用户明确不改它),于是找别的文明的人只有这一条路。
**全部经真实 URL。** 每条的变异证明写在 docstring 里(改哪一行、哪条会红)。
"""
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.authentication.models import User
from apps.social.models import SocialMute
from tests.chat_support import matrix  # noqa: F401
from tests.soul_account_support import officer_client, ready_soul

pytestmark = pytest.mark.django_db

LOOKUP = "/api/v1/me/chat/lookup/"
CONVERSATIONS = "/api/v1/me/chat/conversations/"


def _lookup(client, code):
    return client.post(LOOKUP, {"soul_code": code}, format="json")


def test_a_soul_in_another_civilization_is_found_by_its_exact_code(cn_tenant, eu_tenant, matrix):  # noqa: F811
    """跨文明精确命中,拿到的 user_id 直接走现有的发起流程(非互关 → 请求)。
    变异:`find_by_soul_code` 的候选集从 `_reachable(account)` 换成
    `circle.souls_in(account.soul.tenant)`(朋友圈的同文明集合)→ 404,红。"""
    a, a_client = ready_soul(cn_tenant, name="甲")
    b, _ = ready_soul(eu_tenant, name="Beatrice")

    response = _lookup(a_client, b.soul.soul_code)
    assert response.status_code == 200, response.data
    assert response.data["user_id"] == b.user_id
    assert response.data["display_name"] == "Beatrice"

    opened = a_client.post(CONVERSATIONS, {"target_user": response.data["user_id"]}, format="json")
    assert opened.status_code == 201, opened.data
    assert opened.data["throttled"] is True


def test_the_card_is_the_circle_whitelist_and_nothing_else(cn_tenant, eu_tenant):
    """字段白名单:与朋友圈名片同一个序列化器。断言**不在场**:编号、UUID、姓名以外的身份。
    变异:视图改回 `{"user_id": ..., "soul_code": target.soul_account.soul.soul_code, ...}`
    或换成带 `soul` / `tenant` 字段的序列化器 → 键集合不等,红。"""
    _, a_client = ready_soul(cn_tenant, name="甲")
    b, _ = ready_soul(eu_tenant, name="Beatrice")

    response = _lookup(a_client, b.soul.soul_code)
    assert set(response.data) == {"user_id", "display_name", "avatar", "is_active"}
    blob = response.content.decode()
    # 整数主键不当探针:「2」会在 user_id 里误报。UUID、编号、用户名(内含编号)、文明代码才是。
    for leaked in (b.soul.soul_code, str(b.soul_id), b.user.username, eu_tenant.code):
        assert leaked not in blob, leaked


def test_only_the_whole_code_matches(cn_tenant, eu_tenant):
    """前缀、多一位、少一位都不命中 —— 编号是登录名,前缀匹配等于把登录名表按前缀交出去。
    变异:`soul_code=` 改成 `soul_code__startswith=` → 前缀命中 200,红;
    改成 `soul_code__icontains=` → 同上。"""
    _, a_client = ready_soul(cn_tenant, name="甲")
    b, _ = ready_soul(eu_tenant, name="Beatrice")
    code = b.soul.soul_code

    for probe in (code[:4], code[:-1], code[1:], code + "2"):
        assert _lookup(a_client, probe).status_code == 404, probe
    assert _lookup(a_client, code).status_code == 200


def test_case_and_surrounding_space_are_normalized_like_login(cn_tenant, eu_tenant):
    """大小写与首尾空白按登录同一条规则(`normalize_soul_code`)。
    变异:`normalize_soul_code` 去掉 `.upper()` → 小写输入 404,红。"""
    _, a_client = ready_soul(cn_tenant, name="甲")
    b, _ = ready_soul(eu_tenant, name="Beatrice")
    code = b.soul.soul_code

    for probe in (code.lower(), f"  {code.lower()}\t", code.capitalize()):
        response = _lookup(a_client, probe)
        assert response.status_code == 200, probe
        assert response.data["user_id"] == b.user_id


def test_every_kind_of_not_found_is_the_same_bytes(cn_tenant, eu_tenant):
    """不存在、自己、前世账号、官员、停用 —— 状态码与响应体**逐字节**相同,不给任何原因留区分。
    变异:`find_by_soul_code` 在查询前加 `if 编号是自己的: raise ChatError(..., "self_lookup", 400)`
    → 自己那一条不同,红;把候选集的 `soul_account__retired_at__isnull=True` 去掉 → 前世那条 200,红。"""
    a, a_client = ready_soul(cn_tenant, name="甲")
    past, _ = ready_soul(eu_tenant, name="前世")
    past.retired_at = timezone.now()
    past.save()
    turned, _ = ready_soul(eu_tenant, name="被改成官员")
    User.objects.filter(pk=turned.user_id).update(role="JUDGE")
    frozen, _ = ready_soul(eu_tenant, name="停用")
    User.objects.filter(pk=frozen.user_id).update(is_active=False)

    responses = {
        "missing": _lookup(a_client, "ZZZZZZZZZZ"),
        "self": _lookup(a_client, a.soul.soul_code),
        "past_life": _lookup(a_client, past.soul.soul_code),
        "officer": _lookup(a_client, turned.soul.soul_code),
        "inactive": _lookup(a_client, frozen.soul.soul_code),
    }
    statuses = {name: r.status_code for name, r in responses.items()}
    assert set(statuses.values()) == {404}, statuses
    bodies = {r.content for r in responses.values()}
    assert len(bodies) == 1, bodies
    assert responses["missing"].json() == {"detail": "找不到这个灵魂。", "code": "not_found"}


def test_lookups_are_limited_per_soul_account(cn_tenant, eu_tenant, settings):
    """按灵魂账号计数:用完额度的账号 429(`rate_limited` + `retry_at`),另一个账号不受影响;
    命中与未命中都计数(命中本身就是信息)。
    变异:删掉 `MeChatLookupView.throttle_classes` → 第 21 次仍 404,红;
    `ChatLookupThrottle` 的基类换成按地址计的 `ClientIPRateThrottle` → 两个账号(同一测试地址)
    共用额度,乙第一次就 429,红。"""
    _, a_client = ready_soul(cn_tenant, name="甲")
    _, c_client = ready_soul(cn_tenant, name="丙")
    b, _ = ready_soul(eu_tenant, name="Beatrice")
    limit = int(settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]["chat_lookup"].split("/")[0])
    assert limit == 20

    for i in range(limit):
        probe = b.soul.soul_code if i % 2 else "ZZZZZZZZZZ"
        assert _lookup(a_client, probe).status_code in (200, 404)
    refused = _lookup(a_client, b.soul.soul_code)
    assert refused.status_code == 429
    assert refused.data["code"] == "rate_limited"
    assert refused.data["retry_at"] > timezone.now().isoformat()

    assert _lookup(c_client, b.soul.soul_code).status_code == 200


def test_only_a_current_soul_token_may_look_up(cn_tenant, eu_tenant, admin_user, eu_admin_user):
    """分界与租户:官员令牌(任何殿司)403、匿名 401;首登改密前与 /me 其余接口同一道闸。
    `test_soul_auth_boundary.py::test_every_me_route_is_a_soul_api_view` 另外经 URLconf 钉住基类。
    变异:`MeChatLookupView` 加 `authentication_classes = [OfficerJWTAuthentication]`
    与 `permission_classes = [IsAuthenticated]` → 官员请求越过分界、进到视图里(没有灵魂账号,500),
    不再是 403,红。"""
    from rest_framework.test import APIClient

    a, a_client = ready_soul(cn_tenant, name="甲")
    b, _ = ready_soul(eu_tenant, name="Beatrice")
    code = b.soul.soul_code

    assert APIClient().post(LOOKUP, {"soul_code": code}, format="json").status_code == 401
    for officer in (admin_user, eu_admin_user):
        assert _lookup(officer_client(officer), code).status_code == 403
    a.must_change_password = True
    a.save()
    assert _lookup(a_client, code).status_code == 403


def test_a_muted_soul_can_look_up_but_not_open(cn_tenant, eu_tenant, matrix):  # noqa: F811
    """查可以;发起仍走聊天现有的禁言规则(403 `muted`)。
    变异:`find_by_soul_code` 里加 `circle.active_mute` 判定 → 查找 403,红。"""
    a, a_client = ready_soul(cn_tenant, name="甲")
    b, _ = ready_soul(eu_tenant, name="Beatrice")
    SocialMute.objects.create(tenant=cn_tenant, user=a.user, until=timezone.now() + timedelta(days=1))

    found = _lookup(a_client, b.soul.soul_code)
    assert found.status_code == 200
    opened = a_client.post(CONVERSATIONS, {"target_user": found.data["user_id"]}, format="json")
    assert opened.status_code == 403
    assert opened.data["code"] == "muted"
    assert not matrix.rooms


def test_a_malformed_body_is_a_400_not_a_lookup(cn_tenant):
    _, a_client = ready_soul(cn_tenant, name="甲")
    assert a_client.post(LOOKUP, {}, format="json").status_code == 400
    assert _lookup(a_client, "   ").status_code == 400
    assert _lookup(a_client, "A" * 33).status_code == 400
