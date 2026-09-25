"""殿司收件箱的官员侧工作状态:未读、归档、草稿,以及按它们切出来的文件夹。

**每一样都是「这位官员」的,不是殿司的。** 状态在 `InboxOfficerState`,按 (会话, 官员) 一行;
列表上的 `unread` / `archived` / `has_draft` 是对**调用者自己那一行**的子查询 —— 另一位官员
读过、归档过、写过草稿,都不改变你看到的。

「谁最后说话」(`Conversation.last_from`)不是官员私有的:那是信本身的事实,由
`services.py` 的三个写点维护(灵魂经后端发、官员回复、Synapse 回调)。

文件夹(`folder=`):

    all             未归档
    awaiting_reply  未归档 · 未关闭 · 最后一封是灵魂写的          最早在上(先来先回)
    replied         未归档 · 最后一封是殿司写的
    drafts          未归档 · 我有草稿
    archived        我归档了的(灵魂之后再来一封信,就回到未归档:`unarchive_for_letter`)
    assigned_to_me  未归档 · 同僚标给我的(`Conversation.assignee` 是我)

`awaiting_reply` 与 `replied` 不相交;两者之外的未归档会话只有两种 —— 还没有一封信的,
和已关闭而最后一封是灵魂写的(再也回不了,不算「待」)。`archived` 与其余四个都不相交。
`tests/test_chat_inbox_folders.py` 断言这个划分。`drafts` 与 `assigned_to_me` 不是划分的一块,
是横切「全部」的两个视图:一封信可以同时待回复、有我的草稿、又是标给我的。

**经办人(「标给同僚」)是殿司共享的**,与上面三样私人状态相反:存在会话上(`Conversation.assignee`),
同殿司每位官员看到同一个人。会话不换殿 —— 只能标给**这个殿司**里持有 `soul_inbox.reply` 的在职官员,
规则与审判改派同一个函数(`apps/judgment/claims.py::is_assignable`)。
"""
from django.db.models import (
    BooleanField,
    Case,
    Count,
    Exists,
    ExpressionWrapper,
    F,
    OuterRef,
    Q,
    Subquery,
    Value,
    When,
)
from django.utils import timezone

from apps.chat.models import InboxOfficerState
from apps.tenants.models import Tenant

FOLDERS = ("all", "awaiting_reply", "replied", "drafts", "archived", "assigned_to_me")

#: 经办人要有的码名:能回复,才谈得上把回信交给他。
ASSIGNEE_PERMISSION = "soul_inbox.reply"

#: 草稿与回复正文同一上限(`OfficerReplySerializer.body`)。
DRAFT_MAX_LENGTH = 4000


def annotate_for(qs, user):
    """给每个会话标上调用者自己的 `unread` / `archived` / `has_draft`,以及「是不是标给我的」。"""
    mine = InboxOfficerState.objects.filter(conversation=OuterRef("pk"), user=user)
    return qs.annotate(
        my_read_at=Subquery(mine.values("last_read_at")[:1]),
        archived=Exists(mine.filter(archived_at__isnull=False)),
        has_draft=Exists(mine.exclude(draft="")),
        assigned_to_me=ExpressionWrapper(Q(assignee_id=user.pk), output_field=BooleanField()),
    ).annotate(
        # 未读 = 灵魂有一封我读过之后才来的信。殿司(包括同僚)的回复不算:收件箱里要「读」的是来信。
        unread=Case(
            When(last_soul_message_at__isnull=True, then=Value(False)),
            When(my_read_at__isnull=True, then=Value(True)),
            When(last_soul_message_at__gt=F("my_read_at"), then=Value(True)),
            default=Value(False),
            output_field=BooleanField(),
        ),
    )


def folder_q(folder):
    """`folder` → 过滤条件。调用方先 `annotate_for`。"""
    if folder == "archived":
        return Q(archived=True)
    live = Q(archived=False)
    if folder == "awaiting_reply":
        return live & Q(last_from="soul", closed_at__isnull=True)
    if folder == "replied":
        return live & Q(last_from="hall")
    if folder == "drafts":
        return live & Q(has_draft=True)
    if folder == "assigned_to_me":
        return live & Q(assigned_to_me=True)
    return live


def counts(qs):
    """每个文件夹的总数,外加未读、往来中 / 已关闭、按殿 —— 与列表同一个 `folder_q`,
    所以计数与翻到底的条数是同一个数。`qs` 已按租户收窄并 `annotate_for`。"""
    result = {folder: qs.filter(folder_q(folder)).count() for folder in FOLDERS}
    live = qs.filter(folder_q("all"))
    result["unread"] = live.filter(unread=True).count()
    result["open"] = live.filter(closed_at__isnull=True).count()
    result["closed"] = live.filter(closed_at__isnull=False).count()
    per_hall = dict(live.order_by().values_list("tenant_id").annotate(n=Count("pk")))
    tenants = Tenant.objects.filter(pk__in=per_hall).order_by("pk")
    result["halls"] = [{"tenant": t.pk, "hall_names": t.hall_names, "count": per_hall[t.pk]} for t in tenants]
    return result


def state_for(conversation, user):
    state, _ = InboxOfficerState.objects.get_or_create(conversation=conversation, user=user)
    return state


def mark_read(conversation, user):
    state = state_for(conversation, user)
    state.last_read_at = timezone.now()
    state.save(update_fields=["last_read_at"])
    return state


def set_archived(conversation, user, archived):
    state = state_for(conversation, user)
    state.archived_at = timezone.now() if archived else None
    state.save(update_fields=["archived_at"])
    return state


def unarchive_for_letter(conversation, written_at):
    """灵魂的一封新信把会话从**每一位**在它之前归档了的官员的归档里拿回来(2026-09-26 产品定)。

    只比「归档时刻 < 信的时刻」:晚到的回调带来的是归档之前写的信,官员归档时它已经在了,不拿回。
    未读与「待回复」不必另写 —— 它们由 `last_soul_message_at` / `last_from` 算出来,调用方已经写了。"""
    return InboxOfficerState.objects.filter(
        conversation=conversation, archived_at__isnull=False, archived_at__lt=written_at
    ).update(archived_at=None)


def save_draft(conversation, user, text):
    """空串 = 清掉。关闭的会话由视图先拒(只读),这里不再判断。"""
    state = state_for(conversation, user)
    state.draft = text
    state.draft_saved_at = timezone.now() if text else None
    state.save(update_fields=["draft", "draft_saved_at"])
    return state


def after_reply(conversation, user):
    """回复发出之后:这位官员的草稿清空、读到此刻 —— 回了就是读过了。"""
    InboxOfficerState.objects.update_or_create(
        conversation=conversation, user=user,
        defaults={"draft": "", "draft_saved_at": None, "last_read_at": timezone.now()},
    )


class InvalidAssigneeError(ValueError):
    """经办人不是这个殿司里能回复的在职官员。「不存在」与「在别的殿司」答同一句,不做用户枚举。"""


def assignable_officers(conversation):
    """这封信可以标给谁:收件殿司里持有 `soul_inbox.reply` 的在职官员(按用户名)。"""
    from apps.authentication.models import User
    from apps.judgment.claims import assignable_officers as officers

    return officers(User.objects.all(), conversation.tenant_id, ASSIGNEE_PERMISSION)


def assign(conversation, target, *, actor):
    """标给 `target`。规则与审判改派同一个函数;标给别人时经既有的官员通知路径告诉他。"""
    from apps.judgment.claims import is_assignable

    if not is_assignable(target, conversation.tenant_id, ASSIGNEE_PERMISSION):
        raise InvalidAssigneeError("No such officer in this hall who can reply to letters.")
    conversation.assignee = target
    conversation.assigned_at = timezone.now()
    conversation.save(update_fields=["assignee", "assigned_at"])
    if target.pk != actor.pk:
        _notify_assigned(conversation, target, actor)
    return conversation


def unassign(conversation):
    conversation.assignee = None
    conversation.assigned_at = None
    conversation.save(update_fields=["assignee", "assigned_at"])
    return conversation


def _notify_assigned(conversation, target, actor):
    """存 zh-Hans 文本(推送与兜底),读时按请求语言重渲染(apps/notifications/messages.py)。
    只带灵魂名与交办人,**不带**信的正文 —— 正文在 Synapse,不进我们的库。"""
    from apps.events.services import EventService
    from apps.notifications import messages

    params = {"soul": conversation.soul_a.name, "by": actor.display_name or actor.username}
    title, body = messages.render(messages.DEFAULT_LOCALE, "soul_inbox_assigned", params)
    EventService.notify_user(
        target, title=title, message=body, notification_type="SOUL_INBOX_ASSIGNED",
        related_resource="soul_inbox", related_id=str(conversation.pk), params=params,
    )
