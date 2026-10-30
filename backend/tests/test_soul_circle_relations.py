"""关系判定(聊天代理 feat/soul-chat 直接调用这几条)、换世后的归属、事件。

`same_civilization` 是**准入判定**,所以测「不该为真」的那几种,而不只是「该为真」的那一种。
(朋友圈自己的互关判定 `are_mutual_followers` 2026-10-30 删了:聊天从来没用它,`apps/chat` 有自己的 `_mutual`。)
"""
from unittest import mock

import pytest

from apps.social import soul_circle as circle
from apps.social.models import Visibility
from apps.soul_accounts import services as svc
from apps.soul_accounts.models import AccountOrigin, SoulAccount
from tests.soul_social_support import SOCIAL, feed_ids, follow, post, soul, soul_client

pytestmark = pytest.mark.django_db


# ── 同文明 ─────────────────────────────────────────────────────────


def test_same_civilization_is_true_only_for_two_current_souls_in_one_tenant(cn_tenant, eu_tenant, judge_user):
    a, _ = soul(cn_tenant, "甲")
    b, _ = soul(cn_tenant, "乙")
    c, _ = soul(eu_tenant, "丙")
    assert circle.same_civilization(a.user, b.user) is True
    assert circle.same_civilization(a.user, c.user) is False, "跨文明"
    assert circle.same_civilization(a.user, judge_user) is False, "官员不在朋友圈里"
    assert circle.same_civilization(a.user, None) is False


# ── 换世 ─────────────────────────────────────────────────────────────────


def _next_life(account):
    """转世:本世账号停用,为同一个灵魂开下一世的账号(另一个 User)。

    不走 `provision_account`:它按 `soul.life_index`(转世记录数)定 cycle,造一条
    Reincarnation 要牵出整条轮回流程。这里要测的是**社交内容归属**,不是开号。
    """
    from django.contrib.auth import get_user_model

    svc.retire_account_for_rebirth(account.soul, account.cycle)
    user = get_user_model().objects.create_user(
        username=f"soul.{account.soul.soul_code}.{account.cycle + 1}", role="SOUL",
        tenant=account.soul.home_tenant, display_name=account.soul.name,
    )
    nxt = SoulAccount.objects.create(
        user=user, soul=account.soul, cycle=account.cycle + 1, previous_account=account,
        origin=AccountOrigin.OFFICER, must_change_password=False,
    )
    return nxt, soul_client(nxt)


def test_a_new_life_starts_the_circle_from_zero(cn_tenant):
    me, _ = soul(cn_tenant, "转世者")
    friend, _ = soul(cn_tenant, "朋友")
    follow(me, friend)
    mine = post(me, "上一世的帖子", Visibility.PUBLIC)
    theirs = post(friend, "只给关注者", Visibility.FOLLOWERS)

    nxt, client = _next_life(me)

    # 关注不继承:新账号看不到朋友的 FOLLOWERS 帖子,也不在 following 列表里。
    assert str(theirs.pk) not in feed_ids(client)
    assert client.get(f"{SOCIAL}/following/").json()["count"] == 0
    # 前世的帖子仍在(对任何人按可见性可见),但不是新账号的。
    seen = client.get(f"{SOCIAL}/posts/{mine.pk}/").json()
    assert seen["is_mine"] is False
    assert seen["author"]["is_active"] is False, "前世作者应标为只读"
    # 新账号不能删前世的帖子。
    assert client.delete(f"{SOCIAL}/posts/{mine.pk}/").status_code == 403
    # 前世账号不可再被关注。
    assert client.post(f"{SOCIAL}/users/{me.user_id}/follow/").status_code == 404


# ── 事件 ─────────────────────────────────────────────────────────────────


def _published(calls):
    return [(c.kwargs["event_type"], c.kwargs["user_ids"]) for c in calls]


def test_interaction_events_are_published_to_the_right_people(cn_tenant, django_capture_on_commit_callbacks):
    author, _ = soul(cn_tenant, "作者")
    fan, _ = soul(cn_tenant, "粉丝")
    row = post(author, "帖子", Visibility.PUBLIC)

    with (
        mock.patch("apps.events.event_bus.event_bus.publish") as publish,
        django_capture_on_commit_callbacks(execute=True),
    ):
        circle.follow(fan.user, author.user_id)
        circle.create_comment(fan.user, row.pk, "评论")
        # 自己评论自己:不通知自己。
        circle.create_comment(author.user, row.pk, "作者回复")

    assert _published(publish.call_args_list) == [
        ("SOCIAL_FOLLOWED", [author.user_id]),
        ("SOCIAL_COMMENTED", [author.user_id]),
    ]
    for call in publish.call_args_list:
        assert call.kwargs["domain"] == "social"
        assert call.kwargs["tenant_code"] == cn_tenant.code
        assert "content" not in call.kwargs["payload"], "事件 payload 带了内容 —— 租户 webhook 也会收到它"


def test_moderation_events_reach_the_author(cn_tenant, admin_user, django_capture_on_commit_callbacks):
    from apps.social import moderation as mod

    author, _ = soul(cn_tenant, "作者")
    row = post(author, "帖子", Visibility.PUBLIC)

    with (
        mock.patch("apps.events.event_bus.event_bus.publish") as publish,
        django_capture_on_commit_callbacks(execute=True),
    ):
        mod.moderate_content(row, "HIDE", actor=admin_user)
        mute = mod.mute_user(author.user, cn_tenant, 3, actor=admin_user)
        mod.lift_mute(mute, actor=admin_user)

    assert _published(publish.call_args_list) == [
        ("SOCIAL_CONTENT_MODERATED", [author.user_id]),
        ("SOCIAL_MUTED", [author.user_id]),
        ("SOCIAL_UNMUTED", [author.user_id]),
    ]


def test_follow_lists_say_both_directions_per_row(cn_tenant):
    """关注 / 被关注列表每行带两个方向,App 据此画回关 / 已关注 / 互相关注。只断言一个方向为真的话,
    把两个字段都写成 True 的实现也是绿的 —— 所以四种组合都列出来。"""
    me, client = soul(cn_tenant, "我")
    mutual, _ = soul(cn_tenant, "互关")
    fan, _ = soul(cn_tenant, "粉")
    idol, _ = soul(cn_tenant, "偶像")
    follow(me, mutual)
    follow(mutual, me)
    follow(fan, me)
    follow(me, idol)

    def rows(path):
        return {r["display_name"]: (r["is_following"], r["is_followed_by"]) for r in client.get(f"{SOCIAL}/{path}/").json()["results"]}

    assert rows("followers") == {"互关": (True, True), "粉": (False, True)}
    assert rows("following") == {"互关": (True, True), "偶像": (True, False)}
