"""灵魂朋友圈:身份、可见性与写路径的唯一出处。

用户决定(2026-09-17):

* **本文明 + 关注。** 灵魂只看得见、搜得到、关注得了**同一文明(当前所在租户)**的灵魂。
  帖子沿用四档可见性,但「公开」对灵魂也只到本文明为止 —— 所以 PUBLIC 与 TENANT 在这里
  是同一个答案。官员不出现在灵魂的朋友圈里,灵魂也不出现在官员的社交接口里
  (`apps/social/visibility.py::visible_posts` 排除 SOUL 作者)。
* **先发后审 + 举报。** 发出即可见;命中本文明敏感词的内容写成 PENDING,审核通过前
  除作者本人外不可见。禁言期间只读。

**「当前所在文明」读 `Soul.tenant`。** 灵魂账号表不存 tenant 列(apps/soul_accounts/models.py
文首),而并行分支 feat/dispatch-residence 引入的暂居让 `Soul.tenant` 表示「当前所在」、
`Soul.home_tenant` 表示「原属」—— 所以暂居的灵魂按所在文明算,本模块在那条分支合并前后
都不用改。`User.tenant` 不读:它是开号那一刻的快照,灵魂被转移后会过期。

**社交内容随账号(每一世一个 User)。** 前世账号的帖子、评论、关注都留着,归前世那个 User;
前世账号登录不了(`SoulJWTAuthentication` 对 retired 账号 401),所以它的内容天然只读。
新一世的账号从零开始:没有帖子、不关注任何人、不继承禁言。前世帖子对本文明其他灵魂仍按
可见性规则可见 —— **但仅当那个灵魂仍在这个文明**:见 `visible_posts_for_soul` 的作者条件。

**可见性只有一处。** 每一个列表、详情、写路径的「目标是否存在」都经
`visible_posts_for_soul` / `visible_comments_for_soul`;不可见与不存在答同一个 404。
"""
from dataclasses import dataclass

from django.db import transaction
from django.db.models import Count, OuterRef, Q, Subquery
from django.utils import timezone

from apps.social.models import (
    Comment,
    Follow,
    ModerationStatus,
    Post,
    Reaction,
    ReactionType,
    SocialMute,
    Visibility,
)
from apps.social.services import CommentService, FollowService, PostService, ReactionService

SOUL_ROLE = "SOUL"


class SocialError(Exception):
    """业务拒绝。`code` 给 App 分支用,`status` 给视图选状态码。"""

    def __init__(self, message, code, status=409, **extra):
        super().__init__(message)
        self.code = code
        self.status = status
        self.extra = extra


def _not_found():
    return SocialError("对象不存在。", "not_found", 404)


# ── 身份(聊天代理 feat/soul-chat 也用这几条)───────────────────────────────


def _account(user):
    if user is None or getattr(user, "role", None) != SOUL_ROLE:
        return None
    return getattr(user, "soul_account", None)


def civilization_of(user):
    """灵魂用户**当前所在**的文明(`Tenant`)。非灵魂、没有账号时为 None。

    前世(已停用)账号也返回其灵魂当前所在文明 —— 读内容时要用;能不能**写**看 `is_current_soul`。
    """
    account = _account(user)
    return account.soul.tenant if account is not None else None


def is_current_soul(user) -> bool:
    """这个 User 是某个灵魂**本世**、未停用的账号。前世账号、官员、匿名都是 False。"""
    account = _account(user)
    return account is not None and account.retired_at is None and user.is_active


def same_civilization(user_a, user_b) -> bool:
    """两个 User 都是本世灵魂账号,且此刻在同一文明。任一方是官员或前世账号即 False。"""
    if not (is_current_soul(user_a) and is_current_soul(user_b)):
        return False
    return account_tenant_id(user_a) == account_tenant_id(user_b)


def account_tenant_id(user):
    return _account(user).soul.tenant_id


def is_following(follower, target) -> bool:
    """`follower` 关注着 `target`,且两人此刻同文明。关注边按**所在文明**记(Follow.tenant):
    灵魂换了文明,旧文明里的关注边不再算数。"""
    if not same_civilization(follower, target):
        return False
    return Follow.objects.filter(
        follower=follower, following=target, tenant_id=account_tenant_id(follower)
    ).exists()


def are_mutual_followers(user_a, user_b) -> bool:
    """互相关注:同文明、不是同一人、双向都有关注边。聊天的准入判定用这一条。"""
    if user_a is None or user_b is None or user_a.pk == user_b.pk:
        return False
    if not same_civilization(user_a, user_b):
        return False
    tenant_id = account_tenant_id(user_a)
    edges = Follow.objects.filter(
        Q(follower=user_a, following=user_b) | Q(follower=user_b, following=user_a),
        tenant_id=tenant_id,
    ).values_list("follower_id", flat=True)
    return set(edges) == {user_a.pk, user_b.pk}


def souls_in(tenant, *, include_retired=False):
    """此刻在 `tenant` 的灵魂账号(User 查询集)。默认只要本世账号 —— 搜索、关注都只针对活人账号。"""
    from apps.authentication.models import User

    qs = User.objects.filter(role=SOUL_ROLE, soul_account__soul__tenant=tenant)
    if not include_retired:
        qs = qs.filter(soul_account__retired_at__isnull=True, is_active=True)
    return qs


def active_mute(user):
    """生效中的禁言,没有则 None。"""
    return (
        SocialMute.objects.filter(user=user, lifted_at__isnull=True, until__gt=timezone.now())
        .order_by("-until")
        .first()
    )


# ── 可见性 ──────────────────────────────────────────────────────────────


def visible_posts_for_soul(viewer, queryset=None):
    """`viewer` 看得见的帖子。失败即空:非灵魂、没有文明,一律 `none()`。

    五个条件,每个都有变异测试(tests/test_soul_social_visibility.py):
    1. 帖子属于 viewer 所在文明(`tenant`);
    2. 作者是灵魂,且**此刻**也在这个文明 —— 官员的帖子、迁出本文明的灵魂的旧帖子都不在;
    3. 已发布,或作者是 viewer 本人(本人看得见自己待审 / 被隐藏的内容,带状态提示);
    4. 四档可见性:PUBLIC 与 TENANT 同义(本文明)、FOLLOWERS 要求 viewer 关注作者、PRIVATE 只本人;
    5. 未删除(软删除由默认 manager 过滤)。
    """
    qs = Post.objects.all() if queryset is None else queryset
    tenant = civilization_of(viewer)
    if tenant is None:
        return qs.none()
    following = Follow.objects.filter(follower=viewer, tenant=tenant).values("following_id")
    return qs.filter(
        tenant=tenant,
        author__role=SOUL_ROLE,
        author__soul_account__soul__tenant=tenant,
    ).filter(
        Q(moderation_status=ModerationStatus.PUBLISHED) | Q(author=viewer)
    ).filter(
        Q(visibility__in=[Visibility.PUBLIC, Visibility.TENANT])
        | Q(author=viewer)
        | Q(visibility=Visibility.FOLLOWERS, author_id__in=following)
    )


def visible_comments_for_soul(viewer, queryset=None):
    """评论继承帖子的可见性,再叠加自己的审核状态与作者文明条件。"""
    qs = Comment.objects.all() if queryset is None else queryset
    tenant = civilization_of(viewer)
    if tenant is None:
        return qs.none()
    return qs.filter(
        post__in=visible_posts_for_soul(viewer),
        author__role=SOUL_ROLE,
        author__soul_account__soul__tenant=tenant,
    ).filter(Q(moderation_status=ModerationStatus.PUBLISHED) | Q(author=viewer))


def annotate_posts_for(viewer, qs):
    """列表要的计数(总数与五种各自的数)与「我的表态」。计数只数已发布、未删除的评论 —— 待审评论不能经计数泄露存在。

    ponytail: 每页一次聚合查询;帖子量上来后改为维护专用计数列。
    """
    return qs.select_related("author").annotate(
        visible_comment_count=Count(
            "comments",
            filter=Q(comments__moderation_status=ModerationStatus.PUBLISHED, comments__is_deleted=False),
            distinct=True,
        ),
        visible_reaction_count=Count("reactions", filter=Q(reactions__is_deleted=False), distinct=True),
        **{
            f"reactions_{kind.lower()}": Count(
                "reactions", filter=Q(reactions__is_deleted=False, reactions__reaction_type=kind), distinct=True
            )
            for kind in ReactionType.values
        },
        my_reaction=Subquery(
            Reaction.objects.filter(post=OuterRef("pk"), user=viewer).values("reaction_type")[:1]
        ),
    )


# ── 写路径 ──────────────────────────────────────────────────────────────


def ensure_can_write(user):
    """所有写操作的唯一闸门:本世账号、未被禁言。**禁言期间只读** —— 包括删自己的内容、
    取关、举报(保守默认,待用户确认是否放开删除与取关)。"""
    if not is_current_soul(user):
        raise SocialError("账号已停用,朋友圈只读。", "account_retired", 403)
    mute = active_mute(user)
    if mute is not None:
        raise SocialError("你已被禁言,期间朋友圈只读。", "muted", 403, muted_until=mute.until)
    return civilization_of(user)


def publish_event(event_type, tenant, user_ids, payload):
    """提交后发事件。payload 只放 id,不放内容:租户 webhook(`WebhookConfig.events` 为空时
    订阅全部)也会收到它。推送由 feat/soul-push 订阅 domain="social" 接。"""
    from apps.events.event_bus import event_bus

    user_ids = [uid for uid in user_ids if uid is not None]
    if not user_ids:
        return
    transaction.on_commit(lambda: event_bus.publish(
        event_type=event_type, payload=payload, domain="social",
        tenant_code=tenant.code, user_ids=user_ids,
    ))


def _screen(tenant, content):
    """敏感词的三种动作(送审 / 隐藏 / 替换)都在 `moderation.screen_content` 里定;这里只负责
    把结果写进同一次 INSERT,并在同一事务里计命中。"""
    from apps.social.moderation import screen_content

    return screen_content(tenant, content)


def create_post(author, content, visibility):
    tenant = ensure_can_write(author)
    screening = _screen(tenant, content)
    with transaction.atomic():
        post = Post.objects.create(
            author=author, content=screening.content, visibility=visibility, tenant=tenant,
            moderation_status=screening.status, **screening.moderation_fields,
        )
        PostService.increment_post_count(author.pk)
        _record_hits(screening)
    return post


def _record_hits(screening):
    from apps.social.moderation import record_hits

    if screening.hit_ids:
        record_hits(screening.hit_ids)


def delete_own_post(user, post_id):
    ensure_can_write(user)
    post = visible_posts_for_soul(user).filter(pk=post_id).first()
    if post is None:
        raise _not_found()
    if post.author_id != user.pk:
        raise SocialError("只能删除自己的帖子。", "not_author", 403)
    post.soft_delete(user=user, reason="author")


def _ensure_not_sealed(post):
    """前世账号的帖子封存只读(2026-09-24 用户决定):不能再表态、评论。读与举报照旧。"""
    if not is_current_soul(post.author):
        raise SocialError("这一世已止,帖子封存只读。", "post_sealed", 409)


def create_comment(author, post_id, content, parent_id=None):
    tenant = ensure_can_write(author)
    post = visible_posts_for_soul(author).filter(pk=post_id, moderation_status=ModerationStatus.PUBLISHED).first()
    if post is None:
        raise _not_found()
    _ensure_not_sealed(post)
    parent = None
    if parent_id is not None:
        parent = visible_comments_for_soul(author).filter(
            pk=parent_id, post=post, moderation_status=ModerationStatus.PUBLISHED
        ).first()
        if parent is None:
            raise SocialError("回复的评论不存在。", "parent_not_found", 400)
    screening = _screen(tenant, content)
    with transaction.atomic():
        comment = CommentService.create_comment(
            author=author, post=post, content=screening.content, parent=parent, tenant=tenant,
            moderation_status=screening.status, **screening.moderation_fields,
        )
        _record_hits(screening)
        if screening.status == ModerationStatus.PUBLISHED:
            recipients = {post.author_id, parent.author_id if parent else None} - {author.pk}
            publish_event("SOCIAL_COMMENTED", tenant, sorted(r for r in recipients if r),
                     {"post_id": str(post.pk), "comment_id": str(comment.pk), "actor_user_id": author.pk})
    return comment


def delete_own_comment(user, comment_id):
    ensure_can_write(user)
    comment = visible_comments_for_soul(user).filter(pk=comment_id).first()
    if comment is None:
        raise _not_found()
    if comment.author_id != user.pk:
        raise SocialError("只能删除自己的评论。", "not_author", 403)
    CommentService.delete_comment(comment)


@dataclass
class ReactionState:
    reacted: bool
    reaction_type: str | None


def toggle_reaction(user, post_id, reaction_type):
    """每人每帖一条表态:同一类型再点一次是取消,换类型是改。返回表态后的状态。

    **长明灯点了就锁死**(2026-09-24 用户决定):已有 ETERNAL_LIGHT 时,再点它(取消)
    或换成别的都拒绝 —— 在这里拒,不靠 App 藏入口。锁帖子行,让同一帖子上的表态串行:
    否则两个并发请求都读到「还没有表态」,后一个会把刚点的长明灯改掉。
    """
    tenant = ensure_can_write(user)
    post = visible_posts_for_soul(user).filter(pk=post_id, moderation_status=ModerationStatus.PUBLISHED).first()
    if post is None:
        raise _not_found()
    _ensure_not_sealed(post)
    with transaction.atomic():
        Post.objects.select_for_update().filter(pk=post.pk).exists()
        before = Reaction.objects.filter(user=user, post=post).first()
        if before is not None and before.reaction_type == ReactionType.ETERNAL_LIGHT:
            raise SocialError("长明灯已点,不可取消或更改。", "eternal_light_locked", 409)
        ReactionService.add_reaction(user=user, reaction_type=reaction_type, post=post, tenant=tenant)
    if before is not None and before.reaction_type == reaction_type:
        return ReactionState(False, None)
    return ReactionState(True, reaction_type)


def follow(user, target_id):
    """只能关注**此刻同文明的本世灵魂账号**。跨文明、官员、前世账号、不存在 —— 一律同一个 404,
    不给「这个 id 在别的文明存在」留探测口。"""
    tenant = ensure_can_write(user)
    target = souls_in(tenant).exclude(pk=user.pk).filter(pk=target_id).first()
    if target is None:
        raise _not_found()
    _, created = FollowService.follow(user, target, tenant)
    if created:
        publish_event("SOCIAL_FOLLOWED", tenant, [target.pk], {"follower_user_id": user.pk})
    return target


def unfollow(user, target_id):
    tenant = ensure_can_write(user)
    target = souls_in(tenant, include_retired=True).filter(pk=target_id).first()
    if target is None:
        raise _not_found()
    FollowService.unfollow(user, target, tenant)
    return target


DISPLAY_NAME_MIN = 2
DISPLAY_NAME_MAX = 20


def rename(user, display_name):
    """改朋友圈显示名(2026-09-24 用户决定)。显示名是 `User.display_name` 本身 —— 名片、
    搜索、主页读的都是它,所以没有第二份。

    * 敏感词**直接拒**,不走「先发后审」:名字出现在别人的每一条动态流里,
      不存在「审核通过前只有本人看得见」的名字。
    * 同文明另一个本世灵魂已经叫这个名字(不分大小写)→ 拒:防冒名。前世账号不占名。
    """
    tenant = ensure_can_write(user)
    name = (display_name or "").strip()
    if not DISPLAY_NAME_MIN <= len(name) <= DISPLAY_NAME_MAX:
        raise SocialError("显示名要 2 到 20 个字。", "display_name_length", 400)
    from apps.social.moderation import hits_sensitive_word

    if hits_sensitive_word(tenant, name):
        raise SocialError("显示名含有不允许的词。", "display_name_sensitive", 400)
    if souls_in(tenant).exclude(pk=user.pk).filter(display_name__iexact=name).exists():
        raise SocialError("本文明已有灵魂叫这个名字。", "display_name_taken", 409)
    user.display_name = name
    user.save(update_fields=["display_name"])
    return user
