"""审核后台三区的后端(feat/moderation-backend):敏感词的三种动作与命中计数、批量删词、
禁言的执行人与解除、「已处理」列表与恢复可见。

租户隔离一律用 **MODERATOR**,不用 `admin_user`:ADMIN 是唯一跨租户的角色
(apps/core/tenant.py::is_tenant_exempt),拿它测隔离测到的是豁免。
"""
from datetime import timedelta
from unittest import mock

import pytest
from django.utils import timezone

from apps.audit.models import AuditLog
from apps.social import moderation as mod
from apps.social.models import (
    Comment,
    ModerationStatus,
    Post,
    SensitiveWord,
    SensitiveWordAction,
    SensitiveWordDailyHit,
    Visibility,
)
from tests.soul_social_support import MODERATION, SOCIAL, feed_ids, officer_client, post, soul

pytestmark = pytest.mark.django_db


@pytest.fixture
def cn_moderator(db, django_user_model, cn_tenant):
    return django_user_model.objects.create(
        username="cn_moderator", role="MODERATOR", tenant=cn_tenant, display_name="地府审核官"
    )


@pytest.fixture
def eu_moderator(db, django_user_model, eu_tenant):
    return django_user_model.objects.create(username="eu_moderator", role="MODERATOR", tenant=eu_tenant)


def word(tenant, text, action=SensitiveWordAction.REVIEW, **fields):
    return SensitiveWord.objects.create(tenant=tenant, word=text, action=action, **fields)


def publish(client, content):
    res = client.post(f"{SOCIAL}/feed/", {"content": content, "visibility": "PUBLIC"}, format="json")
    assert res.status_code == 201, res.content
    return Post.objects.get(pk=res.json()["id"])


# ── 敏感词动作 ───────────────────────────────────────────────────────────


def test_review_sends_the_post_to_the_pending_queue_unchanged(cn_tenant, cn_moderator):
    word(cn_tenant, "违禁词", SensitiveWordAction.REVIEW)
    _, client = soul(cn_tenant, "作者")
    _, reader = soul(cn_tenant, "读者")

    row = publish(client, "这里有违禁词啊")

    assert row.moderation_status == ModerationStatus.PENDING
    assert row.content == "这里有违禁词啊", "REVIEW 不该改动内容"
    assert row.moderated_at is None, "送审不是处理完毕,不该进「已处理」"
    assert str(row.pk) not in feed_ids(reader)
    queue = officer_client(cn_moderator).get(f"{MODERATION}/posts/").json()["results"]
    assert str(row.pk) in {r["id"] for r in queue}


def test_hide_hides_the_post_at_write_time_and_lists_it_as_handled_by_the_system(cn_tenant, cn_moderator):
    word(cn_tenant, "隐藏词", SensitiveWordAction.HIDE)
    _, client = soul(cn_tenant, "作者")
    _, reader = soul(cn_tenant, "读者")

    row = publish(client, "一句带隐藏词的话")

    assert row.moderation_status == ModerationStatus.HIDDEN
    assert row.content == "一句带隐藏词的话"
    assert row.moderated_by is None and row.moderated_at is not None
    assert row.moderation_reason == "sensitive_word:隐藏词"
    assert str(row.pk) not in feed_ids(reader), "HIDE 命中的帖子别人还看得见"
    assert str(row.pk) in feed_ids(client), "作者本人应看得见自己被隐藏的帖子(带状态)"
    # 不在待审队列里 —— 它已经处理过了。
    queue = officer_client(cn_moderator).get(f"{MODERATION}/posts/").json()["results"]
    assert str(row.pk) not in {r["id"] for r in queue}
    handled = officer_client(cn_moderator).get(f"{MODERATION}/handled/").json()["results"]
    assert [(r["id"], r["handling"], r["handled_by"]) for r in handled] == [(str(row.pk), "HIDDEN", None)]


def test_mask_replaces_every_hit_with_stars_and_publishes(cn_tenant):
    word(cn_tenant, "badword", SensitiveWordAction.MASK)
    word(cn_tenant, "脏话", SensitiveWordAction.MASK)
    _, client = soul(cn_tenant, "作者")
    _, reader = soul(cn_tenant, "读者")

    row = publish(client, "前 BadWord 中 脏话脏话 后 badwordX")

    assert row.moderation_status == ModerationStatus.PUBLISHED
    assert row.content == "前 *** 中 *** 后 ***X"
    # 断言缺席:原词一个都不剩(不分大小写)。
    assert "badword" not in row.content.lower() and "脏话" not in row.content
    assert str(row.pk) in feed_ids(reader)


def test_mask_applies_to_comments_too(cn_tenant):
    word(cn_tenant, "脏话", SensitiveWordAction.MASK)
    author, _ = soul(cn_tenant, "作者")
    _, client = soul(cn_tenant, "评论者")
    target = post(author, "干净的帖子", Visibility.PUBLIC)

    res = client.post(f"{SOCIAL}/posts/{target.pk}/comments/", {"content": "你这脏话"}, format="json")

    assert res.status_code == 201, res.content
    comment = Comment.objects.get(pk=res.json()["id"])
    assert comment.content == "你这***"
    assert comment.moderation_status == ModerationStatus.PUBLISHED


def test_hide_applies_to_comments_too(cn_tenant):
    word(cn_tenant, "隐藏词", SensitiveWordAction.HIDE)
    author, _ = soul(cn_tenant, "作者")
    _, client = soul(cn_tenant, "评论者")
    target = post(author, "干净的帖子", Visibility.PUBLIC)

    res = client.post(f"{SOCIAL}/posts/{target.pk}/comments/", {"content": "隐藏词在此"}, format="json")

    comment = Comment.objects.get(pk=res.json()["id"])
    assert comment.moderation_status == ModerationStatus.HIDDEN
    assert comment.moderation_reason == "sensitive_word:隐藏词"


@pytest.mark.parametrize(
    "actions, expected",
    [
        ((SensitiveWordAction.MASK, SensitiveWordAction.REVIEW), ModerationStatus.PENDING),
        ((SensitiveWordAction.MASK, SensitiveWordAction.HIDE), ModerationStatus.HIDDEN),
        ((SensitiveWordAction.REVIEW, SensitiveWordAction.HIDE), ModerationStatus.HIDDEN),
    ],
)
def test_the_heaviest_action_wins_and_mask_words_are_still_masked(cn_tenant, actions, expected):
    word(cn_tenant, "甲词", actions[0])
    word(cn_tenant, "乙词", actions[1])
    _, client = soul(cn_tenant, "作者")

    row = publish(client, "甲词与乙词")

    assert row.moderation_status == expected
    if SensitiveWordAction.MASK in actions:
        assert "甲词" not in row.content
    assert "乙词" in row.content, "只有 MASK 的词被替换"


def test_overlapping_mask_words_collapse_into_one_mask():
    assert mod.mask_words("abcdef", ["bcd", "cde"]) == "a***f"
    assert mod.mask_words("no hit here", ["zzz"]) == "no hit here"


def test_a_clean_post_is_untouched(cn_tenant):
    word(cn_tenant, "隐藏词", SensitiveWordAction.HIDE)
    _, client = soul(cn_tenant, "作者")
    row = publish(client, "今天天气不错")
    assert (row.moderation_status, row.content, row.moderated_at) == (ModerationStatus.PUBLISHED, "今天天气不错", None)
    assert SensitiveWordDailyHit.objects.count() == 0


# ── 命中计数 ─────────────────────────────────────────────────────────────


def test_hits_are_counted_per_word_and_read_as_a_30_day_sum(cn_tenant, cn_moderator):
    counted = word(cn_tenant, "计数词", SensitiveWordAction.MASK)
    idle = word(cn_tenant, "闲词")
    _, client = soul(cn_tenant, "作者")

    publish(client, "计数词")
    publish(client, "计数词,又一个计数词")  # 一条内容里出现两次只算一次
    target = post(soul(cn_tenant, "楼主")[0], "帖子", Visibility.PUBLIC)
    client.post(f"{SOCIAL}/posts/{target.pk}/comments/", {"content": "评论里的计数词"}, format="json")
    # 30 天窗口外的旧桶不计。
    SensitiveWordDailyHit.objects.create(word=counted, day=timezone.now().date() - timedelta(days=30), count=50)
    # 窗口最早的一天(29 天前)计入。
    SensitiveWordDailyHit.objects.create(word=counted, day=timezone.now().date() - timedelta(days=29), count=4)

    rows = {r["word"]: r["hits_30d"] for r in officer_client(cn_moderator).get(f"{MODERATION}/sensitive-words/").json()["results"]}
    assert rows == {"计数词": 3 + 4, "闲词": 0}
    assert SensitiveWordDailyHit.objects.get(word=counted, day=timezone.now().date()).count == 3
    assert not SensitiveWordDailyHit.objects.filter(word=idle).exists()


def test_a_bucket_that_appears_between_update_and_insert_is_incremented_not_duplicated(cn_tenant):
    """record_hits 的竞态分支:UPDATE 时还没有今天的桶(这里让第一次 UPDATE 答 0 行),
    INSERT 时另一个请求已经建好了 —— 撞唯一约束,回滚保存点,再 UPDATE 一次。"""
    from django.db.models import QuerySet

    row = word(cn_tenant, "计数词")
    today = timezone.now().date()
    SensitiveWordDailyHit.objects.create(word=row, day=today, count=1)  # 「另一个请求」建的
    real_update, calls = QuerySet.update, []

    def first_update_misses(qs, **kwargs):
        calls.append(qs.model)
        if qs.model is SensitiveWordDailyHit and len(calls) == 1:
            return 0
        return real_update(qs, **kwargs)

    with mock.patch.object(QuerySet, "update", first_update_misses):
        mod.record_hits([row.pk])

    assert len(calls) == 2, "没有走到「INSERT 撞约束 → 再 UPDATE」这条分支"
    assert SensitiveWordDailyHit.objects.get(word=row, day=today).count == 2


def test_the_word_list_does_not_show_another_civilizations_hits(cn_tenant, eu_tenant, eu_moderator):
    word(cn_tenant, "计数词")
    _, client = soul(cn_tenant, "作者")
    publish(client, "计数词")

    res = officer_client(eu_moderator).get(f"{MODERATION}/sensitive-words/")
    assert res.status_code == 200
    assert res.json()["results"] == []


def test_a_word_is_created_with_category_and_action(cn_tenant, cn_moderator):
    client = officer_client(cn_moderator)
    res = client.post(
        f"{MODERATION}/sensitive-words/", {"word": "某词", "category": "PRIVACY", "action": "MASK"}, format="json"
    )
    assert res.status_code == 201, res.content
    body = res.json()
    assert (body["category"], body["action"], body["hits_30d"]) == ("PRIVACY", "MASK", 0)
    assert body["created_by"]["user_id"] == cn_moderator.pk
    # 不给就是未分类 + 送审(0007 之前的行为)。
    plain = client.post(f"{MODERATION}/sensitive-words/", {"word": "另一词"}, format="json").json()
    assert (plain["category"], plain["action"]) == ("", "REVIEW")
    bad = client.post(f"{MODERATION}/sensitive-words/", {"word": "三词", "category": "隐私"}, format="json")
    assert bad.status_code == 400, "分类存的是枚举成员,中文名在 i18n 包里"


# ── 批量删词 ─────────────────────────────────────────────────────────────


def test_batch_delete_removes_every_word_and_audits_each(cn_tenant, cn_moderator):
    rows = [word(cn_tenant, f"词{i}") for i in range(3)]
    keep = word(cn_tenant, "留下")

    res = officer_client(cn_moderator).post(
        f"{MODERATION}/sensitive-words/batch-delete/", {"ids": [str(r.pk) for r in rows]}, format="json"
    )

    assert res.status_code == 200, res.content
    assert res.json() == {"deleted": 3}
    assert list(SensitiveWord.objects.values_list("word", flat=True)) == [keep.word]
    for row in rows:
        assert AuditLog.objects.filter(resource="social_moderation", resource_id=str(row.pk), action="DELETE").count() == 1


def test_batch_delete_is_all_or_nothing_across_civilizations(cn_tenant, eu_tenant, eu_moderator):
    """一个 id 属于别的文明 → 整批 404,自己文明的那条也不删。"""
    mine = word(eu_tenant, "天堂的词")
    theirs = word(cn_tenant, "地府的词")

    res = officer_client(eu_moderator).post(
        f"{MODERATION}/sensitive-words/batch-delete/", {"ids": [str(mine.pk), str(theirs.pk)]}, format="json"
    )

    assert res.status_code == 404, res.content
    assert res.json()["missing"] == [str(theirs.pk)]
    assert SensitiveWord.objects.filter(pk__in=[mine.pk, theirs.pk]).count() == 2, "删了一半"


def test_batch_delete_limits(cn_tenant, cn_moderator, judge_user):
    client = officer_client(cn_moderator)
    too_many = [str(word(cn_tenant, f"词{i}").pk) for i in range(201)]
    assert client.post(f"{MODERATION}/sensitive-words/batch-delete/", {"ids": too_many}, format="json").status_code == 400
    assert client.post(f"{MODERATION}/sensitive-words/batch-delete/", {"ids": []}, format="json").status_code == 400
    assert SensitiveWord.objects.count() == 201
    # 同单条删除的码名:JUDGE 不持有 social.moderate。
    denied = officer_client(judge_user).post(
        f"{MODERATION}/sensitive-words/batch-delete/", {"ids": too_many[:1]}, format="json"
    )
    assert denied.status_code == 403
    assert SensitiveWord.objects.count() == 201


def test_deleting_a_word_takes_its_hit_buckets_with_it(cn_tenant, cn_moderator):
    row = word(cn_tenant, "计数词")
    mod.record_hits([row.pk])
    officer_client(cn_moderator).post(f"{MODERATION}/sensitive-words/batch-delete/", {"ids": [str(row.pk)]}, format="json")
    assert SensitiveWordDailyHit.objects.count() == 0


# ── 禁言 ─────────────────────────────────────────────────────────────────


def test_mutes_show_start_end_reason_and_executor(cn_tenant, cn_moderator):
    target, _ = soul(cn_tenant, "被禁言的")
    client = officer_client(cn_moderator)
    created = client.post(
        f"{MODERATION}/mutes/", {"user_id": target.user_id, "days": 3, "reason": "辱骂"}, format="json"
    )
    assert created.status_code == 201, created.content

    row = client.get(f"{MODERATION}/mutes/").json()["results"][0]
    assert row["created_by"] == {"user_id": cn_moderator.pk, "display_name": "地府审核官"}
    assert row["reason"] == "辱骂" and row["created_at"] and row["until"]
    assert row["lifted_at"] is None and row["lifted_by"] is None and row["is_active"] is True


def test_lifting_a_mute_records_who_and_notifies_the_soul(cn_tenant, cn_moderator, django_capture_on_commit_callbacks):
    target, target_client = soul(cn_tenant, "被禁言的")
    mute = mod.mute_user(target.user, cn_tenant, 3, actor=cn_moderator)

    with (
        mock.patch("apps.events.event_bus.event_bus.publish") as published,
        django_capture_on_commit_callbacks(execute=True),
    ):
        res = officer_client(cn_moderator).post(f"{MODERATION}/mutes/{mute.pk}/lift/", {}, format="json")

    assert res.status_code == 200, res.content
    assert res.json()["lifted_by"]["user_id"] == cn_moderator.pk and res.json()["is_active"] is False
    assert [(c.kwargs["event_type"], c.kwargs["user_ids"]) for c in published.call_args_list] == [
        ("SOCIAL_UNMUTED", [target.user_id])
    ]
    assert target_client.post(f"{SOCIAL}/feed/", {"content": "能说话了"}, format="json").status_code == 201
    again = officer_client(cn_moderator).post(f"{MODERATION}/mutes/{mute.pk}/lift/", {}, format="json")
    assert again.status_code == 409 and again.json()["code"] == "already_lifted"


def test_an_officer_cannot_lift_another_civilizations_mute(cn_tenant, cn_moderator, eu_moderator):
    target, _ = soul(cn_tenant, "被禁言的")
    mute = mod.mute_user(target.user, cn_tenant, 3, actor=cn_moderator)

    assert officer_client(eu_moderator).get(f"{MODERATION}/mutes/").json()["results"] == []
    res = officer_client(eu_moderator).post(f"{MODERATION}/mutes/{mute.pk}/lift/", {}, format="json")
    assert res.status_code == 404, res.content
    mute.refresh_from_db()
    assert mute.lifted_at is None


# ── 已处理 与 恢复可见 ────────────────────────────────────────────────────


def _handled(client, **params):
    res = client.get(f"{MODERATION}/handled/", params)
    assert res.status_code == 200, res.content
    return res.json()["results"]


def test_handled_lists_hidden_and_officer_deleted_content_only(cn_tenant, cn_moderator, django_user_model):
    author, author_client = soul(cn_tenant, "作者")
    hidden = post(author, "被隐藏的帖子", Visibility.PUBLIC)
    deleted = post(author, "被删除的帖子" + "长" * 300, Visibility.PUBLIC)
    self_deleted = post(author, "作者自己删的", Visibility.PUBLIC)
    live = post(author, "正常的帖子", Visibility.PUBLIC)
    pending = post(author, "待审的帖子", Visibility.PUBLIC)
    Post.objects.filter(pk=pending.pk).update(moderation_status=ModerationStatus.PENDING)
    _, commenter = soul(cn_tenant, "评论者")
    commenter.post(f"{SOCIAL}/posts/{live.pk}/comments/", {"content": "要被隐藏的评论"}, format="json")
    comment = Comment.objects.get(content="要被隐藏的评论")

    mod.moderate_content(hidden, "HIDE", actor=cn_moderator, reason="低俗")
    mod.moderate_content(deleted, "DELETE", actor=cn_moderator, reason="违规")
    mod.moderate_content(comment, "HIDE", actor=cn_moderator, reason="辱骂")
    assert author_client.delete(f"{SOCIAL}/posts/{self_deleted.pk}/").status_code == 204

    rows = {r["id"]: r for r in _handled(officer_client(cn_moderator))}

    assert set(rows) == {str(hidden.pk), str(deleted.pk), str(comment.pk)}, "作者自删 / 正常 / 待审的混进来了"
    officer = {"user_id": cn_moderator.pk, "display_name": "地府审核官"}
    h = rows[str(hidden.pk)]
    assert (h["type"], h["handling"], h["reason"], h["handled_by"], h["post"]) == (
        "POST", "HIDDEN", "低俗", officer, str(hidden.pk)
    )
    assert h["author"] == {"user_id": author.user_id, "display_name": author.user.display_name}
    assert h["excerpt"] == "被隐藏的帖子" and h["handled_at"]
    d = rows[str(deleted.pk)]
    assert (d["handling"], d["reason"], d["handled_by"]) == ("DELETED", "违规", officer)
    assert len(d["excerpt"]) == 200
    c = rows[str(comment.pk)]
    assert (c["type"], c["handling"], c["post"]) == ("COMMENT", "HIDDEN", str(live.pk))

    assert {r["id"] for r in _handled(officer_client(cn_moderator), type="COMMENT")} == {str(comment.pk)}
    assert {r["id"] for r in _handled(officer_client(cn_moderator), handling="DELETED")} == {str(deleted.pk)}
    assert _handled(officer_client(cn_moderator), handling="BOGUS") == []


def test_handled_is_newest_first(cn_tenant, cn_moderator):
    author, _ = soul(cn_tenant, "作者")
    older, newer = post(author, "早", Visibility.PUBLIC), post(author, "晚", Visibility.PUBLIC)
    mod.moderate_content(older, "HIDE", actor=cn_moderator)
    mod.moderate_content(newer, "DELETE", actor=cn_moderator)
    Post.objects.filter(pk=older.pk).update(moderated_at=timezone.now() - timedelta(days=1))
    assert [r["id"] for r in _handled(officer_client(cn_moderator))] == [str(newer.pk), str(older.pk)]


def test_handled_does_not_leak_across_civilizations(cn_tenant, cn_moderator, eu_moderator, eu_tenant):
    cn_author, _ = soul(cn_tenant, "地府作者")
    eu_author, _ = soul(eu_tenant, "天堂作者")
    cn_post, eu_post = post(cn_author, "地府的", Visibility.PUBLIC), post(eu_author, "天堂的", Visibility.PUBLIC)
    mod.moderate_content(cn_post, "HIDE", actor=cn_moderator)
    mod.moderate_content(eu_post, "DELETE", actor=eu_moderator)

    assert {r["id"] for r in _handled(officer_client(eu_moderator))} == {str(eu_post.pk)}
    assert {r["id"] for r in _handled(officer_client(cn_moderator))} == {str(cn_post.pk)}


def test_handled_needs_social_moderate(cn_tenant, judge_user, cn_moderator):
    assert officer_client(judge_user).get(f"{MODERATION}/handled/").status_code == 403
    assert officer_client(cn_moderator).get(f"{MODERATION}/handled/").status_code == 200


def test_restore_visible_brings_a_hidden_post_back_and_out_of_handled(cn_tenant, cn_moderator):
    word(cn_tenant, "隐藏词", SensitiveWordAction.HIDE)
    _, client = soul(cn_tenant, "作者")
    _, reader = soul(cn_tenant, "读者")
    row = publish(client, "隐藏词")
    officer = officer_client(cn_moderator)

    res = officer.post(f"{MODERATION}/posts/{row.pk}/restore/", {"reason": "误伤"}, format="json")

    assert res.status_code == 200, res.content
    row.refresh_from_db()
    assert row.moderation_status == ModerationStatus.PUBLISHED
    assert (row.moderated_by_id, row.moderation_reason) == (cn_moderator.pk, "误伤")
    assert str(row.pk) in feed_ids(reader)
    assert _handled(officer) == []


def test_restore_visible_does_not_reach_deleted_content_or_other_civilizations(
    cn_tenant, cn_moderator, eu_moderator
):
    author, _ = soul(cn_tenant, "作者")
    deleted, hidden = post(author, "删", Visibility.PUBLIC), post(author, "藏", Visibility.PUBLIC)
    mod.moderate_content(deleted, "DELETE", actor=cn_moderator)
    mod.moderate_content(hidden, "HIDE", actor=cn_moderator)

    # 删除的内容没有第二条恢复路径 —— 走回收站的规则。
    assert officer_client(cn_moderator).post(f"{MODERATION}/posts/{deleted.pk}/restore/", {}, format="json").status_code == 404
    assert Post.all_objects.get(pk=deleted.pk).is_deleted
    # 别的文明的官员恢复不了。
    assert officer_client(eu_moderator).post(f"{MODERATION}/posts/{hidden.pk}/restore/", {}, format="json").status_code == 404
    hidden.refresh_from_db()
    assert hidden.moderation_status == ModerationStatus.HIDDEN
