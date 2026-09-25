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
    archived        我归档了的

`awaiting_reply` 与 `replied` 不相交;两者之外的未归档会话只有两种 —— 还没有一封信的,
和已关闭而最后一封是灵魂写的(再也回不了,不算「待」)。`archived` 与其余四个都不相交。
`tests/test_chat_inbox_folders.py` 断言这个划分。
"""
from django.db.models import BooleanField, Case, Count, Exists, F, OuterRef, Q, Subquery, Value, When
from django.utils import timezone

from apps.chat.models import InboxOfficerState
from apps.tenants.models import Tenant

FOLDERS = ("all", "awaiting_reply", "replied", "drafts", "archived")

#: 草稿与回复正文同一上限(`OfficerReplySerializer.body`)。
DRAFT_MAX_LENGTH = 4000


def annotate_for(qs, user):
    """给每个会话标上调用者自己的 `unread` / `archived` / `has_draft`。"""
    mine = InboxOfficerState.objects.filter(conversation=OuterRef("pk"), user=user)
    return qs.annotate(
        my_read_at=Subquery(mine.values("last_read_at")[:1]),
        archived=Exists(mine.filter(archived_at__isnull=False)),
        has_draft=Exists(mine.exclude(draft="")),
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
