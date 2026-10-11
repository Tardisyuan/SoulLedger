"""审核后台的帖子给三个评论数:已发布 `comment_count`、待审 `pending_comment_count`、已隐藏 `hidden_comment_count`。

口径同一处(`soul_circle.comment_count_in`):未删除的、按审核状态分组。只有审核后台的序列化器多这两个数 ——
灵魂端和官员端的列表不能经计数泄露待审 / 已隐藏评论的存在。列表接口全靠注解,条数不随行数增长。
"""
import pytest
from django.db import connection
from django.test.utils import CaptureQueriesContext

from apps.social.models import Comment, ModerationStatus
from tests.soul_social_support import MODERATION, SOCIAL, officer_client, post, soul

pytestmark = pytest.mark.django_db


@pytest.fixture
def cn_moderator(db, django_user_model, cn_tenant):
    return django_user_model.objects.create(username="cn_moderator_cc", role="MODERATOR", tenant=cn_tenant)


def comment(row, author, status=ModerationStatus.PUBLISHED, **fields):
    return Comment.objects.create(post=row, author=author, content="评", moderation_status=status, tenant=row.tenant, **fields)


def counts(body):
    return body["comment_count"], body["pending_comment_count"], body["hidden_comment_count"]


def test_each_status_is_counted_on_its_own_and_deleted_and_foreign_comments_are_not(cn_tenant, cn_moderator):
    author, _ = soul(cn_tenant, "作者")
    reader, _ = soul(cn_tenant, "读者")
    target, other = post(author), post(author, "另一条")
    for status, n in ((ModerationStatus.PUBLISHED, 3), (ModerationStatus.PENDING, 2), (ModerationStatus.HIDDEN, 1)):
        for _ in range(n):
            comment(target, reader.user, status)
    # 软删除的不数(每个状态各一条),别的帖子的评论不串。
    for status in ModerationStatus.values:
        comment(target, reader.user, status, is_deleted=True)
    comment(other, reader.user, ModerationStatus.PENDING)

    client = officer_client(cn_moderator)
    detail = client.get(f"{MODERATION}/posts/{target.pk}/").json()
    assert counts(detail) == (3, 2, 1)
    rows = {r["id"]: r for r in client.get(f"{MODERATION}/posts/", {"moderation_status": "PUBLISHED"}).json()["results"]}
    assert counts(rows[str(target.pk)]) == (3, 2, 1)
    assert counts(rows[str(other.pk)]) == (0, 1, 0)


def test_only_the_moderation_serializer_gives_the_two_extra_counts(cn_tenant, cn_moderator):
    author, client = soul(cn_tenant, "作者")
    reader, _ = soul(cn_tenant, "读者")
    row = post(author)
    comment(row, reader.user, ModerationStatus.PENDING)

    soul_side = client.get(f"{SOCIAL}/feed/").json()["results"][0]
    assert "pending_comment_count" not in soul_side and "hidden_comment_count" not in soul_side
    assert soul_side["comment_count"] == 0, "待审评论不能经计数泄露"
    officer_side = officer_client(cn_moderator).get("/api/v1/social/posts/").json()
    assert "pending_comment_count" not in str(officer_side) and "hidden_comment_count" not in str(officer_side)


def _list_queries(client, rows):
    client.get(f"{MODERATION}/posts/", {"moderation_status": "PUBLISHED"})  # 第一次请求带登录 / 权限缓存的查询
    with CaptureQueriesContext(connection) as ctx:
        res = client.get(f"{MODERATION}/posts/", {"page_size": 50, "moderation_status": "PUBLISHED"})
        assert res.status_code == 200
        assert len(res.json()["results"]) == rows
    return len(ctx.captured_queries)


def test_the_list_does_not_ask_once_per_row(cn_tenant, cn_moderator):
    """变异:把 `get_pending_comment_count` 恒走现查(去掉注解读取)→ 多行时条数随行数增长,红。"""
    author, _ = soul(cn_tenant, "作者")
    reader, _ = soul(cn_tenant, "读者")
    client = officer_client(cn_moderator)

    def add(n):
        for i in range(n):
            row = post(author, f"帖{Comment.objects.count()}-{i}")
            for status in (ModerationStatus.PUBLISHED, ModerationStatus.PENDING, ModerationStatus.HIDDEN):
                comment(row, reader.user, status)

    add(2)
    few = _list_queries(client, 2)
    add(10)
    many = _list_queries(client, 12)
    assert many == few, f"queries grew with rows: {few} for 2 posts, {many} for 12"
