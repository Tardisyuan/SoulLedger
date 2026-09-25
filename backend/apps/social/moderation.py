"""灵魂朋友圈的审核:敏感词、举报、官员处置、禁言。每个官员动作都写一条 AuditLog。

**处置只作用于灵魂的内容。** 官员侧的查询集都带 `author__role="SOUL"`(见 moderation_views),
官员自己的社交帖子不进审核后台。

行锁:举报锁举报人的 SoulAccount 行(每日上限的计数与插入原子);处置锁被处置的那一行
(同一条帖子被两个官员同时「恢复」与「删除」只有一个生效,另一个看到新状态后得 409)。
锁的语义只在 PostgreSQL 上成立 —— SQLite 没有行锁,见报告「需真 PG 验证」一节。
"""
from dataclasses import dataclass, field
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.db.models import F, Q, Sum
from django.db.models.functions import Coalesce
from django.utils import timezone

from apps.social.models import (
    ModerationStatus,
    Post,
    Report,
    ReportEntry,
    ReportResolution,
    ReportStatus,
    ReportTargetType,
    SensitiveWord,
    SensitiveWordAction,
    SensitiveWordDailyHit,
    SocialMute,
)
from apps.social.soul_circle import (
    SocialError,
    civilization_of,
    ensure_can_write,
    publish_event,
    souls_in,
    visible_comments_for_soul,
    visible_posts_for_soul,
)

#: 每个灵魂 24 小时内最多提交的举报条数(滚动窗口,不按自然日 —— 不用操心时区)。
REPORTS_PER_DAY = 10
REPORT_WINDOW = timedelta(hours=24)
MAX_MUTE_DAYS = 365
#: 敏感词「近 N 天命中」的 N。
HIT_WINDOW_DAYS = 30
#: 批量删除敏感词一次最多几条。
BATCH_DELETE_MAX = 200
MASK = "***"
#: 敏感词自动处置写进 `moderation_reason` 的前缀;后面跟命中的词。
AUTO_REASON_PREFIX = "sensitive_word:"


def audit(action, tenant, resource_id, description, *, actor=None, request=None, changes=None):
    from apps.audit.models import AuditLog
    from apps.core.client_ip import get_client_ip

    AuditLog.objects.create(
        tenant=tenant,
        user=actor if getattr(actor, "is_authenticated", False) else None,
        action=action,
        resource="social_moderation",
        resource_id=str(resource_id),
        description=description[:500],
        changes=changes,
        ip_address=get_client_ip(request) if request is not None else None,
        user_agent=request.META.get("HTTP_USER_AGENT", "")[:500] if request is not None else "",
    )


# ── 敏感词 ──────────────────────────────────────────────────────────────


def normalize_word(word):
    return (word or "").strip().lower()


def hits_sensitive_word(tenant, *texts):
    """命中的第一个敏感词,没有命中为 None。小写子串匹配。不看动作、不计命中 ——
    改显示名(soul_circle.rename)用它:名字命中任何词都直接拒。

    ponytail: 每次写入把本文明词表整张读出来做子串扫描;词表上千条再换 Aho-Corasick 或缓存。
    """
    haystack = "\n".join(t for t in texts if t).lower()
    if not haystack or tenant is None:
        return None
    for word in SensitiveWord.objects.filter(tenant=tenant).values_list("word", flat=True):
        if word and word in haystack:
            return word
    return None


#: 多个词同时命中时取最重的动作。MASK 最轻:替换后内容照常发布。
_ACTION_WEIGHT = {SensitiveWordAction.MASK: 0, SensitiveWordAction.REVIEW: 1, SensitiveWordAction.HIDE: 2}
_STATUS_FOR_ACTION = {
    SensitiveWordAction.MASK: ModerationStatus.PUBLISHED,
    SensitiveWordAction.REVIEW: ModerationStatus.PENDING,
    SensitiveWordAction.HIDE: ModerationStatus.HIDDEN,
}


@dataclass
class Screening:
    """一条帖子 / 评论过一遍本文明词表的结果。`content` 是要写进数据库的文本(MASK 已替换)。"""

    content: str
    status: str = ModerationStatus.PUBLISHED
    #: 决定 `status` 的那个词(最重动作里按词表顺序第一个);没有命中或只有 MASK 时为空。
    decisive_word: str = ""
    hit_ids: list = field(default_factory=list)

    @property
    def moderation_fields(self):
        """写入时要一并落库的审核字段。只有 HIDE 算「已处理」—— 进已处理列表,由系统处理,
        所以带 `moderated_at`。REVIEW 送审只记为什么(2026-09-25 决定):`moderation_reason`
        写 `sensitive_word:<词>`,与 HIDE 同一个前缀;`moderated_at` 留空 —— 还没有人决定。
        官员随后通过 / 隐藏会用自己的理由覆盖它。"""
        reason = {"moderation_reason": AUTO_REASON_PREFIX + self.decisive_word}
        if self.status == ModerationStatus.HIDDEN:
            return {"moderated_at": timezone.now(), **reason}
        if self.status == ModerationStatus.PENDING:
            return reason
        return {}


def mask_words(text, words):
    """把 `text` 里所有 `words`(小写)的出现替换成 ***,与检测同一种小写子串匹配。

    在小写副本上找位置、在原文上替换:重叠或相邻的命中合并成一个 ***。
    `str.lower()` 对极少数字符会改变长度(如 "İ"),那时位置对不上原文 —— 退回把
    整段转小写后再替换,宁可丢大小写也不漏掉一个该遮的词。
    """
    lowered = text.lower()
    if len(lowered) != len(text):
        text = lowered
    spans = []
    for word in words:
        start = lowered.find(word)
        while word and start != -1:
            spans.append((start, start + len(word)))
            start = lowered.find(word, start + 1)
    if not spans:
        return text
    spans.sort()
    merged = [list(spans[0])]
    for start, end in spans[1:]:
        if start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    out, cursor = [], 0
    for start, end in merged:
        out.append(text[cursor:start])
        out.append(MASK)
        cursor = end
    out.append(text[cursor:])
    return "".join(out)


def screen_content(tenant, content):
    """帖子与评论写入前的唯一一道词表检查。只读,不计命中 —— 计数见 `record_hits`,
    由调用方在写入的同一事务里调,写入失败则不计。

    * REVIEW → PENDING,进待审队列(`/social-moderation/posts|comments/`,默认视图),与 0007 之前一致;
    * HIDE → HIDDEN,直接进「已处理」,作者本人仍看得见(带状态);
    * MASK → 命中的片段在写入时换成 ***,内容照常发布。
    检测一律在原文上做:先遮掉的 MASK 词不会让另一个重叠的 REVIEW / HIDE 词漏检。
    """
    if not content or tenant is None:
        return Screening(content=content)
    haystack = content.lower()
    hits = [
        (pk, word, action)
        for pk, word, action in SensitiveWord.objects.filter(tenant=tenant).values_list("id", "word", "action")
        if word and word in haystack
    ]
    if not hits:
        return Screening(content=content)
    worst = max((action for _, _, action in hits), key=lambda a: _ACTION_WEIGHT[a])
    masked = [word for _, word, action in hits if action == SensitiveWordAction.MASK]
    decisive = "" if worst == SensitiveWordAction.MASK else next(w for _, w, a in hits if a == worst)
    return Screening(
        content=mask_words(content, masked) if masked else content,
        status=_STATUS_FOR_ACTION[worst],
        decisive_word=decisive,
        hit_ids=[pk for pk, _, _ in hits],
    )


def record_hits(word_ids):
    """给每个命中的词在今天(UTC 日期)的桶里 +1。一条内容命中同一个词只算一次。

    先 UPDATE;今天还没有桶才 INSERT。两个请求同时给同一个词开今天的桶时,输的那个
    撞唯一约束 —— 在保存点里撞,回滚的只是这一条 INSERT(PostgreSQL 上一条失败语句会
    中止整个事务,见 CLAUDE.md),然后再 UPDATE 一次。
    """
    today = timezone.now().date()
    for word_id in dict.fromkeys(word_ids):
        bucket = SensitiveWordDailyHit.objects.filter(word_id=word_id, day=today)
        if bucket.update(count=F("count") + 1):
            continue
        try:
            with transaction.atomic():
                SensitiveWordDailyHit.objects.create(word_id=word_id, day=today, count=1)
        except IntegrityError:
            bucket.update(count=F("count") + 1)


def with_recent_hits(queryset):
    """给 SensitiveWord 查询集注上 `hits_30d`:每个词最多读 30 个桶。"""
    since = timezone.now().date() - timedelta(days=HIT_WINDOW_DAYS - 1)
    return queryset.annotate(
        hits_30d=Coalesce(Sum("daily_hits__count", filter=Q(daily_hits__day__gte=since)), 0)
    )


def add_sensitive_word(tenant, word, *, actor, request=None, category="", action=SensitiveWordAction.REVIEW):
    word = normalize_word(word)
    if not word:
        raise SocialError("敏感词不能为空。", "invalid_word", 400)
    with transaction.atomic():
        try:
            with transaction.atomic():
                row = SensitiveWord.objects.create(
                    tenant=tenant, word=word, created_by=actor, category=category, action=action,
                )
        except IntegrityError:
            raise SocialError("该敏感词已存在。", "duplicate_word", 409) from None
        audit("CREATE", tenant, row.pk, f"添加敏感词「{word}」", actor=actor, request=request,
              changes={"category": category, "action": action})
    return row


def update_sensitive_word(row, *, actor, request=None, **fields):
    """改一个词的 `category` / `action` / `word`(只改给了的)。`word` 与新建同一套校验:
    去空白、转小写、不能为空、本文明内不能重复(409)。词本身改了,旧词的命中桶一并清掉 ——
    它们数的是另一个字符串。审计写 `{字段: [旧, 新]}`,只记真的变了的。"""
    if "word" in fields:
        fields["word"] = normalize_word(fields["word"])
        if not fields["word"]:
            raise SocialError("敏感词不能为空。", "invalid_word", 400)
    with transaction.atomic():
        row = SensitiveWord.objects.select_for_update(of=("self",)).get(pk=row.pk)
        changes = {k: [getattr(row, k), v] for k, v in fields.items() if getattr(row, k) != v}
        if not changes:
            return row
        for name, (_, value) in changes.items():
            setattr(row, name, value)
        try:
            with transaction.atomic():
                row.save(update_fields=list(changes))
        except IntegrityError:
            raise SocialError("该敏感词已存在。", "duplicate_word", 409) from None
        if "word" in changes:
            row.daily_hits.all().delete()
        audit("UPDATE", row.tenant, row.pk, f"修改敏感词「{row.word}」", actor=actor, request=request, changes=changes)
    return row


def update_sensitive_words(queryset, ids, *, actor, request=None, **fields):
    """批量改(只改 `action` / `category`,不改词本身)。`queryset` 必须已按租户收窄。
    全有或全无,规则与 `remove_sensitive_words` 相同:任何一个 id 不在查询集里 → 404 + `missing`。"""
    ids = list(dict.fromkeys(ids))
    if not 1 <= len(ids) <= BATCH_DELETE_MAX:
        raise SocialError(f"一次修改 1–{BATCH_DELETE_MAX} 条。", "invalid_batch", 400)
    with transaction.atomic():
        rows = list(queryset.select_for_update(of=("self",)).filter(pk__in=ids))
        found = {row.pk for row in rows}
        missing = [str(pk) for pk in ids if pk not in found]
        if missing:
            raise SocialError("部分敏感词不存在。", "not_found", 404, missing=missing)
        for row in rows:
            update_sensitive_word(row, actor=actor, request=request, **fields)
    return len(rows)


def copy_sensitive_words(source, target, *, actor, request=None):
    """把 `source` 文明的整张词表复制进 `target`,类别与动作照搬,命中计数不带。
    `target` 里已有的词(同一个小写形)跳过。返回 `(copied, skipped)`。

    **只有 ADMIN 能调**(视图里判):这是唯一一条读另一个文明词表的路径,而回包只有两个数。
    每复制一个词走一次 `add_sensitive_word` —— 同一条审计、同一个保存点:已有的词撞唯一约束,
    回滚的只是那一个保存点,记为「跳过」(PostgreSQL 上失败语句会中止事务,所以必须在保存点里撞)。
    """
    if source.pk == target.pk:
        raise SocialError("源文明与目标文明相同。", "same_tenant", 400)
    copied = skipped = 0
    with transaction.atomic():
        for row in SensitiveWord.objects.filter(tenant=source).order_by("word"):
            try:
                add_sensitive_word(target, row.word, actor=actor, request=request,
                                   category=row.category, action=row.action)
            except SocialError as exc:
                if exc.code != "duplicate_word":
                    raise
                skipped += 1
                continue
            copied += 1
    return copied, skipped


def remove_sensitive_word(row, *, actor, request=None):
    with transaction.atomic():
        audit("DELETE", row.tenant, row.pk, f"删除敏感词「{row.word}」", actor=actor, request=request)
        row.delete()


def remove_sensitive_words(queryset, ids, *, actor, request=None):
    """批量删除。`queryset` 必须已按租户收窄(视图传 `get_queryset()`)。

    全有或全无:任何一个 id 不在这个查询集里(别的文明的、已删的、不存在的)就一条都不删,
    答 404 并列出找不到的 id —— 删了一半的词表比没删更难收拾。返回删掉的条数。
    """
    ids = list(dict.fromkeys(ids))
    if not 1 <= len(ids) <= BATCH_DELETE_MAX:
        raise SocialError(f"一次删除 1–{BATCH_DELETE_MAX} 条。", "invalid_batch", 400)
    with transaction.atomic():
        rows = list(queryset.select_for_update(of=("self",)).filter(pk__in=ids))
        found = {row.pk for row in rows}
        missing = [str(pk) for pk in ids if pk not in found]
        if missing:
            raise SocialError("部分敏感词不存在。", "not_found", 404, missing=missing)
        for row in rows:
            remove_sensitive_word(row, actor=actor, request=request)
    return len(rows)


# ── 举报(灵魂侧)──────────────────────────────────────────────────────────


def _resolve_target(reporter, target_type, target_id):
    """举报目标必须是举报人**看得见**的东西。看不见与不存在同一个 404。返回 (lookup, target_user)。"""
    tenant = civilization_of(reporter)
    if target_type == ReportTargetType.POST:
        post = visible_posts_for_soul(reporter).filter(pk=target_id).first()
        if post is None:
            raise SocialError("对象不存在。", "not_found", 404)
        return {"post": post}, post.author
    if target_type == ReportTargetType.COMMENT:
        comment = visible_comments_for_soul(reporter).filter(pk=target_id).first()
        if comment is None:
            raise SocialError("对象不存在。", "not_found", 404)
        return {"comment": comment}, comment.author
    user = souls_in(tenant, include_retired=True).filter(pk=target_id).first()
    if user is None:
        raise SocialError("对象不存在。", "not_found", 404)
    return {"target_user": user}, user


def submit_report(reporter, target_type, target_id, reason, detail=""):
    """返回 `(report, counted)`。`counted=False` 表示这个人已经举报过这条(幂等,不占每日额度)。"""
    from apps.soul_accounts.models import SoulAccount

    tenant = ensure_can_write(reporter)
    lookup, target_user = _resolve_target(reporter, target_type, target_id)
    if target_user.pk == reporter.pk:
        raise SocialError("不能举报自己。", "self_report", 400)

    with transaction.atomic():
        # 锁举报人的账号行:每日上限的「数一下、再插一条」必须原子,否则并发请求能一起越过上限。
        SoulAccount.objects.select_for_update(of=("self",)).get(user=reporter)
        report = (
            Report.objects.select_for_update(of=("self",))
            .filter(target_type=target_type, status=ReportStatus.OPEN, **lookup)
            .first()
        )
        if report is not None and ReportEntry.objects.filter(report=report, reporter=reporter).exists():
            return report, False
        since = timezone.now() - REPORT_WINDOW
        if ReportEntry.objects.filter(reporter=reporter, created_at__gte=since).count() >= REPORTS_PER_DAY:
            raise SocialError(f"24 小时内最多举报 {REPORTS_PER_DAY} 次。", "report_limit", 429)
        if report is None:
            try:
                with transaction.atomic():
                    report = Report.objects.create(
                        tenant=tenant, target_type=target_type, target_user=target_user,
                        **{k: v for k, v in lookup.items() if k != "target_user"},
                    )
            except IntegrityError:
                # 另一个举报人刚刚开了这一条(部分唯一约束兜底);锁住它,合并进去。
                report = Report.objects.select_for_update(of=("self",)).get(
                    target_type=target_type, status=ReportStatus.OPEN, **lookup
                )
        ReportEntry.objects.create(report=report, reporter=reporter, reason=reason, detail=detail)
        Report.objects.filter(pk=report.pk).update(
            report_count=F("report_count") + 1, last_reported_at=timezone.now()
        )
        report.refresh_from_db()
    return report, True


def reports_remaining(reporter):
    since = timezone.now() - REPORT_WINDOW
    used = ReportEntry.objects.filter(reporter=reporter, created_at__gte=since).count()
    return max(REPORTS_PER_DAY - used, 0)


# ── 官员处置 ─────────────────────────────────────────────────────────────

#: 内容动作 -> (允许的起始状态, 目标状态)。DELETE 走软删除,任何状态都可以。
CONTENT_TRANSITIONS = {
    "APPROVE": ({ModerationStatus.PENDING}, ModerationStatus.PUBLISHED),
    "HIDE": ({ModerationStatus.PUBLISHED, ModerationStatus.PENDING}, ModerationStatus.HIDDEN),
    "RESTORE": ({ModerationStatus.HIDDEN}, ModerationStatus.PUBLISHED),
}
CONTENT_ACTIONS = [*CONTENT_TRANSITIONS, "DELETE"]


def _kind(obj):
    return ReportTargetType.POST if isinstance(obj, Post) else ReportTargetType.COMMENT


def moderate_content(obj, action, *, actor, request=None, reason=""):
    """对一条帖子或评论执行 APPROVE / HIDE / RESTORE / DELETE。锁行后按最新状态判定转移。

    HIDE 与 DELETE 顺手关闭这条内容上 OPEN 的举报(处置结果记为同一动作)——
    否则举报队列里会留着一条「已经处理过」的待办。
    """
    model = type(obj)
    kind = _kind(obj)
    with transaction.atomic():
        row = model.objects.select_for_update(of=("self",)).filter(pk=obj.pk).first()
        if row is None:
            raise SocialError("内容已被删除。", "already_deleted", 409)
        before = row.moderation_status
        if action == "DELETE":
            _soft_delete_with_media(row, actor, reason[:500] or "moderation")
            after = "DELETED"
        else:
            allowed, after = CONTENT_TRANSITIONS[action]
            if before not in allowed:
                raise SocialError(f"当前状态 {before} 不能执行 {action}。", "invalid_transition", 409)
            # `.update()` 而不是 `save()`:通用审计信号会再写一条字段 diff,而下面这条已经说清楚了。
            decided = {"moderated_by": actor, "moderated_at": timezone.now(), "moderation_reason": reason[:500]}
            model.objects.filter(pk=row.pk).update(moderation_status=after, **decided)
        audit(
            "DELETE" if action == "DELETE" else "UPDATE", row.tenant, row.pk,
            f"{kind} {action}" + (f":{reason}" if reason else ""),
            actor=actor, request=request, changes={"moderation_status": [before, after], "kind": kind},
        )
        if action in ("HIDE", "DELETE"):
            _close_reports(kind, row, ReportResolution(action), actor=actor, note=reason)
        publish_event("SOCIAL_CONTENT_MODERATED", row.tenant, [row.author_id],
                 {"target_type": kind, "target_id": str(row.pk), "action": action})
    if action != "DELETE":
        row.moderation_status = after
        for name, value in decided.items():
            setattr(row, name, value)
    return row


def _soft_delete_with_media(row, actor, reason):
    """官员删帖:帖子与它的图片同一个 `delete_cascade_id`,于是回收站把它们算作一条
    (「含 N 项关联」),恢复时一起回来,彻底删除时级联真删(文件随 post_delete 走)。
    评论没有图片,照旧单独软删除。"""
    if isinstance(row, Post):
        from apps.core.recycle_bin import cascade_soft_delete

        cascade_soft_delete(row, row.media.filter(is_deleted=False), user=actor, reason=reason)
    else:
        row.soft_delete(user=actor, reason=reason)


def _close_reports(kind, row, resolution, *, actor, note=""):
    lookup = {"post": row} if kind == ReportTargetType.POST else {"comment": row}
    Report.objects.filter(target_type=kind, status=ReportStatus.OPEN, **lookup).update(
        status=ReportStatus.RESOLVED, resolution=resolution, resolved_by=actor,
        resolved_at=timezone.now(), resolution_note=note[:500],
    )


def mute_user(user, tenant, days, *, actor, request=None, reason=""):
    if not 1 <= int(days) <= MAX_MUTE_DAYS:
        raise SocialError(f"禁言天数须在 1–{MAX_MUTE_DAYS} 之间。", "invalid_days", 400)
    with transaction.atomic():
        mute = SocialMute.objects.create(
            tenant=tenant, user=user, until=timezone.now() + timedelta(days=int(days)),
            reason=reason[:500], created_by=actor,
        )
        audit("CREATE", tenant, mute.pk, f"禁言用户 {user.pk} {days} 天" + (f":{reason}" if reason else ""),
              actor=actor, request=request, changes={"user": user.pk, "days": int(days)})
        publish_event("SOCIAL_MUTED", tenant, [user.pk], {"until": mute.until.isoformat()})
    return mute


def lift_mute(mute, *, actor, request=None):
    with transaction.atomic():
        row = SocialMute.objects.select_for_update(of=("self",)).get(pk=mute.pk)
        if row.lifted_at is not None:
            raise SocialError("禁言已解除。", "already_lifted", 409)
        row.lifted_at, row.lifted_by = timezone.now(), actor
        row.save(update_fields=["lifted_at", "lifted_by"])
        audit("UPDATE", row.tenant, row.pk, f"解除用户 {row.user_id} 的禁言", actor=actor, request=request)
        publish_event("SOCIAL_UNMUTED", row.tenant, [row.user_id], {})
    return row


def resolve_report(report, resolution, *, actor, request=None, note="", mute_days=None):
    """HIDE / DELETE 作用于被举报的帖子或评论;MUTE 禁言 `target_user`;DISMISS 只关闭举报。

    WARN:内容不动、举报记为 DISMISSED,理由必填 —— 理由就是警告本身,随 `SOCIAL_WARNED`
    发给 `target_user`(帖子 / 评论的作者,或被举报的用户)。
    """
    if resolution == ReportResolution.WARN and not note.strip():
        raise SocialError("警告作者须写理由。", "reason_required", 400)
    with transaction.atomic():
        row = Report.objects.select_for_update(of=("self",)).select_related("post", "comment", "target_user").get(
            pk=report.pk
        )
        if row.status != ReportStatus.OPEN:
            raise SocialError("举报已处理。", "already_resolved", 409)
        if resolution in (ReportResolution.HIDE, ReportResolution.DELETE):
            content = row.post if row.target_type == ReportTargetType.POST else row.comment
            if content is None:
                raise SocialError("举报对象是用户,不能隐藏或删除;请用禁言。", "invalid_resolution", 400)
            if resolution == ReportResolution.HIDE and content.moderation_status == ModerationStatus.HIDDEN:
                pass  # 已被隐藏(可能经另一条路径),只关闭举报
            elif not content.is_deleted:
                moderate_content(content, resolution, actor=actor, request=request, reason=note)
        elif resolution == ReportResolution.MUTE:
            if mute_days is None:
                raise SocialError("禁言须给出天数。", "invalid_days", 400)
            mute_user(row.target_user, row.tenant, mute_days, actor=actor, request=request, reason=note)
        elif resolution == ReportResolution.WARN:
            # 理由进 payload 是有意的:没有理由的警告对作者没有意义。其余只放 id。
            publish_event("SOCIAL_WARNED", row.tenant, [row.target_user_id], {
                "report_id": str(row.pk), "target_type": row.target_type,
                "target_id": str(row.post_id or row.comment_id or row.target_user_id), "reason": note[:500],
            })
        dismissed = resolution in (ReportResolution.DISMISS, ReportResolution.WARN)
        Report.objects.filter(pk=row.pk, status=ReportStatus.OPEN).update(
            status=ReportStatus.DISMISSED if dismissed else ReportStatus.RESOLVED,
            resolution=resolution, resolved_by=actor, resolved_at=timezone.now(), resolution_note=note[:500],
        )
        audit("UPDATE", row.tenant, row.pk, f"处理举报 {row.target_type}:{resolution}",
              actor=actor, request=request,
              changes={"resolution": resolution, "report_count": row.report_count, "note": note[:500]})
        row.refresh_from_db()
    return row

