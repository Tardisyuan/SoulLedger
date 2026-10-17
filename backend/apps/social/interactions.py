"""灵魂「互动消息」(Design 第四十批 S-a):别人对我做了什么。

* 评论我的帖子、回复我的评论 → 一条一行,**并推送**(偏好「评论和回复」,`soul_push.services.record_social_comment`)。
* 表态、长明灯 → 只进站内,同一帖同一天合并一行;关注 → 只进站内,同一天合并一行。
* 只保留 `SocialInteraction.RETENTION_DAYS` 天;打开那一页即全部已读(`mark_all_read`)。

记录是派生物,与推送同一条:写在发布者的事务里(回滚则一起没有),但**失败不拖垮业务** ——
每一笔在自己的保存点里,出错只记日志(PostgreSQL 上一条失败语句会中止外层事务)。
收件人只算本世灵魂账号:官员、前世账号不收。自己对自己做的不记。
"""
import logging
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.social.models import MERGED_POST_KINDS, InteractionKind, ModerationStatus, ReactionType, SocialInteraction

logger = logging.getLogger(__name__)


def _guarded(fn):
    def run(*args, **kwargs):
        try:
            with transaction.atomic():
                return fn(*args, **kwargs)
        except Exception:
            logger.exception("social interactions: %s 记录失败", fn.__name__)
            return None
    return run


def _receives(user, actor):
    from apps.social.soul_circle import is_current_soul

    return user is not None and actor is not None and user.pk != actor.pk and is_current_soul(user)


@_guarded
def record_comment(comment):
    """一条已发布的评论:回复 → 被回复的人一行 REPLY;帖子作者(不是被回复的人时)一行 COMMENT。两行各推一条。"""
    from apps.soul_push.services import enqueue_on_commit, record_social_comment

    if comment.moderation_status != ModerationStatus.PUBLISHED:
        return
    actor, post, parent = comment.author, comment.post, comment.parent
    targets = []
    if parent is not None and _receives(parent.author, actor):
        targets.append((parent.author, InteractionKind.REPLY))
    if _receives(post.author, actor) and not (parent is not None and parent.author_id == post.author_id):
        targets.append((post.author, InteractionKind.COMMENT))
    now = timezone.now()
    for recipient, kind in targets:
        SocialInteraction.objects.create(
            tenant_id=post.tenant_id, recipient=recipient, actor=actor, kind=kind, post=post, comment=comment,
            actor_ids=[actor.pk], day=timezone.localdate(now), last_at=now,
        )
        enqueue_on_commit(record_social_comment(recipient.pk, kind.lower(), comment, actor.display_name))


def _merge(recipient, actor, kind, tenant_id, post=None):
    """把 `actor` 并进今天的那一行(没有就建)。同一个人已经在行里:什么也不变。"""
    now = timezone.now()
    key = {"recipient": recipient, "kind": kind, "day": timezone.localdate(now)}
    if kind in MERGED_POST_KINDS:
        key["post"] = post
    for _ in range(2):  # 第二次:并发的另一笔刚建了这一行,撞了唯一约束 → 锁住它再并一次
        row = SocialInteraction.objects.select_for_update().filter(**key).first()
        if row is not None:
            if actor.pk in row.actor_ids:
                return row
            row.actor_ids = [*row.actor_ids, actor.pk]
            row.last_at, row.read_at = now, None
            row.save(update_fields=["actor_ids", "last_at", "read_at"])
            return row
        try:
            with transaction.atomic():
                return SocialInteraction.objects.create(
                    tenant_id=tenant_id, actor=actor, actor_ids=[actor.pk], last_at=now, **key)
        except IntegrityError:
            continue
    return None


@_guarded
def record_reaction(user, post, reaction_type):
    """表态之后(新点或换了种类)调用。长明灯与其他表态分两行。"""
    if not _receives(post.author, user):
        return
    kind = InteractionKind.LAMP if reaction_type == ReactionType.ETERNAL_LIGHT else InteractionKind.REACTION
    _merge(post.author, user, kind, post.tenant_id, post=post)


@_guarded
def record_follow(user, target, tenant):
    if _receives(target, user):
        _merge(target, user, InteractionKind.FOLLOW, tenant.pk)


# ── 读 ─────────────────────────────────────────────────────────────────


def inbox(user):
    """保留窗口内的行,新的在前。"""
    cutoff = timezone.now() - timedelta(days=SocialInteraction.RETENTION_DAYS)
    return (SocialInteraction.objects.filter(recipient=user, last_at__gte=cutoff)
            .select_related("actor", "post", "comment").order_by("-last_at", "-id"))


def unread_count(user):
    return inbox(user).filter(read_at__isnull=True).count()


def mark_all_read(user):
    return SocialInteraction.objects.filter(recipient=user, read_at__isnull=True).update(read_at=timezone.now())
