"""第四十批 S-a:灵魂「互动消息」与评论 / 回复推送;S-c:朋友圈两个推送开关。

规则(Design 第四十批 三 S-a):评论、回复一条一行并推送;表态、长明灯同一帖同一天合并一行,关注同一天合并一行;
只保留 90 天;打开那一页即全部已读。审核结果(content_*)归「审核结果」开关,警告不归任何开关。
"""
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.social import interactions
from apps.social import soul_circle as circle
from apps.social.models import InteractionKind, ModerationStatus, ReactionType, SocialInteraction, Visibility
from apps.soul_push import services as push
from apps.soul_push.models import PushDelivery, PushPreference
from tests.soul_social_support import SOCIAL, post, soul

pytestmark = pytest.mark.django_db


def rows(account):
    return list(SocialInteraction.objects.filter(recipient=account.user).order_by("created_at"))


def test_a_comment_is_one_row_and_one_push_for_the_post_author(cn_tenant):
    author, _ = soul(cn_tenant, "作者")
    fan, _ = soul(cn_tenant, "粉丝")
    p = post(author, "帖子", Visibility.PUBLIC)

    comment = circle.create_comment(fan.user, p.pk, "第九门我也排过")

    [row] = rows(author)
    assert (row.kind, row.actor_id, row.comment_id, row.read_at) == (InteractionKind.COMMENT, fan.user_id, comment.pk, None)
    [delivery] = PushDelivery.objects.filter(account=author)
    assert delivery.kind == "comment"
    assert delivery.title == "粉丝 评论了你的帖子"
    assert delivery.body == "第九门我也排过"
    assert delivery.data == {"screen": "CirclePost", "post_id": str(p.pk), "comment_id": str(comment.pk), "kind": "comment"}
    assert not rows(fan), "评论的人自己收到了一行"


def test_a_reply_goes_to_the_replied_soul_and_the_post_author_each_once(cn_tenant):
    author, _ = soul(cn_tenant, "作者")
    first, _ = soul(cn_tenant, "甲")
    second, _ = soul(cn_tenant, "乙")
    p = post(author, "帖子", Visibility.PUBLIC)
    parent = circle.create_comment(first.user, p.pk, "先说")

    circle.create_comment(second.user, p.pk, "接着说", parent_id=parent.pk)

    assert [r.kind for r in rows(first)] == [InteractionKind.REPLY]
    assert [r.kind for r in rows(author)] == [InteractionKind.COMMENT, InteractionKind.COMMENT]
    assert PushDelivery.objects.filter(account=first, kind="reply").count() == 1


def test_replying_to_the_post_author_is_one_reply_not_also_a_comment(cn_tenant):
    author, _ = soul(cn_tenant, "作者")
    fan, _ = soul(cn_tenant, "粉丝")
    p = post(author, "帖子", Visibility.PUBLIC)
    mine = circle.create_comment(author.user, p.pk, "作者自己说")

    circle.create_comment(fan.user, p.pk, "回作者", parent_id=mine.pk)

    assert [r.kind for r in rows(author)] == [InteractionKind.REPLY]


def test_a_pending_comment_tells_nobody_until_it_is_approved(cn_tenant, admin_user):
    from apps.social import moderation as mod
    from apps.social.models import SensitiveWord

    author, _ = soul(cn_tenant, "作者")
    fan, _ = soul(cn_tenant, "粉丝")
    p = post(author, "帖子", Visibility.PUBLIC)
    SensitiveWord.objects.create(tenant=cn_tenant, word="待审词")
    comment = circle.create_comment(fan.user, p.pk, "含待审词")
    assert comment.moderation_status == ModerationStatus.PENDING
    assert not rows(author)

    mod.moderate_content(comment, "APPROVE", actor=admin_user)

    assert [r.kind for r in rows(author)] == [InteractionKind.COMMENT]


def test_reactions_on_one_post_in_one_day_merge_and_the_lamp_is_its_own_row(cn_tenant):
    author, _ = soul(cn_tenant, "作者")
    a, _ = soul(cn_tenant, "阿尼")
    b, _ = soul(cn_tenant, "塞内布")
    p = post(author, "帖子", Visibility.PUBLIC)

    circle.toggle_reaction(a.user, p.pk, ReactionType.LIKE)
    circle.toggle_reaction(b.user, p.pk, ReactionType.LOVE)
    circle.toggle_reaction(a.user, p.pk, ReactionType.LIKE)  # 取消:不减人
    circle.toggle_reaction(a.user, p.pk, ReactionType.RESPECT)  # 再点:同一个人不加
    circle.toggle_reaction(b.user, p.pk, ReactionType.ETERNAL_LIGHT)

    reaction, lamp = rows(author)
    assert (reaction.kind, reaction.actor_id, reaction.actor_ids) == (InteractionKind.REACTION, a.user_id, [a.user_id, b.user_id])
    assert (lamp.kind, lamp.actor_ids) == (InteractionKind.LAMP, [b.user_id])
    assert not PushDelivery.objects.filter(account=author).exists(), "表态 / 长明灯只进站内,不推"


def test_a_new_person_on_a_read_row_makes_it_unread_again(cn_tenant):
    author, client = soul(cn_tenant, "作者")
    a, _ = soul(cn_tenant, "甲")
    b, _ = soul(cn_tenant, "乙")
    p = post(author, "帖子", Visibility.PUBLIC)
    circle.toggle_reaction(a.user, p.pk, ReactionType.LIKE)
    assert client.post(f"{SOCIAL}/interactions/read/").status_code == 204
    assert client.get(f"{SOCIAL}/status/").json()["unread_interactions"] == 0

    circle.toggle_reaction(b.user, p.pk, ReactionType.LIKE)

    assert client.get(f"{SOCIAL}/status/").json()["unread_interactions"] == 1


def test_follows_in_one_day_merge_into_one_row(cn_tenant):
    me, _ = soul(cn_tenant, "我")
    a, _ = soul(cn_tenant, "美丽塔")
    b, _ = soul(cn_tenant, "乙")
    circle.follow(a.user, me.user_id)
    circle.follow(b.user, me.user_id)
    circle.unfollow(a.user, me.user_id)
    circle.follow(a.user, me.user_id)

    [row] = rows(me)
    assert (row.kind, row.actor_id, row.actor_ids, row.post_id) == (InteractionKind.FOLLOW, a.user_id, [a.user_id, b.user_id], None)


def test_the_inbox_lists_newest_first_inside_90_days_and_reading_marks_all(cn_tenant):
    me, client = soul(cn_tenant, "我")
    fan, _ = soul(cn_tenant, "粉丝")
    p = post(me, "今天在十二时门排到第九门", Visibility.PUBLIC)
    circle.follow(fan.user, me.user_id)
    circle.create_comment(fan.user, p.pk, "柱子是四十二根")
    old = SocialInteraction.objects.get(recipient=me.user, kind=InteractionKind.FOLLOW)
    SocialInteraction.objects.filter(pk=old.pk).update(last_at=timezone.now() - timedelta(days=91))

    body = client.get(f"{SOCIAL}/interactions/").json()
    assert body["count"] == 1, "90 天外的行还在列表里"
    [row] = body["results"]
    assert row["kind"] == "COMMENT" and row["unread"] is True and row["count"] == 1
    assert row["actor"]["display_name"] == "粉丝" and row["excerpt"] == "柱子是四十二根"
    assert "soul_code" not in row["actor"]

    client.post(f"{SOCIAL}/interactions/read/")
    assert client.get(f"{SOCIAL}/interactions/").json()["results"][0]["unread"] is False


def test_a_deleted_comment_leaves_no_excerpt(cn_tenant):
    me, client = soul(cn_tenant, "我")
    fan, _ = soul(cn_tenant, "粉丝")
    p = post(me, "帖子", Visibility.PUBLIC)
    comment = circle.create_comment(fan.user, p.pk, "要删的")
    circle.delete_own_comment(fan.user, comment.pk)
    rows_ = client.get(f"{SOCIAL}/interactions/").json()["results"]
    assert all(r["excerpt"] != "要删的" for r in rows_)


def test_retention_drops_rows_older_than_90_days(cn_tenant):
    from apps.core.retention import prune_retained_data

    me, _ = soul(cn_tenant, "我")
    a, _ = soul(cn_tenant, "甲")
    b, _ = soul(cn_tenant, "乙")
    circle.follow(a.user, me.user_id)
    keep = SocialInteraction.objects.get(recipient=me.user)
    SocialInteraction.objects.filter(pk=keep.pk).update(last_at=timezone.now() - timedelta(days=89))
    circle.follow(b.user, a.user_id)
    gone = SocialInteraction.objects.get(recipient=a.user)
    SocialInteraction.objects.filter(pk=gone.pk).update(last_at=timezone.now() - timedelta(days=91))

    assert prune_retained_data()["social_interactions"] == 1
    assert list(SocialInteraction.objects.values_list("pk", flat=True)) == [keep.pk]


# ── S-c 推送开关 ─────────────────────────────────────────────────────────


def test_turning_off_comments_and_replies_stops_the_push_but_not_the_inbox(cn_tenant):
    author, client = soul(cn_tenant, "作者")
    fan, _ = soul(cn_tenant, "粉丝")
    p = post(author, "帖子", Visibility.PUBLIC)
    res = client.patch("/api/v1/me/notification-settings/", {"social_comments": False}, format="json")
    assert res.status_code == 200 and res.json()["social_comments"] is False and res.json()["social_review"] is True

    circle.create_comment(fan.user, p.pk, "评论")

    assert rows(author), "关推送不该关掉站内记录"
    assert not PushDelivery.objects.filter(account=author).exists()


def test_review_results_follow_their_switch_and_warnings_follow_none(cn_tenant):
    author, _ = soul(cn_tenant, "作者")
    p = post(author, "帖子", Visibility.PUBLIC)
    PushPreference.objects.create(account=author, soul=author.soul, social_review=False)

    assert push.record_content_moderated(author.user_id, "POST", p.pk, "HIDE", post_id=p.pk) == []
    assert push.KIND_CATEGORY["content_hidden_post"] == "social_review"
    assert push.KIND_CATEGORY["content_deleted_comment_reason"] == "social_review"
    assert push.KIND_CATEGORY["social_warned_post"] is None, "警告不能关"
    assert {push.KIND_CATEGORY["comment"], push.KIND_CATEGORY["reply"]} == {"social_comments"}


def test_a_retired_or_officer_recipient_gets_nothing(cn_tenant, judge_user):
    author, _ = soul(cn_tenant, "作者")
    p = post(author, "帖子", Visibility.PUBLIC)
    interactions.record_follow(author.user, judge_user, cn_tenant)
    assert not SocialInteraction.objects.filter(recipient=judge_user).exists()
    assert not SocialInteraction.objects.filter(post=p).exists()


# ── S-e 落地要的 id ──────────────────────────────────────────────────────


def test_judgment_and_disposition_pushes_carry_the_id_to_highlight(cn_tenant):
    account, _ = soul(cn_tenant, "某")
    rule = push.rule_for("JUDGMENT_CONCLUDED", {"judgment_id": "j-1"}, account)
    assert rule[3] == {"screen": "Life", "judgment_id": "j-1"}
