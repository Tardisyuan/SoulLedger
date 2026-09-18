"""灵魂朋友圈的审核:敏感词、举报、官员处置、禁言。每个官员动作都写一条 AuditLog。

**处置只作用于灵魂的内容。** 官员侧的查询集都带 `author__role="SOUL"`(见 moderation_views),
官员自己的社交帖子不进审核后台。

行锁:举报锁举报人的 SoulAccount 行(每日上限的计数与插入原子);处置锁被处置的那一行
(同一条帖子被两个官员同时「恢复」与「删除」只有一个生效,另一个看到新状态后得 409)。
锁的语义只在 PostgreSQL 上成立 —— SQLite 没有行锁,见报告「需真 PG 验证」一节。
"""
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.db.models import F
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
    SocialMute,
)
from apps.social.soul_circle import (
    SocialError,
    publish_event,
    civilization_of,
    ensure_can_write,
    souls_in,
    visible_comments_for_soul,
    visible_posts_for_soul,
)

#: 每个灵魂 24 小时内最多提交的举报条数(滚动窗口,不按自然日 —— 不用操心时区)。
REPORTS_PER_DAY = 10
REPORT_WINDOW = timedelta(hours=24)
MAX_MUTE_DAYS = 365


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
    """命中的第一个敏感词,没有命中为 None。小写子串匹配。

    ponytail: 每次写入把本文明词表整张读出来做子串扫描;词表上千条再换 Aho-Corasick 或缓存。
    """
    haystack = "\n".join(t for t in texts if t).lower()
    if not haystack or tenant is None:
        return None
    for word in SensitiveWord.objects.filter(tenant=tenant).values_list("word", flat=True):
        if word and word in haystack:
            return word
    return None


def add_sensitive_word(tenant, word, *, actor, request=None):
    word = normalize_word(word)
    if not word:
        raise SocialError("敏感词不能为空。", "invalid_word", 400)
    with transaction.atomic():
        try:
            with transaction.atomic():
                row = SensitiveWord.objects.create(tenant=tenant, word=word, created_by=actor)
        except IntegrityError:
            raise SocialError("该敏感词已存在。", "duplicate_word", 409) from None
        audit("CREATE", tenant, row.pk, f"添加敏感词「{word}」", actor=actor, request=request)
    return row


def remove_sensitive_word(row, *, actor, request=None):
    with transaction.atomic():
        audit("DELETE", row.tenant, row.pk, f"删除敏感词「{row.word}」", actor=actor, request=request)
        row.delete()


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
            row.soft_delete(user=actor, reason=reason[:500] or "moderation")
            after = "DELETED"
        else:
            allowed, after = CONTENT_TRANSITIONS[action]
            if before not in allowed:
                raise SocialError(f"当前状态 {before} 不能执行 {action}。", "invalid_transition", 409)
            # `.update()` 而不是 `save()`:通用审计信号会再写一条字段 diff,而下面这条已经说清楚了。
            model.objects.filter(pk=row.pk).update(moderation_status=after)
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
    return row


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
    """HIDE / DELETE 作用于被举报的帖子或评论;MUTE 禁言 `target_user`;DISMISS 只关闭举报。"""
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
        Report.objects.filter(pk=row.pk, status=ReportStatus.OPEN).update(
            status=ReportStatus.DISMISSED if resolution == ReportResolution.DISMISS else ReportStatus.RESOLVED,
            resolution=resolution, resolved_by=actor, resolved_at=timezone.now(), resolution_note=note[:500],
        )
        audit("UPDATE", row.tenant, row.pk, f"处理举报 {row.target_type}:{resolution}",
              actor=actor, request=request, changes={"resolution": resolution, "report_count": row.report_count})
        row.refresh_from_db()
    return row

