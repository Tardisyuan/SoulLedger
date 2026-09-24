"""关系判定(聊天代理 feat/soul-chat 直接调用这几条)、换世后的归属、事件。

`are_mutual_followers` / `same_civilization` 是**准入判定**:聊天用它们决定两个灵魂
能不能说话。所以每条都测「不该为真」的那几种,而不只是「该为真」的那一种。
"""
from unittest import mock

import pytest
from django.utils import timezone

from apps.social import soul_circle as circle
from apps.social.models import Follow, Visibility
from apps.soul_accounts import services as svc
from apps.soul_accounts.models import AccountOrigin, SoulAccount
from tests.soul_social_support import SOCIAL, feed_ids, follow, post, soul, soul_client

pytestmark = pytest.mark.django_db


# ── 同文明 / 互关 ─────────────────────────────────────────────────────────


def test_same_civilization_is_true_only_for_two_current_souls_in_one_tenant(cn_tenant, eu_tenant, judge_user):
    a, _ = soul(cn_tenant, "甲")
    b, _ = soul(cn_tenant, "乙")
    c, _ = soul(eu_tenant, "丙")
    assert circle.same_civilization(a.user, b.user) is True
    assert circle.same_civilization(a.user, c.user) is False, "跨文明"
    assert circle.same_civilization(a.user, judge_user) is False, "官员不在朋友圈里"
    assert circle.same_civilization(a.user, None) is False


def test_mutual_follow_needs_both_edges(cn_tenant):
    a, _ = soul(cn_tenant, "甲")
    b, _ = soul(cn_tenant, "乙")
    assert circle.are_mutual_followers(a.user, b.user) is False
    follow(a, b)
    assert circle.are_mutual_followers(a.user, b.user) is False, "单向关注被当成了互关"
    follow(b, a)
    assert circle.are_mutual_followers(a.user, b.user) is True
    assert circle.are_mutual_followers(b.user, a.user) is True, "互关不对称"
    assert circle.are_mutual_followers(a.user, a.user) is False, "自己和自己"


def test_mutual_follow_does_not_survive_a_move_to_another_civilization(cn_tenant, eu_tenant):
    """两人在地府互关,之后乙被调拨去天堂暂居:关注边还在库里,但按「当前所在」
    两人不再同文明,于是不再互关 —— 聊天也就不再准入。回到地府后恢复。"""
    a, _ = soul(cn_tenant, "甲")
    b, _ = soul(cn_tenant, "乙")
    follow(a, b)
    follow(b, a)
    assert circle.are_mutual_followers(a.user, b.user) is True

    type(b.soul).all_objects.filter(pk=b.soul_id).update(tenant=eu_tenant)
    b.user.refresh_from_db()
    b.user.soul_account.soul.refresh_from_db()
    assert Follow.objects.filter(follower=a.user, following=b.user).exists(), "前提:边还在"
    assert circle.are_mutual_followers(a.user, b.user) is False, "跨文明后仍被判为互关"

    type(b.soul).all_objects.filter(pk=b.soul_id).update(tenant=cn_tenant)
    b.user.soul_account.soul.refresh_from_db()
    assert circle.are_mutual_followers(a.user, b.user) is True


def test_a_retired_account_is_nobodys_mutual(cn_tenant):
    a, _ = soul(cn_tenant, "甲")
    b, _ = soul(cn_tenant, "乙")
    follow(a, b)
    follow(b, a)
    SoulAccount.objects.filter(pk=b.pk).update(retired_at=timezone.now())
    b.user.soul_account.refresh_from_db()
    assert circle.are_mutual_followers(a.user, b.user) is False


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
