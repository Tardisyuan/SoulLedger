"""审核后台:举报(合并、上限)、敏感词、处置(租户隔离、审计)、禁言。

**每条处置都断言审计落了一行**,不只是断言状态变了。审计是这套后台唯一的事后凭据,
而「状态改对了」与「有人能查到是谁改的」是两件事 —— 这个仓库记过一次
(`test_audit_assertions_are_not_vacuous.py`):审计断言最容易写成恒真。
"""
from datetime import timedelta

import pytest
from django.utils import timezone

from apps.audit.models import AuditLog
from apps.social import moderation as mod
from apps.social import soul_circle as circle
from apps.social.models import (
    ModerationStatus,
    Post,
    Report,
    ReportEntry,
    ReportStatus,
    ReportTargetType,
    SensitiveWord,
    SocialMute,
    Visibility,
)
from tests.soul_social_support import MODERATION, SOCIAL, officer_client, post, soul

pytestmark = pytest.mark.django_db


@pytest.fixture
def eu_moderator(db, django_user_model, eu_tenant):
    """另一个文明的殿主。**不用 `eu_admin_user`**:ADMIN 是这个仓库里唯一跨租户的
    角色(apps/core/tenant.py::is_tenant_exempt),拿它测租户隔离,测到的是豁免。"""
    return django_user_model.objects.create(username="eu_moderator", role="MODERATOR", tenant=eu_tenant)


def audit_rows(resource_id):
    return AuditLog.objects.filter(resource="social_moderation", resource_id=str(resource_id))


# ── 敏感词 ────────────────────────────────────────────────────────────────


def test_a_post_hitting_the_word_list_goes_to_the_queue_and_is_invisible(cn_tenant):
    SensitiveWord.objects.create(tenant=cn_tenant, word="违禁词")
    author, client = soul(cn_tenant, "作者")
    _, reader = soul(cn_tenant, "读者")

    res = client.post(f"{SOCIAL}/feed/", {"content": "这里有违禁词啊", "visibility": "PUBLIC"}, format="json")
    assert res.status_code == 201, res.content
    assert res.json()["moderation_status"] == "PENDING"

    from tests.soul_social_support import feed_ids

    assert res.json()["id"] not in feed_ids(reader), "命中敏感词的帖子在审核前就可见了"
    # 干净的内容不进队列 —— 否则「全都进队列」也能让上面那条通过。
    clean = client.post(f"{SOCIAL}/feed/", {"content": "今天天气不错", "visibility": "PUBLIC"}, format="json")
    assert clean.json()["moderation_status"] == "PUBLISHED"
    assert clean.json()["id"] in feed_ids(reader)


def test_the_word_list_is_per_civilization(cn_tenant, eu_tenant):
    SensitiveWord.objects.create(tenant=cn_tenant, word="违禁词")
    _, cn_client = soul(cn_tenant, "地府甲")
    _, eu_client = soul(eu_tenant, "天堂乙")
    body = {"content": "这里有违禁词啊", "visibility": "PUBLIC"}

    assert cn_client.post(f"{SOCIAL}/feed/", body, format="json").json()["moderation_status"] == "PENDING"
    assert eu_client.post(f"{SOCIAL}/feed/", body, format="json").json()["moderation_status"] == "PUBLISHED"


def test_adding_and_removing_a_word_is_audited(cn_tenant, admin_user):
    client = officer_client(admin_user)
    res = client.post(f"{MODERATION}/sensitive-words/", {"word": " 违禁词 ", "category": "ABUSE"}, format="json")
    assert res.status_code == 201, res.content
    word_id = res.json()["id"]
    assert SensitiveWord.objects.get(pk=word_id).word == "违禁词", "没有归一化(去空白、小写)"
    assert audit_rows(word_id).filter(action="CREATE").count() == 1

    assert client.post(
        f"{MODERATION}/sensitive-words/", {"word": "违禁词", "category": "ABUSE"}, format="json"
    ).status_code == 409
    assert client.delete(f"{MODERATION}/sensitive-words/{word_id}/").status_code == 204
    assert audit_rows(word_id).filter(action="DELETE").count() == 1


# ── 举报 ─────────────────────────────────────────────────────────────────


def test_several_souls_reporting_one_post_merge_into_one_row(cn_tenant):
    author, _ = soul(cn_tenant, "作者")
    row = post(author, "被举报的帖子", Visibility.PUBLIC)
    reporters = [soul(cn_tenant, f"举报人{i}") for i in range(3)]

    for _, client in reporters:
        res = client.post(
            f"{SOCIAL}/reports/",
            {"target_type": "POST", "target_id": str(row.pk), "reason": "SPAM"},
            format="json",
        )
        assert res.status_code == 201, res.content

    report = Report.objects.get(post=row, status=ReportStatus.OPEN)
    assert report.report_count == 3
    assert ReportEntry.objects.filter(report=report).count() == 3

    # 同一个人再举报一次:不重复计数,也不占额度。
    _, first = reporters[0]
    res = first.post(
        f"{SOCIAL}/reports/", {"target_type": "POST", "target_id": str(row.pk), "reason": "ABUSE"}, format="json"
    )
    assert res.json()["counted"] is False
    report.refresh_from_db()
    assert report.report_count == 3


def test_a_soul_cannot_report_more_than_the_daily_limit(cn_tenant):
    author, _ = soul(cn_tenant, "作者")
    reporter, client = soul(cn_tenant, "举报人")
    posts = [post(author, f"帖子{i}", Visibility.PUBLIC) for i in range(mod.REPORTS_PER_DAY + 1)]

    for row in posts[: mod.REPORTS_PER_DAY]:
        res = client.post(
            f"{SOCIAL}/reports/", {"target_type": "POST", "target_id": str(row.pk), "reason": "SPAM"}, format="json"
        )
        assert res.status_code == 201, res.content
    assert res.json()["reports_remaining"] == 0

    over = client.post(
        f"{SOCIAL}/reports/", {"target_type": "POST", "target_id": str(posts[-1].pk), "reason": "SPAM"}, format="json"
    )
    assert over.status_code == 429, over.content
    assert over.json()["code"] == "report_limit"
    assert ReportEntry.objects.filter(reporter=reporter.user).count() == mod.REPORTS_PER_DAY

    # 窗口是滚动的:把已有的那些挪到 25 小时前,额度回来。
    ReportEntry.objects.filter(reporter=reporter.user).update(created_at=timezone.now() - timedelta(hours=25))
    again = client.post(
        f"{SOCIAL}/reports/", {"target_type": "POST", "target_id": str(posts[-1].pk), "reason": "SPAM"}, format="json"
    )
    assert again.status_code == 201, again.content


def test_a_soul_cannot_report_what_it_cannot_see(cn_tenant, eu_tenant):
    stranger, _ = soul(eu_tenant, "另一个文明的人")
    hers = post(stranger, "另一个文明的帖子", Visibility.PUBLIC)
    _, client = soul(cn_tenant, "举报人")

    res = client.post(
        f"{SOCIAL}/reports/", {"target_type": "POST", "target_id": str(hers.pk), "reason": "SPAM"}, format="json"
    )
    assert res.status_code == 404, res.content
    assert Report.objects.count() == 0


# ── 官员处置 ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "action,start,expected",
    [
        ("approve", ModerationStatus.PENDING, "PUBLISHED"),
        ("hide", ModerationStatus.PUBLISHED, "HIDDEN"),
        ("restore", ModerationStatus.HIDDEN, "PUBLISHED"),
    ],
)
def test_content_actions_move_the_status_and_leave_an_audit_row(cn_tenant, admin_user, action, start, expected):
    author, _ = soul(cn_tenant, "作者")
    row = post(author, "一条", Visibility.PUBLIC)
    Post.objects.filter(pk=row.pk).update(moderation_status=start)

    res = officer_client(admin_user).post(f"{MODERATION}/posts/{row.pk}/{action}/", {"reason": "为什么"}, format="json")
    assert res.status_code == 200, res.content
    row.refresh_from_db()
    assert row.moderation_status == expected

    logged = audit_rows(row.pk).first()
    assert logged is not None, f"{action} 没有写审计"
    assert logged.user_id == admin_user.pk
    assert logged.changes["moderation_status"] == [start, expected], logged.changes


def test_an_invalid_transition_is_refused_rather_than_silently_applied(cn_tenant, admin_user):
    author, _ = soul(cn_tenant, "作者")
    row = post(author, "已发布", Visibility.PUBLIC)

    res = officer_client(admin_user).post(f"{MODERATION}/posts/{row.pk}/approve/", {}, format="json")
    assert res.status_code == 409, res.content
    assert res.json()["code"] == "invalid_transition"
    row.refresh_from_db()
    assert row.moderation_status == ModerationStatus.PUBLISHED
    assert audit_rows(row.pk).count() == 0, "被拒的动作也写了审计"


def test_deleting_content_soft_deletes_it_and_closes_its_open_reports(cn_tenant, admin_user):
    author, _ = soul(cn_tenant, "作者")
    row = post(author, "要删的", Visibility.PUBLIC)
    reporter, client = soul(cn_tenant, "举报人")
    client.post(f"{SOCIAL}/reports/", {"target_type": "POST", "target_id": str(row.pk), "reason": "ABUSE"},
                format="json")

    res = officer_client(admin_user).post(f"{MODERATION}/posts/{row.pk}/delete/", {"reason": "违规"}, format="json")
    assert res.status_code == 204, res.content
    assert not Post.objects.filter(pk=row.pk).exists()
    assert Post.all_objects.get(pk=row.pk).is_deleted
    assert Report.objects.get(post_id=row.pk).status == ReportStatus.RESOLVED


def test_an_officer_cannot_moderate_another_civilizations_content(cn_tenant, eu_moderator):
    author, _ = soul(cn_tenant, "地府的作者")
    row = post(author, "地府的帖子", Visibility.PUBLIC)
    Post.objects.filter(pk=row.pk).update(moderation_status=ModerationStatus.PENDING)

    client = officer_client(eu_moderator)
    listed = client.get(f"{MODERATION}/posts/")
    assert listed.status_code == 200, listed.content  # 进得来,只是看不到 —— 不是被码名挡在门外
    assert str(row.pk) not in {r["id"] for r in listed.json()["results"]}
    res = client.post(f"{MODERATION}/posts/{row.pk}/approve/", {}, format="json")
    assert res.status_code == 404, res.content
    row.refresh_from_db()
    assert row.moderation_status == ModerationStatus.PENDING, "另一个文明的官员改动了这条内容"


def test_an_officers_own_social_post_never_enters_the_queue(cn_tenant, admin_user, judge_user):
    """官员在 `/api/v1/social/` 的帖子不是朋友圈内容。两个圈子在审核后台也不相交。"""
    officer_post = Post.objects.create(
        author=judge_user, content="官员的帖子", visibility=Visibility.TENANT, tenant=cn_tenant,
        moderation_status=ModerationStatus.PENDING,
    )
    soul_author, _ = soul(cn_tenant, "灵魂作者")
    soul_post = post(soul_author, "灵魂的帖子", Visibility.PUBLIC)
    Post.objects.filter(pk=soul_post.pk).update(moderation_status=ModerationStatus.PENDING)

    ids = {r["id"] for r in officer_client(admin_user).get(f"{MODERATION}/posts/").json()["results"]}
    assert str(soul_post.pk) in ids
    assert str(officer_post.pk) not in ids


# ── 禁言 ─────────────────────────────────────────────────────────────────


def test_muting_through_a_report_makes_the_author_read_only(cn_tenant, admin_user):
    author, author_client = soul(cn_tenant, "作者")
    row = post(author, "被举报的", Visibility.PUBLIC)
    _, reporter = soul(cn_tenant, "举报人")
    reporter.post(f"{SOCIAL}/reports/", {"target_type": "POST", "target_id": str(row.pk), "reason": "ABUSE"},
                  format="json")
    report = Report.objects.get(post=row)

    res = officer_client(admin_user).post(
        f"{MODERATION}/reports/{report.pk}/resolve/",
        {"resolution": "MUTE", "mute_days": 7, "note": "辱骂"},
        format="json",
    )
    assert res.status_code == 200, res.content
    assert res.json()["status"] == "RESOLVED"

    mute = SocialMute.objects.get(user=author.user)
    assert audit_rows(mute.pk).filter(action="CREATE").count() == 1
    blocked = author_client.post(f"{SOCIAL}/feed/", {"content": "再发一条"}, format="json")
    assert blocked.status_code == 403 and blocked.json()["code"] == "muted"

    # 解除之后立刻能写。
    lift = officer_client(admin_user).post(f"{MODERATION}/mutes/{mute.pk}/lift/", {}, format="json")
    assert lift.status_code == 200, lift.content
    assert author_client.post(f"{SOCIAL}/feed/", {"content": "再发一条"}, format="json").status_code == 201


def test_an_already_resolved_report_cannot_be_resolved_twice(cn_tenant, admin_user):
    author, _ = soul(cn_tenant, "作者")
    row = post(author, "被举报的", Visibility.PUBLIC)
    _, reporter = soul(cn_tenant, "举报人")
    reporter.post(f"{SOCIAL}/reports/", {"target_type": "POST", "target_id": str(row.pk), "reason": "SPAM"},
                  format="json")
    report = Report.objects.get(post=row)
    client = officer_client(admin_user)

    assert client.post(f"{MODERATION}/reports/{report.pk}/resolve/", {"resolution": "DISMISS"},
                       format="json").status_code == 200
    second = client.post(f"{MODERATION}/reports/{report.pk}/resolve/", {"resolution": "HIDE"}, format="json")
    assert second.status_code == 409, second.content
    assert second.json()["code"] == "already_resolved"
    row.refresh_from_db()
    assert row.moderation_status == ModerationStatus.PUBLISHED, "第二次处置还是生效了"


def test_an_officer_cannot_mute_another_civilizations_soul(cn_tenant, eu_moderator):
    target, _ = soul(cn_tenant, "地府的灵魂")
    res = officer_client(eu_moderator).post(
        f"{MODERATION}/mutes/", {"user_id": target.user_id, "days": 3}, format="json"
    )
    assert res.status_code == 404, res.content
    assert SocialMute.objects.count() == 0


def test_a_mute_does_not_follow_the_soul_into_its_next_life(cn_tenant):
    """禁言挂在 User(某一世的账号)上,与「社交内容随账号」同一条规则。"""
    muted, _ = soul(cn_tenant, "被禁言的")
    SocialMute.objects.create(tenant=cn_tenant, user=muted.user, until=timezone.now() + timedelta(days=30))
    assert circle.active_mute(muted.user) is not None

    next_life, next_client = soul(cn_tenant, "下一世")  # 另一个 User
    assert circle.active_mute(next_life.user) is None
    assert next_client.post(f"{SOCIAL}/feed/", {"content": "新一世发帖"}, format="json").status_code == 201


def test_reporting_a_user_targets_the_user_not_a_piece_of_content(cn_tenant, admin_user):
    target, _ = soul(cn_tenant, "被举报的人")
    _, client = soul(cn_tenant, "举报人")

    res = client.post(
        f"{SOCIAL}/reports/", {"target_type": "USER", "target_id": str(target.user_id), "reason": "ABUSE"},
        format="json",
    )
    assert res.status_code == 201, res.content
    report = Report.objects.get(target_type=ReportTargetType.USER)
    assert report.target_user_id == target.user_id and report.post_id is None and report.comment_id is None

    # 对「用户」这种举报,隐藏 / 删除没有对象 —— 答 400 而不是静默成功。
    officer = officer_client(admin_user)
    bad = officer.post(f"{MODERATION}/reports/{report.pk}/resolve/", {"resolution": "HIDE"}, format="json")
    assert bad.status_code == 400, bad.content
    report.refresh_from_db()
    assert report.status == ReportStatus.OPEN


# ── 码名 ─────────────────────────────────────────────────────────────────


def test_only_holders_of_social_moderate_get_in(cn_tenant, django_user_model, judge_user):
    """默认 ADMIN 与 MODERATOR 持有;JUDGE 不持有 —— 被举报的内容里有 PRIVATE 与待审的帖子。
    两个方向都断言:只断言「JUDGE 进不来」,一个把所有人都挡在外面的后台也能通过。"""
    moderator = django_user_model.objects.create(username="cn_moderator", role="MODERATOR", tenant=cn_tenant)
    for path in ["reports/", "posts/", "comments/", "sensitive-words/", "mutes/"]:
        assert officer_client(judge_user).get(f"{MODERATION}/{path}").status_code == 403, path
        assert officer_client(moderator).get(f"{MODERATION}/{path}").status_code == 200, path
