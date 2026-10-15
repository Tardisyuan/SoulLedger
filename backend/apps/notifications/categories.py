"""官员通知的类别:个人中心「通知」表(类别 × 站内 / 邮件)的唯一权威。

**每个 `NotificationType` 都必须在 `CATEGORY_BY_TYPE` 里有一行**(`tests/test_notification_categories.py`
钉住):值是下面七个类别之一,或 `None` —— 「不进这张表,照旧送达」(受刑计划、联审、系统消息等
结论 / 运维类;表里没有它们的行,也就没有地方关)。新增类型时必须在这里作出选择,不会无声地落进默认值。

偏好存在 `User.preferences["notifications"][类别]["site" | "mail"]`(`mail_since` 是内部字段:该格从关到开的时刻,
邮件通道只发这一刻之后的通知,见 `tasks.py`)。**没存过的格读默认值**:站内开;邮件跟旧的总开关
`preferences["email_notifications"]`(它不再出现在 API 里,也不再被写,只作这一个默认值保留 —— 老账号的关 / 开因此原样延续)。
锁定的格(`LOCKED`)读写都恒为开:序列化器拒绝把它关掉,送达处也不看存的值。
"""
from django.utils import timezone

CATEGORIES = (
    "account_security", "approval", "approval_timeout", "reassign", "password_help", "dispatch", "letter_handoff",
)
CHANNELS = ("site", "mail")

#: 类别 → 不能关的通道。账号安全、密码求助两列都必收;审批超时站内必收(影响时限)。
LOCKED = {
    "account_security": ("site", "mail"),
    "password_help": ("site", "mail"),
    "approval_timeout": ("site",),
}

#: 通知类型 → 类别;`None` = 不分类、照旧送达。
CATEGORY_BY_TYPE = {
    "WORKFLOW_ASSIGNED": "approval",
    "JUDGMENT_REASSIGN_REQUESTED": "reassign",
    "PASSWORD_HELP_REQUESTED": "password_help",
    "IMPERSONATION_STARTED": "account_security",
    "DISPATCH_PROPOSED": "dispatch",
    "DISPATCH_APPROVED": "dispatch",
    "DISPATCH_REJECTED": "dispatch",
    "DISPATCH_CANCELLED": "dispatch",
    "SOUL_INBOX_ASSIGNED": "letter_handoff",
    "JUDGMENT_COMPLETED": None,
    "SYSTEM": None,
    "APPEAL_REQUIRED": None,
    "REINCARNATION_COMPLETE": None,
    "KARMIC_UPDATE": None,
    "ROLE_ASSIGNED": None,
    "CROSS_JUDGMENT_INVITED": None,
    "JUDGMENT_CONCLUDED": None,
    "DISPATCH_RETURN_BLOCKED": None,
    "SENTENCE_NODE_ACTIVE": None,
    "SENTENCE_NODE_DONE": None,
    "SENTENCE_NODE_WAITING": None,
    "SENTENCE_NODE_REFUSED": None,
    "SENTENCE_PLAN_COMPLETED": None,
    "CROSS_SENTENCE_SUBMITTED": None,
    "SENTENCE_PLAN_AMENDED": None,
    "SENTENCE_REQUEST_PENDING": None,
    "SENTENCE_REQUEST_DECIDED": None,
    "SENTENCE_PLAN_CANCELLED": None,
}

#: 发送方可以在 `params["category"]` 里改选的类别(只限这里列的,与 `messages.VARIANTS` 同一个做法):
#: 超时的转交 / 提醒同样写 `WORKFLOW_ASSIGNED`,靠它与普通的待审批分开。
OVERRIDES = {"WORKFLOW_ASSIGNED": {"approval_timeout"}}


def category_of(notification_type, params=None):
    chosen = (params or {}).get("category")
    if chosen in OVERRIDES.get(notification_type, ()):
        return chosen
    return CATEGORY_BY_TYPE.get(notification_type)


def _cell(user, category):
    return ((getattr(user, "preferences", None) or {}).get("notifications") or {}).get(category) or {}


def wants(user, category, channel):
    """这位官员要不要在这个通道收这个类别。`category` 为 `None`(不分类)恒为真。"""
    if category is None or channel in LOCKED.get(category, ()):
        return True
    cell = _cell(user, category)
    if channel in cell:
        return bool(cell[channel])
    if channel == "site":
        return True
    return (user.preferences or {}).get("email_notifications") is True


def mail_since(user, category):
    """该类别邮件通道的起点(ISO 字符串或 `None`):该格自己的 `mail_since`,否则旧总开关打开的时刻。"""
    return _cell(user, category).get("mail_since") or (user.preferences or {}).get("email_opted_at")


def resolved(user):
    """API 读到的整张表:每个类别两个通道,锁定的恒为 True。"""
    return {c: {ch: wants(user, c, ch) for ch in CHANNELS} for c in CATEGORIES}


def merge(user, incoming):
    """把 PATCH 来的 `notifications` 并进已存的(逐格,不整块覆盖),返回新的 `notifications` 字典。
    邮件从关到开的那一格记下 `mail_since`。"""
    out = {c: dict(v) for c, v in ((user.preferences or {}).get("notifications") or {}).items()}
    for category, cell in incoming.items():
        target = out.setdefault(category, {})
        for channel, value in cell.items():
            if channel == "mail" and value and not wants(user, category, "mail"):
                target["mail_since"] = timezone.now().isoformat()
            target[channel] = value
    return out
