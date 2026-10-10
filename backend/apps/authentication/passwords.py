"""官员改密码、邮箱重置密码共用的:让旧会话作废。

两层:刷新令牌进黑名单(`_revoke_refresh_tokens`,灵魂端、两步验证重置也用它),
再把 `User.session_version` +1 —— 官员令牌带 `sv` 声明,比对不上的 access 立刻 401
(`OfficerJWTAuthentication`、WebSocket 握手),不等 access 自然过期。
"""
from django.db.models import F


def end_sessions(user) -> None:
    """该官员此前签发的全部令牌作废。调用方负责事务;之后给当前设备签的新令牌带新的 `sv`。"""
    from apps.soul_accounts.services import _revoke_refresh_tokens

    _revoke_refresh_tokens(user)
    user.session_version = F("session_version") + 1
    user.save(update_fields=["session_version"])
    user.refresh_from_db(fields=["session_version"])
