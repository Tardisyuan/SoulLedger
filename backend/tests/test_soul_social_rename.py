"""改朋友圈显示名:`PATCH /me/social/profile/`。

每条拒绝都断言两件事:答的是哪个 `code`,以及**旧名字还在** —— 一个先存后拒的实现
会让第一条绿、第二条红。
"""
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.social.models import SensitiveWord, SocialMute
from apps.soul_accounts.models import SoulAccount
from tests.soul_social_support import SOCIAL, soul

pytestmark = pytest.mark.django_db


def _rename(client, name):
    return client.patch(f"{SOCIAL}/profile/", {"display_name": name}, format="json")


def _name_of(account):
    account.user.refresh_from_db()
    return account.user.display_name


def test_a_soul_can_rename_itself_and_the_new_name_is_what_others_see(cn_tenant):
    me, client = soul(cn_tenant, "甲")
    _, other_client = soul(cn_tenant, "乙")
    res = _rename(client, "  新名字  ")
    assert res.status_code == 200, res.content
    assert res.json()["display_name"] == "新名字", "两端空白没有去掉"
    assert _name_of(me) == "新名字"
    card = other_client.get(f"{SOCIAL}/users/{me.user_id}/").json()
    assert card["display_name"] == "新名字"


@pytest.mark.parametrize("name", ["", " 甲 ", "一" * 21])
def test_a_name_outside_2_to_20_characters_is_refused(cn_tenant, name):
    me, client = soul(cn_tenant, "原名")
    res = _rename(client, name)
    assert res.status_code == 400, res.content
    assert res.json()["code"] == "display_name_length"
    assert _name_of(me) == "原名"


def test_exactly_2_and_20_characters_are_accepted(cn_tenant):
    _, client = soul(cn_tenant, "原名")
    assert _rename(client, "二字").status_code == 200
    assert _rename(client, "二" * 20).status_code == 200


def test_a_sensitive_name_is_refused_not_saved_as_pending(cn_tenant, eu_tenant):
    SensitiveWord.objects.create(tenant=cn_tenant, word="违禁词")
    me, client = soul(cn_tenant, "原名")
    res = _rename(client, "我是违禁词呀")
    assert res.status_code == 400, res.content
    assert res.json()["code"] == "display_name_sensitive"
    assert _name_of(me) == "原名", "命中敏感词的名字被存下了"
    # 词表按文明:别的文明的灵魂不受这条词影响。
    _, eu_client = soul(eu_tenant, "欧")
    assert _rename(eu_client, "我是违禁词呀").status_code == 200


def test_a_display_name_hit_is_refused_but_not_counted(cn_tenant):
    """2026-09-25 决定(维持现状):显示名命中只拒绝,不计入词的「近 30 天命中」——
    那个数是给内容命中看的。对照:同一个词在帖子里命中是计数的。"""
    from apps.social.models import SensitiveWordDailyHit

    word = SensitiveWord.objects.create(tenant=cn_tenant, word="违禁词")
    _, client = soul(cn_tenant, "原名")
    for _ in range(3):
        assert _rename(client, "我是违禁词呀").json()["code"] == "display_name_sensitive"
    assert not SensitiveWordDailyHit.objects.filter(word=word).exists()

    res = client.post(f"{SOCIAL}/feed/", {"content": "帖子里的违禁词", "visibility": "PUBLIC"}, format="json")
    assert res.status_code == 201, res.content
    assert SensitiveWordDailyHit.objects.get(word=word).count == 1


def test_a_name_another_current_soul_in_this_civilization_holds_is_refused(cn_tenant, eu_tenant):
    soul(cn_tenant, "Alice")
    me, client = soul(cn_tenant, "原名")
    res = _rename(client, "alice")
    assert res.status_code == 409, res.content
    assert res.json()["code"] == "display_name_taken"
    assert _name_of(me) == "原名"
    # 别的文明同名不算冒名。
    _, eu_client = soul(eu_tenant, "欧")
    assert _rename(eu_client, "ALICE").status_code == 200


def test_keeping_your_own_name_is_not_a_clash(cn_tenant):
    _, client = soul(cn_tenant, "Alice")
    assert _rename(client, "ALICE").status_code == 200


def test_a_retired_accounts_name_is_free_to_take(cn_tenant):
    old, _ = soul(cn_tenant, "旧名")
    SoulAccount.objects.filter(pk=old.pk).update(retired_at=timezone.now())
    _, client = soul(cn_tenant, "原名")
    assert _rename(client, "旧名").status_code == 200


def test_a_muted_soul_cannot_rename(cn_tenant):
    me, client = soul(cn_tenant, "原名")
    SocialMute.objects.create(tenant=cn_tenant, user=me.user, until=timezone.now() + timedelta(days=1))
    res = _rename(client, "新名字")
    assert res.status_code == 403
    assert res.json()["code"] == "muted"
    assert _name_of(me) == "原名"
