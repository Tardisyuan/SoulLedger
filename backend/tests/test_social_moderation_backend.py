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
    Report,
    SensitiveWord,
    SensitiveWordAction,
    SensitiveWordDailyHit,
    SocialMute,
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


def test_a_review_hit_records_which_word_sent_it_to_review(cn_tenant, cn_moderator):
    """2026-09-25 决定:送审也记原因,写法与 HIDE 同一个前缀 `sensitive_word:<词>`。"""
    word(cn_tenant, "违禁词", SensitiveWordAction.REVIEW)
    word(cn_tenant, "脏话", SensitiveWordAction.MASK)
    author, client = soul(cn_tenant, "作者")

    row = publish(client, "脏话和违禁词")
    assert (row.moderation_status, row.moderation_reason) == (ModerationStatus.PENDING, "sensitive_word:违禁词")
    assert row.moderated_at is None
    queue = officer_client(cn_moderator).get(f"{MODERATION}/posts/").json()["results"]
    assert {r["id"]: r["moderation_reason"] for r in queue}[str(row.pk)] == "sensitive_word:违禁词"
    # Not in 「已处理」: a reason is not a decision.
    handled = officer_client(cn_moderator).get(f"{MODERATION}/handled/").json()["results"]
    assert str(row.pk) not in {r["id"] for r in handled}

    target = post(author, "干净的帖子", Visibility.PUBLIC)
    res = client.post(f"{SOCIAL}/posts/{target.pk}/comments/", {"content": "违禁词在此"}, format="json")
    comment = Comment.objects.get(pk=res.json()["id"])
    assert (comment.moderation_status, comment.moderation_reason) == (ModerationStatus.PENDING, "sensitive_word:违禁词")

    # MASK alone publishes with no reason: nothing is waiting on anyone.
    masked = publish(client, "只有脏话")
    assert (masked.moderation_status, masked.moderation_reason) == (ModerationStatus.PUBLISHED, "")


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
    # 动作不给就是送审(0007 之前的行为)。
    plain = client.post(f"{MODERATION}/sensitive-words/", {"word": "另一词", "category": "ABUSE"}, format="json").json()
    assert (plain["category"], plain["action"]) == ("ABUSE", "REVIEW")
    bad = client.post(f"{MODERATION}/sensitive-words/", {"word": "三词", "category": "隐私"}, format="json")
    assert bad.status_code == 400, "分类存的是枚举成员,中文名在 i18n 包里"


def test_a_new_word_must_name_its_category_and_old_ones_stay_uncategorised(cn_tenant, cn_moderator):
    """2026-09-25 决定:新建必须带类别;之前加的词保持未分类,列表照常返回空串。"""
    client = officer_client(cn_moderator)
    for body in ({"word": "无类"}, {"word": "无类", "category": ""}):
        res = client.post(f"{MODERATION}/sensitive-words/", body, format="json")
        assert res.status_code == 400 and "category" in res.json(), (body, res.content)
    assert not SensitiveWord.objects.filter(tenant=cn_tenant, word="无类").exists()

    SensitiveWord.objects.create(tenant=cn_tenant, word="旧词")  # 0007 之前的词:未分类
    rows = {r["word"]: r["category"] for r in client.get(f"{MODERATION}/sensitive-words/").json()["results"]}
    assert rows["旧词"] == ""


# ── 改词 ─────────────────────────────────────────────────────────────────


def test_editing_a_word_changes_only_what_is_given_and_audits_the_diff(cn_tenant, cn_moderator):
    row = word(cn_tenant, "旧词", SensitiveWordAction.REVIEW, category="PRIVACY")
    mod.record_hits([row.pk])
    client = officer_client(cn_moderator)

    res = client.patch(f"{MODERATION}/sensitive-words/{row.pk}/", {"category": "ABUSE", "action": "HIDE"}, format="json")
    assert res.status_code == 200, res.content
    assert (res.json()["word"], res.json()["category"], res.json()["action"], res.json()["hits_30d"]) == (
        "旧词", "ABUSE", "HIDE", 1
    )
    logged = AuditLog.objects.get(resource="social_moderation", resource_id=str(row.pk), action="UPDATE")
    assert logged.changes == {"category": ["PRIVACY", "ABUSE"], "action": ["REVIEW", "HIDE"]}
    assert logged.user_id == cn_moderator.pk

    # 词本身:与新建同一套规范化;旧词的命中不再算在新词头上。
    res = client.patch(f"{MODERATION}/sensitive-words/{row.pk}/", {"category": "ABUSE", "word": "  新词X "}, format="json")
    assert res.status_code == 200, res.content
    assert (res.json()["word"], res.json()["action"], res.json()["hits_30d"]) == ("新词x", "HIDE", 0)
    assert not SensitiveWordDailyHit.objects.filter(word=row).exists()


def test_editing_a_word_keeps_creates_rules(cn_tenant, cn_moderator):
    row = word(cn_tenant, "某词", category="PRIVACY")
    word(cn_tenant, "已有")
    client = officer_client(cn_moderator)
    url = f"{MODERATION}/sensitive-words/{row.pk}/"

    for body in ({"action": "HIDE"}, {"category": "", "action": "HIDE"}, {"category": "隐私"}):
        res = client.patch(url, body, format="json")
        assert res.status_code == 400 and "category" in res.json(), (body, res.content)
    blank = client.patch(url, {"category": "ABUSE", "word": "   "}, format="json")
    assert blank.status_code == 400 and blank.json()["code"] == "invalid_word"
    dup = client.patch(url, {"category": "ABUSE", "word": "已有"}, format="json")
    assert dup.status_code == 409 and dup.json()["code"] == "duplicate_word"
    assert client.put(url, {"category": "ABUSE"}, format="json").status_code == 405

    row.refresh_from_db()
    assert (row.word, row.category, row.action) == ("某词", "PRIVACY", "REVIEW")
    # 被拒的那几次都没写审计:之后一次成功的修改是这一行唯一的审计记录。
    assert client.patch(url, {"category": "ABUSE"}, format="json").status_code == 200
    logged = AuditLog.objects.filter(resource="social_moderation", resource_id=str(row.pk))
    assert [entry.changes for entry in logged] == [{"category": ["PRIVACY", "ABUSE"]}]


def test_editing_a_word_is_tenant_scoped_and_needs_social_moderate(cn_tenant, eu_moderator, judge_user):
    row = word(cn_tenant, "地府的词", category="PRIVACY")
    url = f"{MODERATION}/sensitive-words/{row.pk}/"
    assert officer_client(eu_moderator).patch(url, {"category": "ABUSE"}, format="json").status_code == 404
    assert officer_client(judge_user).patch(url, {"category": "ABUSE"}, format="json").status_code == 403
    row.refresh_from_db()
    assert row.category == "PRIVACY"


def test_batch_update_changes_every_action_and_audits_each(cn_tenant, cn_moderator):
    rows = [word(cn_tenant, f"词{i}", category="PRIVACY") for i in range(3)]
    keep = word(cn_tenant, "留下")

    res = officer_client(cn_moderator).post(
        f"{MODERATION}/sensitive-words/batch-update/", {"ids": [str(r.pk) for r in rows], "action": "MASK"}, format="json"
    )

    assert res.status_code == 200, res.content
    assert res.json() == {"updated": 3}
    assert set(SensitiveWord.objects.filter(action="MASK").values_list("pk", flat=True)) == {r.pk for r in rows}
    keep.refresh_from_db()
    assert keep.action == SensitiveWordAction.REVIEW
    for row in rows:
        logged = AuditLog.objects.get(resource="social_moderation", resource_id=str(row.pk), action="UPDATE")
        assert logged.changes == {"action": ["REVIEW", "MASK"]}


def test_batch_update_is_all_or_nothing_across_civilizations(cn_tenant, eu_tenant, eu_moderator, judge_user):
    mine = word(eu_tenant, "天堂的词")
    theirs = word(cn_tenant, "地府的词")
    url = f"{MODERATION}/sensitive-words/batch-update/"

    res = officer_client(eu_moderator).post(url, {"ids": [str(mine.pk), str(theirs.pk)], "action": "HIDE"}, format="json")

    assert res.status_code == 404, res.content
    assert res.json()["missing"] == [str(theirs.pk)]
    assert set(SensitiveWord.objects.values_list("action", flat=True)) == {"REVIEW"}, "改了一半"
    client = officer_client(eu_moderator)
    assert client.post(url, {"ids": [], "action": "HIDE"}, format="json").status_code == 400
    assert client.post(url, {"ids": [str(mine.pk)]}, format="json").status_code == 400
    assert officer_client(judge_user).post(url, {"ids": [str(theirs.pk)], "action": "HIDE"}, format="json").status_code == 403
    # 被拒的那几次都没写审计:之后一次成功的批量是唯一的审计记录。
    assert client.post(url, {"ids": [str(mine.pk)], "action": "HIDE"}, format="json").status_code == 200
    logged = AuditLog.objects.filter(resource="social_moderation")
    assert [(entry.resource_id, entry.changes) for entry in logged] == [(str(mine.pk), {"action": ["REVIEW", "HIDE"]})]


# ── 从其他文明复制词表(ADMIN)──────────────────────────────────────────────

COPY = f"{MODERATION}/sensitive-words/copy-from/"


def test_admin_copies_another_civilizations_words_skipping_duplicates(cn_tenant, eu_tenant, eu_admin_user):
    word(cn_tenant, "还阳", SensitiveWordAction.HIDE, category="INDUCEMENT")
    word(cn_tenant, "门牌号", SensitiveWordAction.MASK, category="PRIVACY")
    counted = word(cn_tenant, "已有", SensitiveWordAction.HIDE, category="ABUSE")
    mod.record_hits([counted.pk])
    kept = word(eu_tenant, "已有", SensitiveWordAction.REVIEW, category="PRIVACY")

    res = officer_client(eu_admin_user).post(COPY, {"source_tenant": "CN_DIYU"}, format="json")

    assert res.status_code == 200, res.content
    assert res.json() == {"copied": 2, "skipped": 1}
    rows = {w.word: (w.category, w.action, w.created_by_id) for w in SensitiveWord.objects.filter(tenant=eu_tenant)}
    assert rows == {
        "还阳": ("INDUCEMENT", "HIDE", eu_admin_user.pk),
        "门牌号": ("PRIVACY", "MASK", eu_admin_user.pk),
        "已有": ("PRIVACY", "REVIEW", None),  # 目标里原有的那条不被覆盖
    }
    kept.refresh_from_db()
    assert kept.action == SensitiveWordAction.REVIEW
    assert SensitiveWord.objects.filter(tenant=cn_tenant).count() == 3, "源文明的词表被动了"
    copies = SensitiveWord.objects.filter(tenant=eu_tenant, created_by=eu_admin_user)
    assert not SensitiveWordDailyHit.objects.filter(word__in=copies).exists(), "命中计数不该跟着复制"
    for row in copies:
        assert AuditLog.objects.filter(resource="social_moderation", resource_id=str(row.pk), action="CREATE").count() == 1


def test_copying_again_copies_nothing(cn_tenant, eu_tenant, eu_admin_user):
    word(cn_tenant, "还阳", category="INDUCEMENT")
    client = officer_client(eu_admin_user)
    assert client.post(COPY, {"source_tenant": "CN_DIYU"}, format="json").json() == {"copied": 1, "skipped": 0}
    assert client.post(COPY, {"source_tenant": "CN_DIYU"}, format="json").json() == {"copied": 0, "skipped": 1}


def test_copy_refuses_its_own_civilization_and_unknown_ones(cn_tenant, admin_user):
    word(cn_tenant, "还阳", category="INDUCEMENT")
    client = officer_client(admin_user)
    same = client.post(COPY, {"source_tenant": "CN_DIYU"}, format="json")
    assert same.status_code == 400 and same.json()["code"] == "same_tenant"
    assert client.post(COPY, {"source_tenant": "NOPE"}, format="json").status_code == 404
    assert client.post(COPY, {}, format="json").status_code == 400
    assert SensitiveWord.objects.count() == 1


def test_only_admin_may_copy_and_a_moderator_learns_nothing_about_the_other_list(
    cn_tenant, eu_tenant, eu_moderator, judge_user
):
    """MODERATOR 持有 social.moderate,但这是读别的文明词表的唯一入口 —— 403,且回包里没有任何一个词。"""
    word(cn_tenant, "地府机密词", category="CONFIDENTIAL")

    res = officer_client(eu_moderator).post(COPY, {"source_tenant": "CN_DIYU"}, format="json")

    assert res.status_code == 403, res.content
    assert res.json()["code"] == "admin_only"
    assert "地府机密词" not in res.content.decode()
    assert not SensitiveWord.objects.filter(tenant=eu_tenant).exists()
    # 分不出源文明存不存在、有多少词:不存在的源答同一个 403。
    unknown = officer_client(eu_moderator).post(COPY, {"source_tenant": "NOPE"}, format="json")
    assert (unknown.status_code, unknown.json()) == (403, res.json())
    # 自己文明的词表照旧只列自己的。
    assert officer_client(eu_moderator).get(f"{MODERATION}/sensitive-words/").json()["results"] == []
    # 没有 social.moderate 的更进不来。
    assert officer_client(judge_user).post(COPY, {"source_tenant": "CN_DIYU"}, format="json").status_code == 403


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


def _mute_ids(client, **params):
    res = client.get(f"{MODERATION}/mutes/", params)
    assert res.status_code == 200, res.content
    return {r["id"] for r in res.json()["results"]}


def test_mute_filters_status_term_executor_and_name(cn_tenant, cn_moderator, django_user_model):
    other = django_user_model.objects.create(username="cn_mod2", role="MODERATOR", tenant=cn_tenant, display_name="崔珏")
    short = mod.mute_user(soul(cn_tenant, "韩守一")[0].user, cn_tenant, 7, actor=cn_moderator)
    medium = mod.mute_user(soul(cn_tenant, "王素心")[0].user, cn_tenant, 30, actor=other)
    long_ = mod.mute_user(soul(cn_tenant, "Kleon")[0].user, cn_tenant, 365, actor=cn_moderator)
    lifted = mod.mute_user(soul(cn_tenant, "解除的")[0].user, cn_tenant, 8, actor=other)
    mod.lift_mute(lifted, actor=other)
    expired = mod.mute_user(soul(cn_tenant, "到期的")[0].user, cn_tenant, 1, actor=cn_moderator)
    SocialMute.objects.filter(pk=expired.pk).update(
        created_at=timezone.now() - timedelta(days=3), until=timezone.now() - timedelta(days=2)
    )
    client = officer_client(cn_moderator)
    ids = lambda *rows: {str(r.pk) for r in rows}  # noqa: E731

    assert _mute_ids(client) == ids(short, medium, long_, lifted, expired)
    assert _mute_ids(client, status="ACTIVE") == ids(short, medium, long_)
    assert _mute_ids(client, status="EXPIRED") == ids(expired)
    assert _mute_ids(client, status="LIFTED") == ids(lifted)
    # 时长是 until − created_at,边界闭在上限:7 天算短,8 天算中,30 天算中,31 天起算长。
    assert _mute_ids(client, term="SHORT") == ids(short, expired)
    assert _mute_ids(client, term="MEDIUM") == ids(medium, lifted)
    assert _mute_ids(client, term="LONG") == ids(long_)
    assert _mute_ids(client, created_by=other.pk) == ids(medium, lifted)
    assert _mute_ids(client, q="素心") == ids(medium)
    assert _mute_ids(client, status="ACTIVE", created_by=cn_moderator.pk, term="LONG") == ids(long_)
    for bad in ({"status": "FOREVER"}, {"term": "PERMANENT"}, {"created_by": "x"}):
        assert _mute_ids(client, **bad) == set(), bad

    executors = sorted(client.get(f"{MODERATION}/mutes/executors/").json(), key=lambda r: -r["user_id"])
    assert executors == [
        {"user_id": other.pk, "display_name": "崔珏"},
        {"user_id": cn_moderator.pk, "display_name": "地府审核官"},
    ]


def test_mute_executors_and_the_soul_picker_stay_in_the_civilization(
    cn_tenant, eu_tenant, cn_moderator, eu_moderator, judge_user
):
    mod.mute_user(soul(cn_tenant, "地府的")[0].user, cn_tenant, 3, actor=cn_moderator)
    eu_soul, _ = soul(eu_tenant, "天堂的灵魂")
    visitor, _ = soul(cn_tenant, "暂居天堂的", home_tenant=cn_tenant)
    type(visitor.soul).all_objects.filter(pk=visitor.soul_id).update(tenant=eu_tenant)

    eu = officer_client(eu_moderator)
    assert eu.get(f"{MODERATION}/mutes/executors/").json() == []
    names = {r["display_name"] for r in eu.get(f"{MODERATION}/mutes/souls/").json()}
    assert names == {eu_soul.user.display_name, visitor.user.display_name}, "选人框按此刻所在文明,不按原属"
    assert eu.get(f"{MODERATION}/mutes/souls/", {"q": "暂居"}).json() == [
        {"user_id": visitor.user_id, "display_name": visitor.user.display_name}
    ]
    cn_names = {r["display_name"] for r in officer_client(cn_moderator).get(f"{MODERATION}/mutes/souls/").json()}
    assert "天堂的灵魂" not in cn_names and "暂居天堂的" not in cn_names and "地府的" in cn_names
    assert officer_client(judge_user).get(f"{MODERATION}/mutes/souls/").status_code == 403
    assert officer_client(judge_user).get(f"{MODERATION}/mutes/executors/").status_code == 403


def test_the_soul_picker_leaves_out_retired_accounts_and_officers(cn_tenant, cn_moderator):
    live, _ = soul(cn_tenant, "本世的")
    retired, _ = soul(cn_tenant, "上一世的")
    type(retired).objects.filter(pk=retired.pk).update(retired_at=timezone.now())
    rows = officer_client(cn_moderator).get(f"{MODERATION}/mutes/souls/").json()
    assert [r["user_id"] for r in rows] == [live.user_id]


def test_a_mute_is_one_to_365_days_never_permanent(cn_tenant, cn_moderator):
    target, _ = soul(cn_tenant, "被禁言的")
    client = officer_client(cn_moderator)
    for days in (0, 366, None):
        body = {"user_id": target.user_id} if days is None else {"user_id": target.user_id, "days": days}
        assert client.post(f"{MODERATION}/mutes/", body, format="json").status_code == 400, days
    assert not SocialMute.objects.exists()
    assert client.post(f"{MODERATION}/mutes/", {"user_id": target.user_id, "days": 365}, format="json").status_code == 201


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


# ── 表态数(念 …)───────────────────────────────────────────────────────────


def test_the_officer_post_carries_per_kind_reaction_counts_without_deleted_ones(cn_tenant, cn_moderator):
    from apps.social.models import Reaction

    author, _ = soul(cn_tenant, "作者")
    row = post(author, "有人念的帖子", Visibility.PUBLIC)
    Post.objects.filter(pk=row.pk).update(moderation_status=ModerationStatus.PENDING)
    fans = [soul(cn_tenant, f"读者{i}")[0].user for i in range(4)]
    for user, kind in zip(fans, ["LOVE", "LOVE", "LIKE", "LOVE"], strict=True):
        Reaction.objects.create(user=user, post=row, reaction_type=kind, tenant=cn_tenant)
    Reaction.objects.filter(user=fans[3]).update(is_deleted=True)  # 撤回的不算
    client = officer_client(cn_moderator)
    expected = {"LIKE": 1, "LOVE": 2, "RESPECT": 0, "SYMPATHY": 0, "ETERNAL_LIGHT": 0}

    listed = {r["id"]: r for r in client.get(f"{MODERATION}/posts/").json()["results"]}
    assert listed[str(row.pk)]["reaction_counts"] == expected
    assert client.get(f"{MODERATION}/posts/{row.pk}/").json()["reaction_counts"] == expected
    # 处置动作的回包是同一形状,不是一行没有注解的数据。
    approved = client.post(f"{MODERATION}/posts/{row.pk}/approve/", {}, format="json")
    assert approved.status_code == 200, approved.content
    assert approved.json()["reaction_counts"] == expected


# ── 警告作者(WARN)────────────────────────────────────────────────────────


def _reported_post(tenant):
    author, _ = soul(tenant, "作者")
    row = post(author, "被举报的帖子", Visibility.PUBLIC)
    _, reporter = soul(tenant, "举报人")
    res = reporter.post(f"{SOCIAL}/reports/", {"target_type": "POST", "target_id": str(row.pk), "reason": "ABUSE"},
                        format="json")
    assert res.status_code == 201, res.content
    return author, row, Report.objects.get(post=row)


def test_warn_needs_a_reason_and_changes_nothing_without_one(cn_tenant, cn_moderator):
    _, row, report = _reported_post(cn_tenant)
    client = officer_client(cn_moderator)
    for note in (None, "", "   "):
        body = {"resolution": "WARN"} if note is None else {"resolution": "WARN", "note": note}
        with mock.patch("apps.events.event_bus.event_bus.publish") as published:
            res = client.post(f"{MODERATION}/reports/{report.pk}/resolve/", body, format="json")
        assert res.status_code == 400, (note, res.content)
        assert res.json()["code"] == "reason_required"
        assert published.call_count == 0
    report.refresh_from_db()
    assert (report.status, report.resolution) == ("OPEN", "")
    assert not AuditLog.objects.filter(resource="social_moderation", resource_id=str(report.pk)).exists()


def test_warn_notifies_the_author_with_the_reason_keeps_the_post_and_dismisses_the_report(
    cn_tenant, cn_moderator, django_capture_on_commit_callbacks
):
    author, row, report = _reported_post(cn_tenant)
    _, reader = soul(cn_tenant, "读者")

    with (
        mock.patch("apps.events.event_bus.event_bus.publish") as published,
        django_capture_on_commit_callbacks(execute=True),
    ):
        res = officer_client(cn_moderator).post(
            f"{MODERATION}/reports/{report.pk}/resolve/", {"resolution": "WARN", "note": "注意言辞"}, format="json"
        )

    assert res.status_code == 200, res.content
    assert (res.json()["status"], res.json()["resolution"], res.json()["resolution_note"]) == (
        "DISMISSED", "WARN", "注意言辞"
    )
    calls = [(c.kwargs["event_type"], c.kwargs["user_ids"], c.kwargs["payload"]) for c in published.call_args_list]
    assert calls == [("SOCIAL_WARNED", [author.user_id], {
        "report_id": str(report.pk), "target_type": "POST", "target_id": str(row.pk), "reason": "注意言辞",
    })]
    row.refresh_from_db()
    assert (row.moderation_status, row.is_deleted) == (ModerationStatus.PUBLISHED, False)
    assert str(row.pk) in feed_ids(reader), "警告不该让帖子消失"
    logged = AuditLog.objects.get(resource="social_moderation", resource_id=str(report.pk))
    assert (logged.action, logged.user_id) == ("UPDATE", cn_moderator.pk)
    assert logged.changes["resolution"] == "WARN" and logged.changes["note"] == "注意言辞"
    # 已关闭:不能再处置一次。
    again = officer_client(cn_moderator).post(
        f"{MODERATION}/reports/{report.pk}/resolve/", {"resolution": "WARN", "note": "再警告"}, format="json"
    )
    assert again.status_code == 409


def test_warn_on_another_civilizations_report_is_a_404(cn_tenant, eu_moderator):
    _, _, report = _reported_post(cn_tenant)
    res = officer_client(eu_moderator).post(
        f"{MODERATION}/reports/{report.pk}/resolve/", {"resolution": "WARN", "note": "越界"}, format="json"
    )
    assert res.status_code == 404
    report.refresh_from_db()
    assert report.status == "OPEN"
