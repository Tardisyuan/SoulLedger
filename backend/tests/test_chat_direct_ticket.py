"""私聊发起不能再凭 user_id 数遍全库(RBAC 2026-10-29 第 29 条)。

此前 `POST /me/chat/conversations/ {target_user: N}` 的 N 是自增 id、候选集是**所有文明**的本世灵魂,
只受默认节流:按 1, 2, 3… 试下去,响应的 `peer_name` 就是全库灵魂的名字,还给每一个建了房。
现在:别的文明的人只能凭 `lookup`(完整编号、20 次/小时)发的一次性凭证;id 只认看得见的人。
**全部经真实 URL。** 每条的变异写在 docstring 里。
"""
from datetime import timedelta
from unittest import mock

import pytest

from apps.social.models import Follow
from tests.chat_support import matrix  # noqa: F401
from tests.soul_account_support import ready_soul

pytestmark = pytest.mark.django_db

LOOKUP = "/api/v1/me/chat/lookup/"
CONVERSATIONS = "/api/v1/me/chat/conversations/"


def _ticket(client, account):
    found = client.post(LOOKUP, {"soul_code": account.soul.soul_code}, format="json")
    assert found.status_code == 200, found.data
    return found.data["ticket"]


def _open(client, **body):
    return client.post(CONVERSATIONS, body, format="json")


def test_an_id_in_another_civilization_is_refused_like_one_that_does_not_exist(cn_tenant, eu_tenant, matrix):  # noqa: F811
    """逐个试 id:别的文明的人与不存在的 id **逐字节**同一个 404,不建房、不给名字。
    变异:视图去掉 `nameable_by_id` 那道判断 → 201,红;让它答别的 code → 两个响应体不同,红。"""
    _, a_client = ready_soul(cn_tenant, name="甲")
    b, _ = ready_soul(eu_tenant, name="Beatrice")

    foreign = _open(a_client, target_user=b.user_id)
    missing = _open(a_client, target_user=b.user_id + 10_000)
    assert foreign.status_code == missing.status_code == 404
    assert foreign.content == missing.content
    assert "Beatrice" not in foreign.content.decode()
    assert not matrix.rooms


def test_the_same_civilization_is_still_reachable_by_id(cn_tenant, matrix):  # noqa: F811
    """同文明本来就列得出(朋友圈搜索),所以 id 照旧能发起。
    变异:`nameable_by_id` 恒 False → 404,红。"""
    _, a_client = ready_soul(cn_tenant, name="甲")
    b, _ = ready_soul(cn_tenant, name="乙")
    opened = _open(a_client, target_user=b.user_id)
    assert opened.status_code == 201, opened.data
    assert opened.data["peer_name"] == "乙"


def test_a_follow_edge_left_from_before_a_move_still_names_by_id(cn_tenant, eu_tenant, matrix):  # noqa: F811
    """关注 / 粉丝列表给过这个 id(边可能记在对方换文明之前):照旧能发起。
    变异:`nameable_by_id` 删掉关注边那一支 → 404,红。"""
    a, a_client = ready_soul(cn_tenant, name="甲")
    b, _ = ready_soul(eu_tenant, name="Beatrice")
    Follow.objects.create(tenant=cn_tenant, follower=a.user, following=b.user)
    assert _open(a_client, target_user=b.user_id).status_code == 201


def test_a_ticket_opens_once(cn_tenant, eu_tenant, matrix):  # noqa: F811
    """凭证一次性:第一次 201,再交同一张 400 `ticket_invalid`;新查一次又能用(同一个房间,200)。
    变异:删掉 `spend_direct_ticket(used)` → 第二次 200,红。"""
    _, a_client = ready_soul(cn_tenant, name="甲")
    b, _ = ready_soul(eu_tenant, name="Beatrice")
    ticket = _ticket(a_client, b)

    first = _open(a_client, ticket=ticket)
    assert first.status_code == 201, first.data
    again = _open(a_client, ticket=ticket)
    assert again.status_code == 400
    assert again.data["code"] == "ticket_invalid"
    fresh = _open(a_client, ticket=_ticket(a_client, b))
    assert fresh.status_code == 200
    assert fresh.data["id"] == first.data["id"]


def test_a_failed_open_does_not_spend_the_ticket(cn_tenant, eu_tenant, matrix):  # noqa: F811
    """建房失败(这里是禁言 403)不烧掉一次查找:解禁后同一张凭证还能用。
    变异:把 `spend_direct_ticket` 挪到 `open_direct` 之前 → 第二次 400,红。"""
    from django.utils import timezone

    from apps.social.models import SocialMute

    a, a_client = ready_soul(cn_tenant, name="甲")
    b, _ = ready_soul(eu_tenant, name="Beatrice")
    ticket = _ticket(a_client, b)
    mute = SocialMute.objects.create(tenant=cn_tenant, user=a.user, until=timezone.now() + timedelta(days=1))
    assert _open(a_client, ticket=ticket).data["code"] == "muted"
    mute.delete()
    assert _open(a_client, ticket=ticket).status_code == 201


def test_an_expired_ticket_says_so(cn_tenant, eu_tenant, matrix):  # noqa: F811
    """过期答 400 `ticket_expired`(App 据此请对方重查),不建房。
    变异:`read_direct_ticket` 去掉 `max_age` → 201,红。"""
    from apps.chat import services as svc

    _, a_client = ready_soul(cn_tenant, name="甲")
    b, _ = ready_soul(eu_tenant, name="Beatrice")
    ticket = _ticket(a_client, b)
    # Any age is past a negative lifetime: the ticket reads as issued longer ago than it may live.
    with mock.patch.object(svc, "DIRECT_TICKET_TTL", timedelta(seconds=-1)):
        expired = _open(a_client, ticket=ticket)
    assert expired.status_code == 400
    assert expired.data["code"] == "ticket_expired"
    assert not matrix.rooms


def test_someone_elses_ticket_is_useless(cn_tenant, eu_tenant, matrix):  # noqa: F811
    """凭证绑定发起人:丙拿到甲的凭证也开不了;甲自己的照旧能用。伪造、改过的凭证同样不行。
    变异:`read_direct_ticket` 去掉 `data.get("i") != account.user_id` → 丙 201,红。"""
    _, a_client = ready_soul(cn_tenant, name="甲")
    _, c_client = ready_soul(cn_tenant, name="丙")
    b, _ = ready_soul(eu_tenant, name="Beatrice")
    ticket = _ticket(a_client, b)

    stolen = _open(c_client, ticket=ticket)
    assert stolen.status_code == 400
    assert stolen.data["code"] == "ticket_invalid"
    for forged in (ticket[:-2] + ("AA" if not ticket.endswith("AA") else "BB"), "garbage", "x" * 400):
        assert _open(a_client, ticket=forged).data["code"] == "ticket_invalid", forged
    assert not matrix.rooms
    assert _open(a_client, ticket=ticket).status_code == 201


def test_ticket_and_id_together_is_a_400(cn_tenant, eu_tenant):
    _, a_client = ready_soul(cn_tenant, name="甲")
    b, _ = ready_soul(eu_tenant, name="Beatrice")
    both = _open(a_client, ticket=_ticket(a_client, b), target_user=b.user_id)
    assert both.status_code == 400
